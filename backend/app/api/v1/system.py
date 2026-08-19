"""Infrastructure health: service probes, disk space, VPN, arr warnings."""

import asyncio
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from ...cache import cache, cached, guarded
from ...clients.base import ServiceUnavailable
from ...registry import probe_version
from ...clients.gluetun import GluetunClient
from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
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

router = APIRouter(tags=["system"])

router = APIRouter(tags=["dashboard"])


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


@router.get("/vpn", response_model=ServiceBlock[VpnStatusOut])
async def vpn_status(
    gluetun: GluetunClient = Depends(get_gluetun),
    qbit: QbittorrentClient = Depends(get_qbit),
):
    """Tunnel state, exit IP, and whether qBittorrent is actually listening on
    the port the VPN forwarded — a mismatch is silently unconnectable."""

    async def fetch() -> dict:
        async def call() -> dict:
            status, ip, forward, prefs = await asyncio.gather(
                gluetun.status(),
                gluetun.public_ip(),
                gluetun.port_forward(),
                qbit.preferences(),
                return_exceptions=True,
            )
            if isinstance(status, BaseException):
                raise status
            ip = {} if isinstance(ip, BaseException) else ip
            forward = {} if isinstance(forward, BaseException) else forward
            prefs = {} if isinstance(prefs, BaseException) else prefs
            forwarded = forward.get("port") or None
            client_port = prefs.get("listen_port") or None
            return {
                "status": status.get("status", ""),
                "public_ip": ip.get("public_ip", ""),
                "country": ip.get("country"),
                "city": ip.get("city"),
                "forwarded_port": forwarded,
                "client_port": client_port,
                "port_matches": (
                    None if not forwarded or not client_port else forwarded == client_port
                ),
            }

        return await cached("vpn", 60, call)

    return await guarded(fetch(), "vpn:block")


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
