"""Arr metadata and housekeeping: tags, blocklist, import lists, logs, profiles."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...clients.prowlarr import ProwlarrClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_prowlarr, get_radarr, get_sonarr
from ...schemas import (
    BlocklistPageOut,
    ImportListOut,
    LogEntryOut,
    TagOut,
)

router = APIRouter(tags=["arrmeta"])

LIST_APPS = ("radarr", "sonarr")


def _client_for(app: str, radarr, sonarr):
    if app not in LIST_APPS:
        raise HTTPException(404, f"unknown app {app!r}")
    return radarr if app == "radarr" else sonarr


@router.get("/import-lists", response_model=list[ImportListOut])
async def import_lists(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    """Trakt lists, TMDB collections and the like — how a library grows without
    anyone adding titles by hand."""
    results = await asyncio.gather(
        radarr.import_lists(), sonarr.import_lists(), return_exceptions=True
    )
    out: list[dict] = []
    for app, result in zip(LIST_APPS, results, strict=False):
        if isinstance(result, BaseException):
            continue
        for entry in result:
            out.append(
                {
                    "app": app,
                    "id": entry.get("id", 0),
                    "name": entry.get("name", ""),
                    "implementation": entry.get("implementationName") or entry.get("implementation", ""),
                    "enabled": bool(entry.get("enabled")),
                    "enable_auto": bool(entry.get("enableAuto") or entry.get("enableAutomaticAdd")),
                    "monitor": entry.get("monitor"),
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
) -> None:
    """Flip enabled. The arr rejects a partial body, so the whole record is read
    back, edited and returned."""
    client = _client_for(app, radarr, sonarr)
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
) -> None:
    await _client_for(app, radarr, sonarr).command({"name": "ImportListSync"})


@router.get("/logs/{app}", response_model=list[LogEntryOut])
async def logs(
    app: str,
    page: int = 1,
    level: str = "",
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    """The arrs' own logs, so a failed grab doesn't mean opening three tabs.
    Prowlarr is included: its failures are the least visible elsewhere."""
    clients = {"radarr": radarr, "sonarr": sonarr, "prowlarr": prowlarr}
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
    return {
        "app": app,
        "id": rec.get("id", 0),
        "title": media.get("title", ""),
        "source_title": rec.get("sourceTitle", ""),
        "quality": ((rec.get("quality") or {}).get("quality") or {}).get("name"),
        "date": rec.get("date"),
        "indexer": rec.get("indexer"),
    }


@router.get("/blocklist", response_model=BlocklistPageOut)
async def blocklist(
    page: int = 1,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    """Releases arrdeck's own blocklist-&-retry put here, with no way to undo
    them until now. Merged newest-first across both arrs."""
    results = await asyncio.gather(
        radarr.blocklist(page), sonarr.blocklist(page), return_exceptions=True
    )
    items: list[dict] = []
    total = 0
    for app, result in zip(("radarr", "sonarr"), results, strict=False):
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
) -> None:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    await (radarr if app == "radarr" else sonarr).blocklist_delete(entry_id)


@router.delete("/blocklist/{app}", status_code=204)
async def blocklist_clear(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    await (radarr if app == "radarr" else sonarr).blocklist_clear()


@router.get("/tags/{app}", response_model=list[TagOut])
async def tags(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    return [
        {"id": t["id"], "label": t.get("label", "")}
        for t in sorted(await client.tags(), key=lambda t: t.get("label", ""))
    ]


@router.get("/profiles")
async def quality_profiles(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    r, s = await asyncio.gather(radarr.quality_profiles(), sonarr.quality_profiles())

    def slim(profiles: list) -> list[dict]:
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "upgrade_allowed": p.get("upgradeAllowed", False),
                "cutoff": p.get("cutoff"),
            }
            for p in profiles
        ]

    return {"radarr": slim(r), "sonarr": slim(s)}
