"""Where events come from: arr webhooks, and the history poller fallback."""

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

from .events import Event, HISTORY_EVENTS, HISTORY_PARAMS, WEBHOOK_EVENTS, WEBHOOK_SEEN_KEY, logger
from .pipeline import notify


CHECK_INTERVAL = 60


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
            tags=movie.get("tags") or [],
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
        tags=series.get("tags") or [],
    )


async def handle_webhook(db: SettingsDB, app_name: str, payload: dict) -> bool:
    db.kv_set(WEBHOOK_SEEN_KEY, str(int(time.time())))
    event = webhook_event(app_name, payload)
    if event is None:
        return False
    return await notify(db, event)


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
            tags=(rec.get("movie") or {}).get("tags") or [],
        )
    series_id = rec.get("seriesId")
    return Event(
        key=key,
        app=app_name,
        title=title,
        url=f"/series/{series_id}" if series_id else "/history",
        group=f"sonarr:{key}:{series_id}",
        group_title=(rec.get("series") or {}).get("title") or "",
        tags=(rec.get("series") or {}).get("tags") or [],
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
