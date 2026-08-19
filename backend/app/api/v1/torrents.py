"""Torrent clients: the list, its server-side filtering, and the tracker
resolution that turns an announce host into the indexer it came from."""

from collections import deque

import asyncio
import functools
import time
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request
from ...cache import cache, cached, guarded
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

router = APIRouter(tags=["torrents"])

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
                uploaded=t.get("uploaded", 0),
                added_on=t.get("added_on"),
                tracker=resolve(
                    _tracker_host(t.get("tracker")), t.get("hash", "").upper()
                ),
                # qBittorrent sends tags as one comma-separated string
                tags=[x.strip() for x in (t.get("tags") or "").split(",") if x.strip()],
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
                uploaded=t.get("uploadedEver", 0),
                added_on=t.get("addedDate"),
                tracker=resolve(
                    _tracker_host((t.get("trackers") or [{}])[0].get("announce")),
                    (t.get("hashString") or "").upper(),
                ),
                error=error,
            ).model_dump()
        )
    return out


# Rolling window so the dashboard's transfer speeds don't jitter with each
# poll. Module-level state, so it has to live beside the function using it.
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


def _compare(a: dict, b: dict, key: str) -> int:
    va, vb = a.get(key), b.get(key)
    if va is None and vb is None:
        return 0
    if va is None:
        return 1
    if vb is None:
        return -1
    if isinstance(va, str) and isinstance(vb, str):
        fa, fb = va.casefold(), vb.casefold()
        return (fa > fb) - (fa < fb)
    fa, fb = float(va), float(vb)
    return (fa > fb) - (fa < fb)


def _sorted_rows(rows: list[dict], key: str, direction: str) -> list[dict]:
    sign = -1 if direction == "desc" else 1

    def cmp(a: dict, b: dict) -> int:
        base = _compare(a, b, key)
        if a.get(key) is None or b.get(key) is None:
            return base  # direction must not move nulls off the end
        return base * sign

    return sorted(rows, key=functools.cmp_to_key(cmp))


def _select(rows: list[dict], q: str, state: str, sort: str, direction: str, limit: int) -> dict:
    """Filter, sort and cap one client's torrents.

    Each client is capped independently and the client merges the two lists, which
    is still globally correct: an item in the overall top N must also be in its own
    client's top N.
    """
    states = sorted({r.get("state", "") for r in rows if r.get("state")})
    needle = q.strip().casefold()
    matched = [
        r
        for r in rows
        if (not state or state == "all" or r.get("state") == state)
        and (not needle or needle in (r.get("name") or "").casefold())
    ]
    matched = _sorted_rows(matched, sort, direction)
    return {
        "torrents": matched[: max(1, limit)],
        "total": len(matched),
        "states": states,
    }


@router.get("/torrents", response_model=TorrentsResponse)
async def torrents(
    q: str = "",
    state: str = "",
    sort: str = "added_on",
    dir: str = "desc",
    limit: int = 200,
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
            **_select(_qbit_torrents(items, resolve), q, state, sort, dir, limit),
            "totals": _averaged_totals(
                "qbittorrent",
                transfer.get("dl_info_speed", 0),
                transfer.get("up_info_speed", 0),
            ),
        }

    async def fetch_tm() -> dict:
        items, stats = await asyncio.gather(transmission.torrents(), transmission.session_stats())
        return {
            **_select(_tm_torrents(items, resolve), q, state, sort, dir, limit),
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
