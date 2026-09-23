"""The cleanup assistant: what could go to free disk space, and why.

Four lists over the film and show libraries: watched a while ago, never
watched after a long while, the largest, and the unmonitored still on disk.
The watch-based two need Plex. Nothing is deleted here; the client sends the
chosen ids to the libraries' bulk delete, with an import exclusion if asked.
"""

import asyncio
import time
from datetime import datetime

from fastapi import APIRouter, Depends, Request

from ...clients.plex import PlexClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_plex, get_radarr, get_sonarr
from ...schemas import CleanupOut
from .dashboard import _has
from .discover import _poster
from .plex import load_watched

router = APIRouter(tags=["library"])

LARGEST_LIMIT = 25
DAY = 86_400


def cleanup_row(kind: str, item: dict, watched: dict | None) -> dict:
    size = (
        item.get("sizeOnDisk", 0)
        if kind == "movie"
        else (item.get("statistics") or {}).get("sizeOnDisk", 0)
    )
    return {
        "kind": kind,
        "id": item["id"],
        "title": item.get("title"),
        "year": item.get("year"),
        "poster": _poster(item.get("images")),
        "size": size or 0,
        "added": item.get("added"),
        "last_viewed_at": (watched or {}).get("last_viewed_at"),
        "monitored": item.get("monitored", False),
    }


def watched_entry(kind: str, item: dict, items: dict) -> dict | None:
    ids = (
        [f"tmdb:{item.get('tmdbId')}", f"imdb:{item.get('imdbId')}"]
        if kind == "movie"
        else [
            f"tvdb:{item.get('tvdbId')}",
            f"tmdb:{item.get('tmdbId')}",
            f"imdb:{item.get('imdbId')}",
        ]
    )
    return next((items[k] for k in ids if k in items), None)


def added_ts(row: dict) -> float | None:
    added = row.get("added")
    if not added:
        return None
    try:
        return datetime.fromisoformat(str(added).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def build_cleanup(
    movies: list[dict],
    series: list[dict],
    watched_items: dict | None,
    watched_days: int,
    never_days: int,
    now: float,
) -> dict:
    rows = []
    for kind, items in (("movie", movies), ("series", series)):
        for item in items:
            entry = watched_entry(kind, item, watched_items) if watched_items is not None else None
            row = cleanup_row(kind, item, entry)
            if row["size"] > 0:
                rows.append((row, entry))

    watched, never = [], []
    if watched_items is not None:
        for row, entry in rows:
            if not entry:
                continue  # Plex has never seen it: no basis to judge
            last = entry.get("last_viewed_at")
            if entry.get("watched") and last and now - last > watched_days * DAY:
                watched.append(row)
            added = added_ts(row)
            if not entry.get("progress") and added and now - added > never_days * DAY:
                never.append(row)
    watched.sort(key=lambda r: r["last_viewed_at"] or 0)
    never.sort(key=lambda r: added_ts(r) or 0)
    largest = sorted((r for r, _ in rows), key=lambda r: -r["size"])[:LARGEST_LIMIT]
    unmonitored = sorted((r for r, _ in rows if not r["monitored"]), key=lambda r: -r["size"])
    return {
        "plex": watched_items is not None,
        "watched": watched,
        "never_watched": never,
        "largest": largest,
        "unmonitored": unmonitored,
    }


@router.get("/cleanup", response_model=CleanupOut)
async def cleanup(
    request: Request,
    watched_days: int = 30,
    never_days: int = 365,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    plex: PlexClient = Depends(get_plex),
) -> dict:
    async def maybe(configured: bool, coro_fn):
        if not configured:
            return []
        try:
            return await coro_fn()
        except Exception:  # noqa: BLE001 — one library down still lists the other
            return []

    movies, series = await asyncio.gather(
        maybe(_has(request, "radarr"), radarr.movies),
        maybe(_has(request, "sonarr"), sonarr.series),
    )
    watched_items = None
    if _has(request, "plex"):
        try:
            watched_items = (await load_watched(plex)).get("items") or {}
        except Exception:  # noqa: BLE001 — without Plex the watch lists stay empty
            watched_items = None
    return build_cleanup(movies, series, watched_items, watched_days, never_days, time.time())
