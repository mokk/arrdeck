"""What an event is, and which ones a device wants: the catalogue, the
Event record, per-device preferences and the quiet-hours/tag rules."""

"""Push notifications.

Two sources feed the same pipeline: webhooks posted by Radarr/Sonarr (instant)
and the history poller (fallback, in case the webhooks aren't installed or the
arr can't reach us). Both go through `notify()`, which drops duplicates so the
two paths can never notify twice about the same thing, and buffers events for a
few seconds so a season pack arrives as one banner instead of ten.
"""
import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from py_vapid import Vapid, b64urlencode
from pywebpush import WebPushException, webpush
from ..db import SettingsDB
from ..registry import Registry


logger = logging.getLogger("arrdeck.push")


COALESCE_WINDOW = 25


EVENTS_KEY = "push_events"


RULES_KEY = "push_rules"


WEBHOOK_SEEN_KEY = "webhook_last_seen"


EVENT_LABELS = {
    "grabbed": "Grabbed",
    "imported": "Downloaded",
    "upgraded": "Upgraded",
    "failed": "Download failed",
    "manual": "Needs manual import",
    "health": "Health issue",
    "added": "Added to library",
}


DEFAULT_EVENTS = ["imported", "upgraded", "failed", "manual", "health"]


WEBHOOK_EVENTS = {
    "Grab": "grabbed",
    "Download": "imported",
    # not enabled by default (see WEBHOOK_FLAGS) but understood if it ever is
    "ImportComplete": "imported",
    "DownloadFailed": "failed",
    "ImportFailure": "failed",
    "ManualInteractionRequired": "manual",
    "Health": "health",
    "HealthRestored": "health",
    "MovieAdded": "added",
    "SeriesAdd": "added",
}


HISTORY_EVENTS = {
    "grabbed": "grabbed",
    "downloadFolderImported": "imported",
    "downloadFailed": "failed",
}


HISTORY_PARAMS = {
    "radarr": {"includeMovie": True},
    "sonarr": {"includeSeries": True, "includeEpisode": True},
}


NOUNS = {"radarr": "movies", "sonarr": "episodes"}


@dataclass
class Event:
    """One thing worth telling the user about."""

    key: str  # entry in EVENT_LABELS, or "test"
    app: str  # "radarr" | "sonarr"
    title: str  # "The Bear S03E04 – Violet"
    url: str = "/"  # in-app route opened when the notification is tapped
    group: str = ""  # events sharing this are merged into one notification
    group_title: str = ""  # heading for the merged notification, when there is one
    label: str = ""  # overrides EVENT_LABELS (health messages carry their own)
    # the arr tag ids on the movie/series. None means "not a media event"
    # (health, test) and is never filtered out by a tag rule.
    tags: list[int] | None = None

    def __post_init__(self) -> None:
        if not self.group:
            self.group = f"{self.app}:{self.key}"
        if not self.label:
            self.label = EVENT_LABELS.get(self.key, self.key)

    @property
    def dedupe_key(self) -> str:
        return hashlib.sha256(f"{self.app}|{self.key}|{self.title}".encode()).hexdigest()

    @property
    def tag(self) -> str:
        """iOS/Android replace a banner carrying a tag it already shows."""
        return f"arrdeck:{self.group}"


def enabled_events(db: SettingsDB) -> list[str]:
    raw = db.kv_get(EVENTS_KEY)
    if raw is None:
        return list(DEFAULT_EVENTS)
    try:
        stored = json.loads(raw)
    except ValueError:
        return list(DEFAULT_EVENTS)
    return [k for k in EVENT_LABELS if k in stored]


def set_enabled_events(db: SettingsDB, keys: list[str]) -> list[str]:
    chosen = [k for k in EVENT_LABELS if k in keys]
    db.kv_set(EVENTS_KEY, json.dumps(chosen))
    return chosen


DEFAULT_RULES = {
    "quiet_start": "",  # "HH:MM"; empty (or equal to quiet_end) disables quiet hours
    "quiet_end": "",
    "timezone": "UTC",  # the container runs UTC, so the browser supplies its own
    "tags": {"radarr": [], "sonarr": []},  # empty = every item; ids are per app
}


def get_rules(db: SettingsDB) -> dict:
    raw = db.kv_get(RULES_KEY)
    rules = dict(DEFAULT_RULES)
    rules["tags"] = {"radarr": [], "sonarr": []}
    if not raw:
        return rules
    try:
        stored = json.loads(raw)
    except ValueError:
        return rules
    if not isinstance(stored, dict):
        return rules
    for key in ("quiet_start", "quiet_end", "timezone"):
        if isinstance(stored.get(key), str):
            rules[key] = stored[key]
    tags = stored.get("tags")
    if isinstance(tags, dict):
        for app_name in ("radarr", "sonarr"):
            value = tags.get(app_name)
            if isinstance(value, list):
                rules["tags"][app_name] = [t for t in value if isinstance(t, int)]
    return rules


def set_rules(db: SettingsDB, rules: dict) -> dict:
    db.kv_set(RULES_KEY, json.dumps(rules))
    return get_rules(db)


def _parse_hhmm(value: str) -> int | None:
    """"23:00" -> minutes since midnight, or None when unusable."""
    parts = value.split(":")
    if len(parts) != 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        return None
    return hours * 60 + minutes


def in_quiet_hours(rules: dict, now: datetime | None = None) -> bool:
    start = _parse_hhmm(rules.get("quiet_start") or "")
    end = _parse_hhmm(rules.get("quiet_end") or "")
    if start is None or end is None or start == end:
        return False
    if now is None:
        try:
            tz = ZoneInfo(rules.get("timezone") or "UTC")
        except (ZoneInfoNotFoundError, ValueError):
            tz = ZoneInfo("UTC")
        now = datetime.now(tz)
    minute = now.hour * 60 + now.minute
    if start < end:
        return start <= minute < end
    # the window crosses midnight, which is the usual case for "quiet at night"
    return minute >= start or minute < end


def passes_rules(rules: dict, event: "Event") -> bool:
    if event.key == "test":
        return True
    if in_quiet_hours(rules):
        return False
    wanted = (rules.get("tags") or {}).get(event.app) or []
    if wanted and event.tags is not None:
        return bool(set(wanted) & set(event.tags))
    return True


def wants_event(db: SettingsDB, key: str) -> bool:
    """True when at least one subscribed device asked for this event."""
    if key == "test":
        return True
    default = enabled_events(db)
    for _raw, events in db.push_targets():
        if key in (default if events is None else events):
            return True
    return False
