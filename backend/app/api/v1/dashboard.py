import asyncio
import functools
import re
import time
from datetime import date, timedelta
from typing import Any, Callable, Coroutine
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request

from ...cache import cache, cached, guarded
from ...clients.base import ServiceUnavailable
from ...registry import probe_version
from .media import _poster
from ...clients.bazarr import BazarrClient
from ...clients.gluetun import GluetunClient
from ...clients.plex import PlexClient
from ...clients.prowlarr import ProwlarrClient
from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...clients.transmission import TransmissionClient
from ...deps import (
    get_bazarr,
    get_gluetun,
    get_plex,
    get_prowlarr,
    get_qbit,
    get_radarr,
    get_sonarr,
    get_transmission,
)
from ...schemas import (
    CalendarItemOut,
    DiskSpaceOut,
    HealthWarningOut,
    PlaySessionOut,
    SubtitleSearchIn,
    WatchedItemOut,
    SubtitlesOut,
    VpnStatusOut,
    CalendarResponse,
    HistoryPageOut,
    HistoryResponse,
    IndexerStatsOut,
    QueueResponse,
    RecentItemOut,
    TorrentsSummaryResponse,
    TorrentsResponse,
    HistoryItemOut,
    QueueItemOut,
    ServiceBlock,
    ServiceStatus,
    TorrentOut,
)

router = APIRouter(tags=["dashboard"])

QBIT_STATE_MAP = {
    "downloading": "downloading",
    "forcedDL": "downloading",
    "metaDL": "downloading",
    "stalledDL": "stalled",
    "uploading": "seeding",
    "forcedUP": "seeding",
    "stalledUP": "seeding",
    "pausedDL": "paused",
    "stoppedDL": "paused",
    "pausedUP": "completed",
    "stoppedUP": "completed",
    "queuedDL": "queued",
    "queuedUP": "queued",
    "checkingDL": "checking",
    "checkingUP": "checking",
    "checkingResumeData": "checking",
    "moving": "checking",
    "error": "error",
    "missingFiles": "error",
}

TM_STATUS_MAP = {0: "paused", 1: "queued", 2: "checking", 3: "queued", 4: "downloading", 5: "queued", 6: "seeding"}


def release_info(movie: dict, start: str, end: str) -> tuple[str | None, str | None]:
    """Pick the movie's upcoming release date within [start, end]. Physical/disc
    dates are deliberately ignored; no fallback to out-of-window dates."""
    candidates = [
        (movie.get("inCinemas"), "cinema"),
        (movie.get("digitalRelease"), "digital"),
    ]
    dated = [(d, kind) for d, kind in candidates if d]
    in_window = [(d, kind) for d, kind in dated if start <= d[:10] <= end]
    return min(in_window) if in_window else (None, None)


def _queue_items(app: str, payload: dict) -> list[QueueItemOut]:
    items = []
    for rec in payload.get("records", []):
        title = rec.get("title") or ""
        if app == "sonarr" and rec.get("series"):
            title = f"{rec['series'].get('title', '')} — {title}"
        errors = [m.get("messages", [""])[0] for m in rec.get("statusMessages", []) if m.get("messages")]
        items.append(
            QueueItemOut(
                app=app,
                id=rec.get("id", 0),
                title=title,
                status=rec.get("status", "unknown"),
                tracked_state=rec.get("trackedDownloadState"),
                tracked_status=rec.get("trackedDownloadStatus"),
                size=rec.get("size", 0),
                size_left=rec.get("sizeleft", 0),
                time_left=rec.get("timeleft"),
                errors=errors,
                movie_id=rec.get("movieId"),
                series_id=rec.get("seriesId"),
                episode_id=rec.get("episodeId"),
            )
        )
    return items


@router.get("/queue", response_model=QueueResponse)
async def queue(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    async def fetch(app: str, client) -> list[dict]:
        return [i.model_dump() for i in _queue_items(app, await client.queue())]

    r, s = await asyncio.gather(
        guarded(fetch("radarr", radarr), "queue:radarr"),
        guarded(fetch("sonarr", sonarr), "queue:sonarr"),
    )
    return {"radarr": r, "sonarr": s}


# Rolling window of transfer-speed samples per client. Instantaneous speeds
# bounce around a lot; the dashboard polls every ~5s, so averaging the last
# minute of samples smooths the totals.


# Mirrors useSort's comparator exactly, so a server-limited page and the client's
# re-sort agree. Note nulls sort last in BOTH directions: the JS returns its
# null verdict before applying the direction flip, so a plain reverse=True here
# would surface them first.


@router.get("/calendar", response_model=CalendarResponse)
async def calendar(
    days: int = 14,
    start_date: str | None = None,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    base = date.fromisoformat(start_date) if start_date else date.today()
    start = base.isoformat()
    end = (base + timedelta(days=days)).isoformat()

    async def fetch_radarr() -> list[dict]:
        async def call():
            return await radarr.calendar(start, end)

        items = await cached(f"calendar:radarr:{start}:{end}", 60, call)
        out = []
        for m in items:
            picked_date, picked_type = release_info(m, start, end)
            if picked_date is None:
                continue  # physical-only release in this window
            out.append(
                CalendarItemOut(
                    app="radarr",
                    title=m.get("title", ""),
                    date=picked_date,
                    release_type=picked_type,
                    has_file=m.get("hasFile", False),
                ).model_dump()
            )
        return out

    async def fetch_sonarr() -> list[dict]:
        async def call():
            return await sonarr.calendar(start, end)

        items = await cached(f"calendar:sonarr:{start}:{end}", 60, call)
        return [
            CalendarItemOut(
                app="sonarr",
                title=(e.get("series") or {}).get("title", ""),
                date=e.get("airDateUtc"),
                has_file=e.get("hasFile", False),
                extra=f"S{e.get('seasonNumber', 0):02d}E{e.get('episodeNumber', 0):02d} {e.get('title', '')}",
            ).model_dump()
            for e in items
        ]

    r, s = await asyncio.gather(
        guarded(fetch_radarr(), "calendar:radarr"), guarded(fetch_sonarr(), "calendar:sonarr")
    )
    return {"radarr": r, "sonarr": s}


# Friendly labels for arr history eventTypes; unknown types pass through as-is.
EVENT_LABELS = {
    "grabbed": "fetched",
    "downloadFolderImported": "imported",
    "downloadFailed": "failed",
    "downloadIgnored": "ignored",
    "movieFileDeleted": "deleted",
    "episodeFileDeleted": "deleted",
    "movieFileRenamed": "renamed",
    "episodeFileRenamed": "renamed",
}


def _consolidate_history(app: str, payload: dict, limit: int = 15) -> list[dict]:
    """Group history records by torrent (downloadId, falling back to release
    title) so each release shows once with tags for everything that happened."""
    groups: dict[str, dict] = {}
    for rec in payload.get("records", []):
        key = rec.get("downloadId") or rec.get("sourceTitle") or str(rec.get("id"))
        date = rec.get("date", "")
        quality = ((rec.get("quality") or {}).get("quality") or {}).get("name")
        g = groups.setdefault(
            key,
            {
                "app": app,
                "title": "",
                "date": date,
                "quality": quality,
                "events": [],
                "movie_id": None,
                "series_id": None,
            },
        )
        g["movie_id"] = g["movie_id"] or rec.get("movieId")
        g["series_id"] = g["series_id"] or rec.get("seriesId")
        if not g["title"]:
            g["title"] = rec.get("sourceTitle") or ""
        g["date"] = max(g["date"], date)
        g["quality"] = g["quality"] or quality
        raw = rec.get("eventType", "")
        g["events"].append({"type": EVENT_LABELS.get(raw, raw), "date": date})

    result = sorted(groups.values(), key=lambda g: g["date"], reverse=True)[:limit]
    for g in result:
        # chronological tags, one per event type (keep each type's first occurrence)
        g["events"].sort(key=lambda e: e["date"])
        seen: set[str] = set()
        g["events"] = [
            e for e in g["events"] if not (e["type"] in seen or seen.add(e["type"]))
        ]
    return [HistoryItemOut(**g).model_dump() for g in result]


@router.get("/history", response_model=HistoryResponse)
async def history(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    async def fetch(app: str, client) -> list[dict]:
        payload = await client.history(page_size=50)
        return _consolidate_history(app, payload)

    r, s = await asyncio.gather(
        guarded(fetch("radarr", radarr), "history:radarr"),
        guarded(fetch("sonarr", sonarr), "history:sonarr"),
    )
    return {"radarr": r, "sonarr": s}


EPISODE_RE = re.compile(r"S(\d+)E(\d+)", re.IGNORECASE)


@router.get("/dashboard/recent", response_model=list[RecentItemOut])
async def recent(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    """Recently imported items, poster-enriched, newest first."""
    out: list[dict] = []
    try:
        movies = {m["id"]: m for m in await radarr.movies()}
        hist = await radarr.history(page_size=40)
        for rec in hist.get("records", []):
            movie = movies.get(rec.get("movieId"))
            if rec.get("eventType") == "downloadFolderImported" and movie:
                out.append(
                    {
                        "app": "radarr",
                        "title": movie.get("title", ""),
                        "subtitle": str(movie.get("year") or "") or None,
                        "date": rec.get("date", ""),
                        "poster": _poster(movie.get("images")),
                        "library_id": movie["id"],
                    }
                )
    except Exception:  # noqa: BLE001 — one app down shouldn't kill the strip
        pass
    try:
        series = {s["id"]: s for s in await sonarr.series()}
        hist = await sonarr.history(page_size=40)
        for rec in hist.get("records", []):
            show = series.get(rec.get("seriesId"))
            if rec.get("eventType") == "downloadFolderImported" and show:
                m = EPISODE_RE.search(rec.get("sourceTitle") or "")
                out.append(
                    {
                        "app": "sonarr",
                        "title": show.get("title", ""),
                        "subtitle": f"S{int(m.group(1)):02d}E{int(m.group(2)):02d}" if m else None,
                        "date": rec.get("date", ""),
                        "poster": _poster(show.get("images")),
                        "library_id": show["id"],
                    }
                )
    except Exception:  # noqa: BLE001
        pass
    # newest first, one entry per title
    out.sort(key=lambda r: r["date"], reverse=True)
    seen: set = set()
    deduped = []
    for r in out:
        key = (r["app"], r["library_id"])
        if key not in seen:
            seen.add(key)
            deduped.append(r)
    return deduped[:12]


@router.get("/history/all", response_model=HistoryPageOut)
async def history_all(
    page: int = 1,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    """Merged, consolidated history across both apps, paged 50/app."""
    items: list[dict] = []
    has_more = False
    for app, client in (("radarr", radarr), ("sonarr", sonarr)):
        try:
            payload = await client.history(page_size=50, page=page)
        except Exception:  # noqa: BLE001 — one app down shouldn't kill the page
            continue
        records = payload.get("records", [])
        if len(records) >= 50:
            has_more = True
        items.extend(_consolidate_history(app, payload, limit=100))
    items.sort(key=lambda h: h["date"], reverse=True)
    return {"items": items, "has_more": has_more}


@router.get("/indexers/stats", response_model=ServiceBlock[IndexerStatsOut])
async def indexer_stats(prowlarr: ProwlarrClient = Depends(get_prowlarr)):
    async def fetch() -> dict:
        async def call() -> dict:
            indexers, stats, health = await asyncio.gather(
                prowlarr.indexers(), prowlarr.indexer_stats(), prowlarr.health()
            )
            return {
                "enabled": sum(1 for i in indexers if i.get("enable")),
                "total": len(indexers),
                "health": [
                    {"type": h.get("type"), "message": h.get("message")} for h in health
                ],
                "stats": [
                    {
                        "name": s.get("indexerName"),
                        "queries": s.get("numberOfQueries", 0),
                        "grabs": s.get("numberOfGrabs", 0),
                        "avg_response_ms": s.get("averageResponseTime", 0),
                    }
                    for s in (stats.get("indexers") or [])
                ],
            }

        return await cached("indexers:stats", 300, call)

    return await guarded(fetch(), "indexers:block")
