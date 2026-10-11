"""Arr metadata and housekeeping: tags, blocklist, import lists, logs, profiles."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request

from ...clients.lidarr import LidarrClient
from ...clients.prowlarr import ProwlarrClient
from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_lidarr, get_prowlarr, get_radarr, get_readarr, get_sonarr
from ...schemas import (
    BlocklistPageOut,
    ImportListOut,
    LogEntryOut,
    TagOut,
)
from .dashboard import _has

router = APIRouter(tags=["arrmeta"])

LIST_APPS = ("radarr", "sonarr", "lidarr")


def _client_for(app: str, radarr, sonarr, lidarr=None):
    if app not in LIST_APPS:
        raise HTTPException(404, f"unknown app {app!r}")
    return {"radarr": radarr, "sonarr": sonarr, "lidarr": lidarr}[app]


def _listed(request: Request, radarr, sonarr, lidarr) -> dict:
    """The arrs a merged list asks. Lidarr only once it is configured, so a
    stack without it answers exactly as it did before."""
    clients = {"radarr": radarr, "sonarr": sonarr}
    if _has(request, "lidarr"):
        clients["lidarr"] = lidarr
    return clients


@router.get("/import-lists", response_model=list[ImportListOut])
async def import_lists(
    request: Request,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> list[dict]:
    """Trakt lists, TMDB collections, Last.fm charts and the like — how a
    library grows without anyone adding titles by hand."""
    clients = _listed(request, radarr, sonarr, lidarr)
    results = await asyncio.gather(
        *(c.import_lists() for c in clients.values()), return_exceptions=True
    )
    out: list[dict] = []
    for app, result in zip(clients, results, strict=True):
        if isinstance(result, BaseException):
            continue
        for entry in result:
            out.append(
                {
                    "app": app,
                    "id": entry.get("id", 0),
                    "name": entry.get("name", ""),
                    "implementation": entry.get("implementationName")
                    or entry.get("implementation", ""),
                    "enabled": bool(entry.get("enabled")),
                    "enable_auto": bool(entry.get("enableAuto") or entry.get("enableAutomaticAdd")),
                    # Lidarr's is shouldMonitor
                    "monitor": entry.get("monitor") or entry.get("shouldMonitor"),
                    "quality_profile_id": entry.get("qualityProfileId"),
                    "root_folder": entry.get("rootFolderPath"),
                }
            )
    return out


@router.post("/import-lists/{app}/{list_id}/toggle", status_code=204)
async def toggle_import_list(
    app: str,
    list_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    """Flip enabled. The arr rejects a partial body, so the whole record is read
    back, edited and returned."""
    client = _client_for(app, radarr, sonarr, lidarr)
    entry = next((e for e in await client.import_lists() if e.get("id") == list_id), None)
    if entry is None:
        raise HTTPException(404, "import list not found")
    entry["enabled"] = not entry.get("enabled")
    for key in ("enableAuto", "enableAutomaticAdd"):
        if key in entry:
            entry[key] = entry["enabled"]
    await client.update_import_list(list_id, entry)


@router.post("/import-lists/{app}/sync", status_code=204)
async def sync_import_lists(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    await _client_for(app, radarr, sonarr, lidarr).command({"name": "ImportListSync"})


@router.get("/logs/{app}", response_model=list[LogEntryOut])
async def logs(
    app: str,
    page: int = 1,
    level: str = "",
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> list[dict]:
    """The arrs' own logs, so a failed grab doesn't mean opening three tabs.
    Prowlarr is included: its failures are the least visible elsewhere."""
    clients = {
        "radarr": radarr,
        "sonarr": sonarr,
        "readarr": readarr,
        "lidarr": lidarr,
        "prowlarr": prowlarr,
    }
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    payload = await clients[app].logs(page=page, level=level)
    return [
        {
            "app": app,
            "time": rec.get("time", ""),
            "level": rec.get("level", ""),
            "logger": rec.get("logger", ""),
            "message": str(rec.get("message", "")),
            "exception": rec.get("exception"),
        }
        for rec in payload.get("records") or []
    ]


def _blocklist_item(app: str, rec: dict) -> dict:
    media = rec.get("movie") or rec.get("series") or {}
    title = media.get("title", "")
    if app == "lidarr":
        # Lidarr names the artist; the release title says which album
        title = (rec.get("artist") or {}).get("artistName", "")
    return {
        "app": app,
        "id": rec.get("id", 0),
        "title": title,
        "source_title": rec.get("sourceTitle", ""),
        "quality": ((rec.get("quality") or {}).get("quality") or {}).get("name"),
        "date": rec.get("date"),
        "indexer": rec.get("indexer"),
    }


@router.get("/blocklist", response_model=BlocklistPageOut)
async def blocklist(
    request: Request,
    page: int = 1,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> dict:
    """Releases arrdeck's own blocklist-&-retry put here, with no way to undo
    them until now. Merged newest-first across the arrs."""
    clients = _listed(request, radarr, sonarr, lidarr)
    results = await asyncio.gather(
        *(c.blocklist(page) for c in clients.values()), return_exceptions=True
    )
    items: list[dict] = []
    total = 0
    for app, result in zip(clients, results, strict=True):
        if isinstance(result, BaseException):
            continue
        total += result.get("totalRecords", 0)
        items.extend(_blocklist_item(app, r) for r in result.get("records") or [])
    items.sort(key=lambda i: i.get("date") or "", reverse=True)
    return {"items": items, "total": total}


@router.delete("/blocklist/{app}/{entry_id}", status_code=204)
async def blocklist_remove(
    app: str,
    entry_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    await _client_for(app, radarr, sonarr, lidarr).blocklist_delete(entry_id)


@router.delete("/blocklist/{app}", status_code=204)
async def blocklist_clear(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    await _client_for(app, radarr, sonarr, lidarr).blocklist_clear()


@router.get("/tags/{app}", response_model=list[TagOut])
async def tags(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> list[dict]:
    client = _client_for(app, radarr, sonarr, lidarr)
    return [
        {"id": t["id"], "label": t.get("label", "")}
        for t in sorted(await client.tags(), key=lambda t: t.get("label", ""))
    ]
