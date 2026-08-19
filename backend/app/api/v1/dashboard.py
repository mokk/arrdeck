import asyncio
import re
import time
from collections import deque
from datetime import date, timedelta
from typing import Any, Callable, Coroutine
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Request

from ...cache import cache
from ...clients.base import ServiceUnavailable
from ...registry import probe_version
from .media import _poster
from ...clients.prowlarr import ProwlarrClient
from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...clients.transmission import TransmissionClient
from ...deps import get_prowlarr, get_qbit, get_radarr, get_sonarr, get_transmission
from ...schemas import (
    CalendarItemOut,
    DiskSpaceOut,
    HealthWarningOut,
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


async def guarded(coro: Coroutine, cache_key: str | None = None):
    """Run an upstream call; on failure return ok=false, falling back to the
    last good cached value if one exists."""
    try:
        data = await coro
        if cache_key:
            cache.set(cache_key, data)
        return ServiceBlock(ok=True, data=data)
    except ServiceUnavailable as exc:
        stale = cache.get_stale(cache_key) if cache_key else None
        if stale:
            age, value = stale
            return ServiceBlock(ok=False, error=exc.message, data=value, stale_age_seconds=age)
        return ServiceBlock(ok=False, error=exc.message)
    except Exception as exc:  # noqa: BLE001 — aggregates must never 500
        return ServiceBlock(ok=False, error=str(exc))


async def cached(key: str, ttl: float, fetch: Callable[[], Coroutine]) -> Any:
    hit = cache.get(key, ttl)
    if hit is not None:
        return hit
    data = await fetch()
    cache.set(key, data)
    return data


@router.get("/status", response_model=list[ServiceStatus])
async def status(request: Request) -> list[ServiceStatus]:
    registry = request.app.state.registry
    names = registry.configured()

    async def probe(name: str) -> ServiceStatus:
        try:
            version = await probe_version(name, registry.get(name))
            return ServiceStatus(service=name, ok=True, version=version)
        except ServiceUnavailable as exc:
            return ServiceStatus(service=name, ok=False, error=exc.message)
        except Exception as exc:  # noqa: BLE001
            return ServiceStatus(service=name, ok=False, error=str(exc))

    return list(await asyncio.gather(*(probe(n) for n in names)))


@router.get("/diskspace", response_model=ServiceBlock[list[DiskSpaceOut]])
async def diskspace(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    """Free space where the library actually lives.

    Built from root folders rather than /diskspace: inside Docker the arrs only
    report their own container root there, which is a different (and much
    smaller) disk than the bind-mounted media volume. /diskspace is still used
    to fill in a total when one of its mounts matches a root folder exactly,
    since root folders don't carry one.
    """

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            results = await asyncio.gather(
                radarr.root_folders(),
                sonarr.root_folders(),
                radarr.diskspace(),
                sonarr.diskspace(),
                return_exceptions=True,
            )
            roots, mounts = results[:2], results[2:]
            totals: dict[str, int] = {}
            for result in mounts:
                if isinstance(result, BaseException):
                    continue
                for entry in result:
                    if entry.get("path"):
                        totals[entry["path"]] = entry.get("totalSpace", 0)

            merged: dict[str, dict] = {}
            for app, result in zip(("radarr", "sonarr"), roots):
                if isinstance(result, BaseException):
                    continue
                for entry in result:
                    path = entry.get("path") or ""
                    if not path or path in merged:
                        continue
                    merged[path] = {
                        "path": path,
                        "label": app,
                        "free_bytes": entry.get("freeSpace") or 0,
                        "total_bytes": totals.get(path, 0),
                    }
            if not merged:
                raise ServiceUnavailable("radarr", "no root folders")
            return sorted(merged.values(), key=lambda d: d["path"])

        return await cached("diskspace", 300, call)

    return await guarded(fetch(), "diskspace:block")


@router.get("/health", response_model=ServiceBlock[list[HealthWarningOut]])
async def health(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    """Radarr and Sonarr's own health checks. Prowlarr's are already shown on
    the indexer card, so they're deliberately left out of this list."""

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            results = await asyncio.gather(
                radarr.health(), sonarr.health(), return_exceptions=True
            )
            warnings: list[dict] = []
            for app, result in zip(("radarr", "sonarr"), results):
                if isinstance(result, BaseException):
                    continue
                for entry in result:
                    # "a newer version exists" is permanent and not actionable
                    # from here; leaving it in would make the card always-on,
                    # which is how a warning card stops being read
                    if entry.get("source") == "UpdateCheck":
                        continue
                    warnings.append(
                        {
                            "app": app,
                            "level": entry.get("type") or "warning",
                            "message": entry.get("message") or "",
                            "wiki_url": entry.get("wikiUrl"),
                            "source": entry.get("source"),
                        }
                    )
            # errors first, so the worst thing is the first thing read
            warnings.sort(key=lambda w: (w["level"] != "error", w["app"]))
            return warnings

        return await cached("health", 120, call)

    return await guarded(fetch(), "health:block")


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


def _tracker_host(url: str | None) -> str | None:
    if not url:
        return None
    host = urlparse(url).hostname
    if host and host.startswith(("tracker.", "www.")):
        host = host.split(".", 1)[1]
    return host


def _qbit_torrents(torrents: list, resolve) -> list[dict]:
    out = []
    for t in torrents:
        eta = t.get("eta")
        out.append(
            TorrentOut(
                client="qbittorrent",
                id=t.get("hash", ""),
                name=t.get("name", ""),
                state=QBIT_STATE_MAP.get(t.get("state", ""), t.get("state", "unknown")),
                progress=t.get("progress", 0.0),
                size=t.get("size", 0),
                dl_speed=t.get("dlspeed", 0),
                ul_speed=t.get("upspeed", 0),
                eta=None if eta in (None, 8640000) else eta,
                ratio=t.get("ratio"),
                added_on=t.get("added_on"),
                tracker=resolve(
                    _tracker_host(t.get("tracker")), t.get("hash", "").upper()
                ),
            ).model_dump()
        )
    return out


def _tm_torrents(torrents: list, resolve) -> list[dict]:
    out = []
    for t in torrents:
        eta = t.get("eta", -1)
        error = t.get("errorString") or None
        out.append(
            TorrentOut(
                client="transmission",
                id=str(t.get("id")),
                name=t.get("name", ""),
                state="error" if error else TM_STATUS_MAP.get(t.get("status"), "unknown"),
                progress=t.get("percentDone", 0.0),
                size=t.get("totalSize", 0),
                dl_speed=t.get("rateDownload", 0),
                ul_speed=t.get("rateUpload", 0),
                eta=eta if eta and eta > 0 else None,
                ratio=t.get("uploadRatio"),
                added_on=t.get("addedDate"),
                tracker=resolve(
                    _tracker_host((t.get("trackers") or [{}])[0].get("announce")),
                    (t.get("hashString") or "").upper(),
                ),
                error=error,
            ).model_dump()
        )
    return out


# Rolling window of transfer-speed samples per client. Instantaneous speeds
# bounce around a lot; the dashboard polls every ~5s, so averaging the last
# minute of samples smooths the totals.
SPEED_WINDOW_SECONDS = 60.0
_speed_samples: dict[str, deque] = {"qbittorrent": deque(), "transmission": deque()}


def _averaged_totals(client: str, dl_speed: int, ul_speed: int) -> dict:
    now = time.monotonic()
    samples = _speed_samples[client]
    samples.append((now, dl_speed, ul_speed))
    while samples and now - samples[0][0] > SPEED_WINDOW_SECONDS:
        samples.popleft()
    count = len(samples)
    return {
        "dl_speed": sum(s[1] for s in samples) // count,
        "ul_speed": sum(s[2] for s in samples) // count,
    }


def _registered_domain(host: str) -> str:
    return ".".join(host.split(".")[-2:])


async def _indexer_name_map(prowlarr: ProwlarrClient) -> dict[str, str]:
    """Map registered tracker domains to Prowlarr indexer names, using each
    indexer's known site/mirror URLs. Empty map if Prowlarr is unreachable."""

    async def call() -> dict[str, str]:
        mapping: dict[str, str] = {}
        for idx in await prowlarr.indexers():
            for url in (idx.get("indexerUrls") or []) + (idx.get("legacyUrls") or []):
                host = urlparse(url).hostname
                if host:
                    mapping[_registered_domain(host)] = idx["name"]
        return mapping

    try:
        return await cached("tracker:indexer_map", 300, call)
    except Exception:  # noqa: BLE001 — mapping is cosmetic, never break torrents
        return {}


async def _history_indexer_map(radarr: RadarrClient, sonarr: SonarrClient) -> dict[str, str]:
    """Map torrent hashes to Prowlarr indexer names via arr 'grabbed' history
    events — exact where available, unlike domain matching."""

    async def call() -> dict[str, str]:
        mapping: dict[str, str] = {}
        for client in (radarr, sonarr):
            try:
                payload = await client.history(page_size=500)
            except Exception:  # noqa: BLE001 — one app down shouldn't kill the map
                continue
            for rec in payload.get("records", []):
                download_id = (rec.get("downloadId") or "").upper()
                indexer = (rec.get("data") or {}).get("indexer")
                if download_id and indexer:
                    mapping[download_id] = indexer.removesuffix(" (Prowlarr)")
        return mapping

    try:
        return await cached("tracker:history_map", 300, call)
    except Exception:  # noqa: BLE001
        return {}


@router.get("/torrents", response_model=TorrentsResponse)
async def torrents(
    qbit: QbittorrentClient = Depends(get_qbit),
    transmission: TransmissionClient = Depends(get_transmission),
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    domain_map, hash_map = await asyncio.gather(
        _indexer_name_map(prowlarr), _history_indexer_map(radarr, sonarr)
    )
    # domains learned from hash matches persist for torrents whose grab
    # history has since been purged
    stale = cache.get_stale("tracker:learned_domains")
    learned: dict[str, str] = dict(stale[1]) if stale else {}

    def resolve(host: str | None, torrent_hash: str) -> str | None:
        name = hash_map.get(torrent_hash)
        if name:
            if host:
                learned[_registered_domain(host)] = name
            return name
        if not host:
            return None
        reg = _registered_domain(host)
        return domain_map.get(reg) or learned.get(reg) or host

    async def fetch_qbit() -> dict:
        items, transfer = await asyncio.gather(qbit.torrents(), qbit.transfer_info())
        return {
            "torrents": _qbit_torrents(items, resolve),
            "totals": _averaged_totals(
                "qbittorrent",
                transfer.get("dl_info_speed", 0),
                transfer.get("up_info_speed", 0),
            ),
        }

    async def fetch_tm() -> dict:
        items, stats = await asyncio.gather(transmission.torrents(), transmission.session_stats())
        return {
            "torrents": _tm_torrents(items, resolve),
            "totals": _averaged_totals(
                "transmission",
                stats.get("downloadSpeed", 0),
                stats.get("uploadSpeed", 0),
            ),
        }

    q, t = await asyncio.gather(
        guarded(fetch_qbit(), "torrents:qbit"), guarded(fetch_tm(), "torrents:tm")
    )
    cache.set("tracker:learned_domains", learned)
    return {"qbittorrent": q, "transmission": t}


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


@router.get("/torrents/summary", response_model=TorrentsSummaryResponse)
async def torrents_summary(
    qbit: QbittorrentClient = Depends(get_qbit),
    transmission: TransmissionClient = Depends(get_transmission),
):
    """Lightweight dashboard feed: totals + top active only, ~1% the payload
    of the full torrent list."""
    passthrough = lambda host, _hash: host  # noqa: E731 — no indexer mapping here

    def summarize(client: str, mapped: list[dict], dl: int, ul: int) -> dict:
        active = [
            t for t in mapped
            if t["state"] == "downloading" or t["dl_speed"] > 0 or t["ul_speed"] > 0
        ]
        active.sort(key=lambda t: -(t["dl_speed"] + t["ul_speed"]))
        return {
            "totals": _averaged_totals(client, dl, ul),
            "count": len(mapped),
            "active_count": len(active),
            "active": active[:5],
        }

    async def fetch_qbit() -> dict:
        items, transfer = await asyncio.gather(qbit.torrents(), qbit.transfer_info())
        return summarize(
            "qbittorrent",
            _qbit_torrents(items, passthrough),
            transfer.get("dl_info_speed", 0),
            transfer.get("up_info_speed", 0),
        )

    async def fetch_tm() -> dict:
        items, stats = await asyncio.gather(transmission.torrents(), transmission.session_stats())
        return summarize(
            "transmission",
            _tm_torrents(items, passthrough),
            stats.get("downloadSpeed", 0),
            stats.get("uploadSpeed", 0),
        )

    q, t = await asyncio.gather(
        guarded(fetch_qbit(), "torrents:sum:qbit"), guarded(fetch_tm(), "torrents:sum:tm")
    )
    return {"qbittorrent": q, "transmission": t}


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
