"""The weekly digest: what arrived in the last seven days and what is due in
the next seven, as one notification at the day and time chosen in the push
rules. It is an event like the others ("digest"), so it is switched off the
same way — per device or for everyone."""

import asyncio
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from ..clients.base import ServiceUnavailable
from ..db import SettingsDB
from ..registry import Registry
from .delivery import _send_all
from .events import Event, _parse_hhmm, get_rules, logger, wants_event
from .pipeline import Notification

LAST_KEY = "digest_last"
CHECK_INTERVAL = 300
# a slot is only sent this long after it passed — arrdeck starting up on a
# Wednesday should not announce Sunday's digest
GRACE = timedelta(hours=6)
WEEK = timedelta(days=7)
IMPORTED = {
    "radarr": "downloadFolderImported",
    "sonarr": "downloadFolderImported",
    "readarr": "bookFileImported",
    "lidarr": "trackFileImported",
}
APPS = ("radarr", "sonarr", "readarr")
# Counted only when configured, so a digest from a stack without Lidarr
# carries exactly the parameters it always has.
OPTIONAL_APPS = ("lidarr",)
HEADLINE_TITLES = 3


def _zone(rules: dict) -> ZoneInfo:
    try:
        return ZoneInfo(rules.get("timezone") or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def latest_slot(rules: dict, now: datetime) -> datetime:
    """The most recent digest time at or before `now`, in the rules' zone."""
    local = now.astimezone(_zone(rules))
    minutes = _parse_hhmm(rules.get("digest_time") or "") or 18 * 60
    day = rules.get("digest_day", 6)
    slot = local.replace(hour=minutes // 60, minute=minutes % 60, second=0, microsecond=0)
    slot -= timedelta(days=(local.weekday() - day) % 7)
    if slot > local:
        slot -= WEEK
    return slot


def due_slot(rules: dict, now: datetime, last_sent: float) -> datetime | None:
    slot = latest_slot(rules, now)
    if slot.timestamp() <= last_sent or now - slot > GRACE:
        return None
    return slot


def _imported(app: str, records: list) -> int:
    imported = [r for r in records if r.get("eventType") == IMPORTED[app]]
    if app == "lidarr":
        # Lidarr records each track; the digest counts albums
        return len({r.get("albumId") for r in imported})
    return len(imported)


def _apps(history: dict, upcoming: dict) -> list[str]:
    return [*APPS, *(a for a in OPTIONAL_APPS if a in history or a in upcoming)]


def summarise(history: dict[str, list], upcoming: dict[str, list]) -> dict:
    """Counts per app, and the first few titles coming up for the heading."""
    apps = _apps(history, upcoming)
    params = {f"{app}_imported": _imported(app, history.get(app, [])) for app in apps}
    for app in apps:
        params[f"{app}_upcoming"] = len(upcoming.get(app, []))
    titles: list[str] = []
    for app in ("sonarr", "radarr", "readarr", "lidarr"):
        for item in upcoming.get(app, []):
            title = (item.get("series") or {}).get("title") or item.get("title") or ""
            if title and title not in titles:
                titles.append(title)
    params["titles"] = titles[:HEADLINE_TITLES]
    return params


def _counts(params: dict, suffix: str) -> str:
    nouns = {
        "radarr": ("movie", "movies"),
        "sonarr": ("episode", "episodes"),
        "readarr": ("book", "books"),
        "lidarr": ("album", "albums"),
    }
    parts = []
    for app in (*APPS, *OPTIONAL_APPS):
        n = params.get(f"{app}_{suffix}", 0)
        if n:
            parts.append(f"{n} {nouns[app][0] if n == 1 else nouns[app][1]}")
    return ", ".join(parts)


def digest_note(params: dict) -> Notification | None:
    """None when the week had nothing either way — no point in a banner."""
    arrived, coming = _counts(params, "imported"), _counts(params, "upcoming")
    if not arrived and not coming:
        return None
    body = " · ".join(
        p for p in (arrived and f"{arrived} downloaded", coming and f"{coming} coming up") if p
    )
    total = sum(params.get(f"{app}_imported", 0) for app in (*APPS, *OPTIONAL_APPS))
    heading = ", ".join(params.get("titles") or [])
    return Notification(
        code="digest",
        count=total,
        app="arrdeck",
        heading=heading,
        title="Your week",
        body=body,
        params={k: v for k, v in params.items() if k != "titles"},
    )


async def gather(registry: Registry, now: datetime) -> dict:
    since = (now - WEEK).astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    start = now.astimezone(UTC).strftime("%Y-%m-%d")
    end = (now + WEEK).astimezone(UTC).strftime("%Y-%m-%d")

    async def one(app: str) -> tuple[list, list]:
        if not registry.is_configured(app):
            return [], []
        client = registry.get(app)
        try:
            history, upcoming = await asyncio.gather(
                client.history_since(since), client.calendar(start, end)
            )
        except (ServiceUnavailable, httpx.HTTPError):  # one arr down still leaves a digest
            logger.warning("digest: %s unavailable", app)
            return [], []
        return history or [], upcoming or []

    apps = [*APPS, *(a for a in OPTIONAL_APPS if registry.is_configured(a))]
    results = dict(zip(apps, await asyncio.gather(*(one(a) for a in apps)), strict=True))
    return summarise({a: r[0] for a, r in results.items()}, {a: r[1] for a, r in results.items()})


async def send_digest(db: SettingsDB, registry: Registry, endpoint: str = "") -> int:
    note = digest_note(await gather(registry, datetime.now(UTC)))
    if note is None:
        return 0
    event = Event(key="digest", app="arrdeck", title=note.title, url="/calendar")
    return await asyncio.to_thread(_send_all, db, note, event.url, event.tag, "digest", endpoint)


async def digest_loop(db: SettingsDB, registry: Registry) -> None:
    while True:
        try:
            if db.push_all() and wants_event(db, "digest"):
                last = float(db.kv_get(LAST_KEY) or 0)
                slot = due_slot(get_rules(db), datetime.now(UTC), last)
                if slot is not None:
                    # marked first: a failing arr must not make it resend every five minutes
                    db.kv_set(LAST_KEY, str(slot.timestamp()))
                    await send_digest(db, registry)
        except Exception:  # noqa: BLE001 — the notifier must never die
            logger.exception("digest failed")
        await asyncio.sleep(CHECK_INTERVAL)


__all__ = ["digest_loop", "digest_note", "due_slot", "latest_slot", "send_digest", "summarise"]
