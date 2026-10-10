"""Infrastructure health: service probes, disk space, VPN, arr warnings."""

import asyncio
import logging
import re
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request

from ...cache import cached, guarded
from ...clients.base import ServiceUnavailable, retry_count
from ...clients.gluetun import GluetunClient
from ...clients.helper import HelperError
from ...clients.prometheus import PrometheusClient
from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...db import SERVICES
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
    RestartableOut,
    ServiceActionOut,
    ServiceBlock,
    ServiceStatus,
    VpnStatusOut,
)

router = APIRouter(tags=["system"])
logger = logging.getLogger("arrdeck.system")


# Only the arrs publish a release feed with installed/latest flags.
UPDATE_APPS = ("radarr", "sonarr", "readarr", "prowlarr")
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
    watch = getattr(request.app.state, "watch", None)
    names = registry.configured()

    def down_since(name: str) -> datetime | None:
        since = watch.down_since(name) if watch else None
        return datetime.fromtimestamp(since, UTC) if since is not None else None

    async def probe(name: str) -> ServiceStatus:
        try:
            version = await probe_version(name, registry.get(name))
            pending = (
                await _pending_update(name, registry.get(name)) if name in UPDATE_APPS else None
            )
            return ServiceStatus(
                service=name,
                ok=True,
                version=version,
                retries=retry_count(name),
                update_available=pending,
                down_since=down_since(name),
            )
        except ServiceUnavailable as exc:
            return ServiceStatus(
                service=name,
                ok=False,
                error=exc.message,
                retries=retry_count(name),
                down_since=down_since(name),
            )
        except Exception as exc:  # noqa: BLE001
            return ServiceStatus(
                service=name,
                ok=False,
                error=str(exc),
                retries=retry_count(name),
                down_since=down_since(name),
            )

    return list(await asyncio.gather(*(probe(n) for n in names)))


# arrdeck's own compose project, by the name the helper README uses for it
SELF_PROJECT = "arrdeck"
PROJECT_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
# the self-restart runs after the response; held so it is not garbage-collected
_pending: set[asyncio.Task] = set()


def _self_action_done(task: asyncio.Task) -> None:
    _pending.discard(task)
    # normally never reached: the process is gone before the helper answers
    if not task.cancelled() and task.exception() is not None:
        logger.warning("self %s via the helper failed: %s", SELF_PROJECT, task.exception())


def _helper(request: Request):
    registry = request.app.state.registry
    if not registry.is_configured("helper"):
        raise HTTPException(409, "the host helper is not configured (Settings → Connections)")
    return registry.get("helper")


@router.get("/system/restartable", response_model=RestartableOut)
async def restartable(request: Request) -> dict:
    """The compose projects the host helper will restart, matched to arrdeck's
    services by name. Never an error: "not configured" and "unreachable" are
    states the Settings page shows, not failures."""
    registry = request.app.state.registry
    if not registry.is_configured("helper"):
        return {"configured": False}
    try:
        rows = await registry.get("helper").projects()
    except (ServiceUnavailable, HelperError) as exc:
        return {"configured": True, "error": exc.message}
    projects = []
    for row in rows:
        containers = row.get("containers") or []
        name = row.get("name") or ""
        projects.append(
            {
                "name": name,
                "service": name if name in SERVICES else None,
                "running": bool(row.get("running")),
                "containers": len(containers),
                "running_containers": sum(1 for c in containers if c.get("state") == "running"),
                "error": row.get("error"),
                "is_self": name == SELF_PROJECT,
            }
        )
    return {"configured": True, "projects": projects}


@router.post("/system/services/{name}/{action}", response_model=ServiceActionOut)
async def service_action(name: str, action: Literal["restart", "up"], request: Request) -> dict:
    """`docker compose restart` or `up -d` in one project, through the helper,
    which holds the allowlist. ServiceUnavailable (helper unreachable) is a 502
    from the app-wide handler."""
    if not PROJECT_NAME.match(name):
        raise HTTPException(404, f"unknown project {name!r}")
    helper = _helper(request)
    if name == SELF_PROJECT:
        # The restart kills this process before the helper answers, so the
        # answer would never reach the browser. Check what can be checked
        # first, then hand it off and reply now.
        try:
            listed = {p.get("name") for p in await helper.projects()}
        except HelperError as exc:
            raise HTTPException(exc.status, exc.message) from exc
        if name not in listed:
            raise HTTPException(404, f"the helper does not list {name!r}")
        task = asyncio.create_task(helper.action(name, action))
        _pending.add(task)
        task.add_done_callback(_self_action_done)
        return {"project": name, "action": action, "pending": True}
    try:
        await helper.action(name, action)
    except HelperError as exc:
        headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
        raise HTTPException(exc.status, exc.message, headers=headers) from exc
    return {"project": name, "action": action}


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
                warnings.append(
                    {
                        "app": "unpackerr",
                        "level": "error",
                        "message": f"{int(gauges[key])} extraction(s) failed",
                        "source": "Unpackerr",
                    }
                )
    if isinstance(counters, dict):
        for key in UNPACKERR_FAILURE_COUNTERS:
            if counters.get(key, 0) >= 1:
                warnings.append(
                    {
                        "app": "unpackerr",
                        "level": "warning",
                        "message": f"{int(counters[key])} {key.replace('_', ' ')} in the last hour",
                        "source": "Unpackerr",
                    }
                )
    if isinstance(fetch_errors, dict):
        for app_name, count in sorted(fetch_errors.items()):
            if count >= QUEUE_FETCH_THRESHOLD:
                warnings.append(
                    {
                        "app": "unpackerr",
                        "level": "warning",
                        "message": (
                            f"cannot read {app_name or 'an arr'}'s queue "
                            f"({int(count)} errors in the last hour)"
                        ),
                        "source": "Unpackerr",
                    }
                )
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
            warnings.append(
                {
                    "app": app,
                    "level": "error",
                    "message": "no download client is enabled",
                    "source": "DownloadClient",
                }
            )
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
            results = await asyncio.gather(radarr.health(), sonarr.health(), return_exceptions=True)
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
