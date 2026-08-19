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

from py_vapid import Vapid, b64urlencode
from pywebpush import WebPushException, webpush

from .db import SettingsDB
from .registry import Registry

logger = logging.getLogger("arrdeck.push")

CHECK_INTERVAL = 60
# How long a coalescing group stays open for new members. A season pack lands as
# one webhook per episode file, spread over a few seconds.
COALESCE_WINDOW = 25
FLUSH_INTERVAL = 5
# A notification is suppressed when an identical one already went out this
# recently — the poller and the webhook both see the same import.
DEDUPE_TTL = 6 * 3600

# Apple's push service validates the JWT sub claim; "localhost" addresses get rejected.
VAPID_CLAIMS = {"sub": "mailto:arrdeck@thrawn.dk"}

EVENTS_KEY = "push_events"
WEBHOOK_SEEN_KEY = "webhook_last_seen"

# The user-facing catalogue, in display order.
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

# Arr webhook eventType -> event key. "Download" splits on isUpgrade.
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
# History eventType -> event key. History records carry no upgrade flag, so
# "upgraded" only ever arrives over a webhook.
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


def wants_event(db: SettingsDB, key: str) -> bool:
    """True when at least one subscribed device asked for this event."""
    if key == "test":
        return True
    default = enabled_events(db)
    for _raw, events in db.push_targets():
        if key in (default if events is None else events):
            return True
    return False


async def send_test(db: SettingsDB, endpoint: str = "") -> int:
    """Deliver a test banner, to one device when an endpoint is given."""
    event = Event(key="test", app="arrdeck", title="Test notification", url="/manage")
    return await asyncio.to_thread(
        _send_all, db, event.title, event.label, event.url, event.tag, "test", endpoint
    )


# --- VAPID ---------------------------------------------------------------


def ensure_vapid(db: SettingsDB) -> str:
    """Create/load the VAPID keypair; returns the base64url public key."""
    pem = db.kv_get("vapid_private_pem")
    if pem is None:
        vapid = Vapid()
        vapid.generate_keys()
        pem = vapid.private_pem().decode()
        db.kv_set("vapid_private_pem", pem)
    else:
        vapid = Vapid.from_pem(pem.encode())
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    raw = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return b64urlencode(raw)


def _private_key_b64(pem: str) -> str:
    # pywebpush's vapid_private_key only takes a file path or the raw
    # base64url-encoded key — handing it PEM content fails to deserialize.
    vapid = Vapid.from_pem(pem.encode())
    raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    return b64urlencode(raw)


def _send_all(
    db: SettingsDB,
    title: str,
    body: str,
    url: str,
    tag: str,
    event_key: str = "",
    only_endpoint: str = "",
) -> int:
    """Deliver to every subscription that wants this event; returns how many."""
    pem = db.kv_get("vapid_private_pem")
    if pem is None:
        return 0
    key = _private_key_b64(pem)
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    default = enabled_events(db)
    sent = 0
    for raw, events in db.push_targets():
        sub = json.loads(raw)
        if only_endpoint and sub.get("endpoint") != only_endpoint:
            continue
        # a device that hasn't chosen its own set follows the global default
        if event_key and event_key != "test":
            if event_key not in (default if events is None else events):
                continue
        try:
            webpush(sub, payload, vapid_private_key=key, vapid_claims=dict(VAPID_CLAIMS))
            sent += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):  # subscription expired
                db.push_remove(sub.get("endpoint", ""))
            else:
                logger.warning("push failed: %s", exc)
        except Exception:  # noqa: BLE001 — one bad subscription must not block the rest
            logger.exception("push failed for %s", sub.get("endpoint", ""))
    return sent


# --- coalescing ----------------------------------------------------------


@dataclass
class _Slot:
    event: Event
    due: float
    count: int = 1
    titles: list[str] = field(default_factory=list)


class Coalescer:
    """Holds events open for COALESCE_WINDOW seconds so bursts merge."""

    def __init__(self) -> None:
        self._pending: dict[str, _Slot] = {}
        self._lock = asyncio.Lock()

    async def add(self, event: Event, now: float) -> None:
        async with self._lock:
            slot = self._pending.get(event.group)
            if slot is None:
                # The window is anchored to the first member, so a long import
                # run flushes in steady batches instead of never settling.
                self._pending[event.group] = _Slot(
                    event=event, due=now + COALESCE_WINDOW, titles=[event.title]
                )
            else:
                slot.count += 1
                slot.titles.append(event.title)

    async def due(self, now: float) -> list[_Slot]:
        async with self._lock:
            ready = [g for g, slot in self._pending.items() if slot.due <= now]
            return [self._pending.pop(g) for g in ready]


COALESCER = Coalescer()


def render(slot: _Slot) -> tuple[str, str]:
    """Notification (title, body) for one flushed group."""
    event = slot.event
    if slot.count == 1:
        return event.title or event.label, event.label
    noun = NOUNS.get(event.app, "items")
    if event.group_title:
        return event.group_title, f"{event.label} · {slot.count} {noun}"
    return event.label, f"{slot.count} {noun}"


# --- the pipeline --------------------------------------------------------


async def notify(db: SettingsDB, event: Event) -> bool:
    """Queue an event for delivery. False when it was filtered or already sent."""
    if not db.push_all():
        return False
    if event.key == "test":  # always delivered: it exists to prove the wiring
        await asyncio.to_thread(
            _send_all, db, event.title, event.label, event.url, event.tag, "test"
        )
        return True
    if not wants_event(db, event.key):
        return False
    if not db.notified_add(event.dedupe_key, int(time.time()), DEDUPE_TTL):
        return False
    await COALESCER.add(event, time.monotonic())
    return True


async def flush_loop(db: SettingsDB) -> None:
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        try:
            for slot in await COALESCER.due(time.monotonic()):
                title, body = render(slot)
                await asyncio.to_thread(
                    _send_all, db, title, body, slot.event.url, slot.event.tag, slot.event.key
                )
        except Exception:  # noqa: BLE001 — the notifier must never die
            logger.exception("push flush failed")


# --- webhook source ------------------------------------------------------


def _episode_title(series: dict, episodes: list[dict]) -> str:
    name = series.get("title") or ""
    if not episodes:
        return name
    first = episodes[0]
    season, number = first.get("seasonNumber"), first.get("episodeNumber")
    if season is None or number is None:
        return name
    if len(episodes) > 1:
        return f"{name} S{season:02d} · {len(episodes)} episodes"
    label = f"{name} S{season:02d}E{number:02d}"
    return f"{label} – {first['title']}" if first.get("title") else label


def webhook_event(app_name: str, payload: dict) -> Event | None:
    """Translate an arr webhook body into an Event, or None if we ignore it."""
    raw = payload.get("eventType", "")
    if raw == "Test":
        return Event(key="test", app=app_name, title="Test notification", url="/manage")
    key = WEBHOOK_EVENTS.get(raw)
    if key is None:
        return None
    if key == "imported" and payload.get("isUpgrade"):
        key = "upgraded"

    if key == "health":
        message = payload.get("message") or ""
        restored = raw == "HealthRestored"
        return Event(
            key="health",
            app=app_name,
            title=message or app_name.title(),
            url="/manage",
            # distinct issues must not merge into a single "2 items" banner
            group=f"{app_name}:health:{hashlib.sha256(message.encode()).hexdigest()[:12]}",
            label="Health restored" if restored else f"{app_name.title()} health issue",
        )

    if app_name == "radarr":
        movie = payload.get("movie") or {}
        name, year, movie_id = movie.get("title"), movie.get("year"), movie.get("id")
        if not name:
            return None
        return Event(
            key=key,
            app=app_name,
            title=f"{name} ({year})" if year else name,
            url=f"/movie/{movie_id}" if movie_id else "/history",
            # per movie: two unrelated films share no tag, so neither banner
            # replaces the other before it has been read
            group=f"radarr:{key}:{movie_id}",
        )

    series = payload.get("series") or {}
    episodes = payload.get("episodes") or []
    title = _episode_title(series, episodes)
    if not title:
        return None
    series_id = series.get("id")
    return Event(
        key=key,
        app=app_name,
        title=title,
        url=f"/series/{series_id}" if series_id else "/history",
        # merge per series, so one show's season pack is one notification
        group=f"sonarr:{key}:{series_id}",
        group_title=series.get("title") or "",
    )


async def handle_webhook(db: SettingsDB, app_name: str, payload: dict) -> bool:
    db.kv_set(WEBHOOK_SEEN_KEY, str(int(time.time())))
    event = webhook_event(app_name, payload)
    if event is None:
        return False
    return await notify(db, event)


# --- history poller (fallback) -------------------------------------------


def describe_record(app_name: str, rec: dict) -> str:
    """Human title for a history record: movie name + year, or series + SxxEyy."""
    if app_name == "radarr":
        movie = rec.get("movie") or {}
        name = movie.get("title") or rec.get("sourceTitle") or ""
        year = movie.get("year")
        return f"{name} ({year})" if name and year else name
    series = rec.get("series") or {}
    episode = rec.get("episode") or {}
    name = series.get("title") or rec.get("sourceTitle") or ""
    season = episode.get("seasonNumber")
    number = episode.get("episodeNumber")
    if name and season is not None and number is not None:
        name = f"{name} S{season:02d}E{number:02d}"
        if episode.get("title"):
            name = f"{name} – {episode['title']}"
    return name


def history_event(app_name: str, rec: dict) -> Event | None:
    key = HISTORY_EVENTS.get(rec.get("eventType", ""))
    if key is None:
        return None
    title = describe_record(app_name, rec)
    if not title:
        return None
    if app_name == "radarr":
        movie_id = rec.get("movieId")
        return Event(
            key=key,
            app=app_name,
            title=title,
            url=f"/movie/{movie_id}" if movie_id else "/history",
            group=f"radarr:{key}:{movie_id}",
        )
    series_id = rec.get("seriesId")
    return Event(
        key=key,
        app=app_name,
        title=title,
        url=f"/series/{series_id}" if series_id else "/history",
        group=f"sonarr:{key}:{series_id}",
        group_title=(rec.get("series") or {}).get("title") or "",
    )


async def check_events(db: SettingsDB, registry: Registry) -> None:
    """Notify subscribers about new imports/failures since the last check."""
    if not db.push_all():
        return
    last_seen = db.kv_get("push_last_seen") or ""
    newest = last_seen
    for app_name in ("radarr", "sonarr"):
        if not registry.is_configured(app_name):
            continue
        try:
            hist = await registry.get(app_name).history(
                page_size=20, **HISTORY_PARAMS.get(app_name, {})
            )
        except Exception:  # noqa: BLE001
            continue
        for rec in hist.get("records", []):
            date = rec.get("date", "")
            if date > newest:
                newest = date
            if not last_seen or date <= last_seen:
                continue
            event = history_event(app_name, rec)
            if event is not None:
                await notify(db, event)
    if newest != last_seen:
        db.kv_set("push_last_seen", newest)


async def push_loop(db: SettingsDB, registry: Registry) -> None:
    while True:
        try:
            await check_events(db, registry)
        except Exception:  # noqa: BLE001 — the notifier must never die
            logger.exception("push check failed")
        await asyncio.sleep(CHECK_INTERVAL)
