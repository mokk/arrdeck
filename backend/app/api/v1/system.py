"""Infrastructure health: service probes, disk space, VPN, arr warnings."""

import asyncio

from fastapi import APIRouter, Depends, Request

from ...cache import cached, guarded
from ...clients.base import ServiceUnavailable, retry_count
from ...clients.gluetun import GluetunClient
from ...clients.prometheus import PrometheusClient
from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import (
    get_gluetun,
    get_prometheus,
    get_qbit,
    get_radarr,
    get_sonarr,
)
from ...registry import probe_version
from ...schemas import (
    DiskSpaceOut,
    HealthWarningOut,
    ServiceBlock,
    ServiceStatus,
    VpnStatusOut,
)

router = APIRouter(tags=["system"])


# Only the arrs publish a release feed with installed/latest flags.
UPDATE_APPS = ("radarr", "sonarr", "prowlarr")
# Checked once an hour, not once per poll: the arrs run their own
# ApplicationCheckUpdate task every six hours, so anything finer is wasted.
UPDATE_TTL = 3600


async def _pending_update(name: str, client) -> str | None:
    """The newest release the service knows about, if it is not the one running.

    The result is wrapped in a dict because `cached()` treats a bare None as a
    miss — caching "up to date" as None would re-check on every status poll,
    which is exactly the cost this cache exists to avoid.
    """

    async def call() -> dict:
        try:
            rows = await client.updates()
        except Exception:  # noqa: BLE001 — a missing feed is not a status failure
            return {"version": None}
        latest = next((r for r in rows if r.get("latest")), None)
        if not latest or latest.get("installed"):
            return {"version": None}
        return {"version": latest.get("version")}

    return (await cached(f"update:{name}", UPDATE_TTL, call))["version"]


@router.get("/status", response_model=list[ServiceStatus])
async def status(request: Request) -> list[ServiceStatus]:
    registry = request.app.state.registry
    names = registry.configured()

    async def probe(name: str) -> ServiceStatus:
        try:
            version = await probe_version(name, registry.get(name))
            pending = (
                await _pending_update(name, registry.get(name))
                if name in UPDATE_APPS
                else None
            )
            return ServiceStatus(
                service=name,
                ok=True,
                version=version,
                retries=retry_count(name),
                update_available=pending,
            )
        except ServiceUnavailable as exc:
            return ServiceStatus(
                service=name, ok=False, error=exc.message, retries=retry_count(name)
            )
        except Exception as exc:  # noqa: BLE001
            return ServiceStatus(
                service=name, ok=False, error=str(exc), retries=retry_count(name)
            )

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
            for app, result in zip(("radarr", "sonarr"), roots, strict=False):
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


# unpackerr publishes these as one metric family keyed by a name label
UNPACKERR_FAILURE_GAUGES = ("failed",)
UNPACKERR_FAILURE_COUNTERS = ("cmd_fail", "hook_fail")
# Counters are lifetime totals: a single blip during a restart would otherwise
# warn forever. Only a failure inside this window is worth surfacing.
FAILURE_WINDOW = "1h"

# Queue fetches are different from the other counters: host.docker.internal is
# Docker's NAT-ed route back to the host and stalls briefly under load, so
# unpackerr logs an occasional timeout — measured at seven in sixty hours — that
# recovers on its own within a couple of minutes. Warning on one of those means
# warning for an hour about something already fixed. Three in the window is a
# pattern; one is weather.
QUEUE_FETCH_THRESHOLD = 3


async def _unpackerr_warnings(prometheus: PrometheusClient) -> list[dict]:
    """Extraction problems. A download that completes and never imports is
    usually unpackerr failing quietly, which nothing else in arrdeck surfaces."""
    warnings: list[dict] = []
    gauges, counters, fetch_errors = await asyncio.gather(
        # a gauge is the current state, so it is read directly
        prometheus.scalars("unpackerr_gauges"),
        prometheus.scalars(f"increase(unpackerr_counters[{FAILURE_WINDOW}])"),
        # keyed by "app" (Radarr/Sonarr), not "name" like the gauge families —
        # using the wrong label collapses both series into one empty key
        prometheus.scalars(
            f"increase(unpackerr_app_queue_fetch_errors_total[{FAILURE_WINDOW}])", label="app"
        ),
        return_exceptions=True,
    )
    if isinstance(gauges, dict):
        for key in UNPACKERR_FAILURE_GAUGES:
            if gauges.get(key, 0) > 0:
                warnings.append({
                    "app": "unpackerr",
                    "level": "error",
                    "message": f"{int(gauges[key])} extraction(s) failed",
                    "source": "Unpackerr",
                })
    if isinstance(counters, dict):
        for key in UNPACKERR_FAILURE_COUNTERS:
            if counters.get(key, 0) >= 1:
                warnings.append({
                    "app": "unpackerr",
                    "level": "warning",
                    "message": f"{int(counters[key])} {key.replace('_', ' ')} in the last hour",
                    "source": "Unpackerr",
                })
    if isinstance(fetch_errors, dict):
        for app_name, count in sorted(fetch_errors.items()):
            if count >= QUEUE_FETCH_THRESHOLD:
                warnings.append({
                    "app": "unpackerr",
                    "level": "warning",
                    "message": (
                        f"cannot read {app_name or 'an arr'}'s queue "
                        f"({int(count)} errors in the last hour)"
                    ),
                    "source": "Unpackerr",
                })
    return warnings


async def _download_client_warnings(radarr, sonarr) -> list[dict]:
    """A disabled or absent download client is a silent failure: the arr simply
    never grabs anything and says nothing about it."""
    results = await asyncio.gather(
        radarr.download_clients(), sonarr.download_clients(), return_exceptions=True
    )
    warnings: list[dict] = []
    for app, result in zip(("radarr", "sonarr"), results, strict=False):
        if isinstance(result, BaseException):
            continue
        enabled = [c for c in result if c.get("enable")]
        if not enabled:
            warnings.append({
                "app": app,
                "level": "error",
                "message": "no download client is enabled",
                "source": "DownloadClient",
            })
    return warnings


@router.get("/health", response_model=ServiceBlock[list[HealthWarningOut]])
async def health(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    prometheus: PrometheusClient = Depends(get_prometheus),
):
    """Radarr and Sonarr's own health checks. Prowlarr's are already shown on
    the indexer card, so they're deliberately left out of this list."""

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            results = await asyncio.gather(
                radarr.health(), sonarr.health(), return_exceptions=True
            )
            warnings: list[dict] = []
            for app, result in zip(("radarr", "sonarr"), results, strict=False):
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
            extras = await asyncio.gather(
                _unpackerr_warnings(prometheus),
                _download_client_warnings(radarr, sonarr),
                return_exceptions=True,
            )
            for extra in extras:
                if isinstance(extra, list):
                    warnings.extend(extra)
            # errors first, so the worst thing is the first thing read
            warnings.sort(key=lambda w: (w["level"] != "error", w["app"]))
            return warnings

        return await cached("health", 120, call)

    return await guarded(fetch(), "health:block")
