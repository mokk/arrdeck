"""Missing and cutoff-unmet items, and searching for them in bulk."""

from fastapi import APIRouter, Depends, HTTPException

from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_sonarr
from ...schemas import (
    WantedItemOut,
    WantedPageOut,
)
from .discover import _poster

router = APIRouter(tags=["wanted"])

WANTED_PAGE_SIZE = 30


@router.get("/wanted/{app}", response_model=WantedPageOut)
async def wanted(
    app: str,
    kind: str = "missing",
    page: int = 1,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> WantedPageOut:
    if kind not in ("missing", "cutoff"):
        raise HTTPException(422, "kind must be missing or cutoff")
    if app == "radarr":
        payload = await radarr.wanted(kind, page, WANTED_PAGE_SIZE)
        items = [
            WantedItemOut(
                app="radarr",
                id=r["id"],
                library_id=r["id"],
                title=r.get("title", ""),
                subtitle=str(r.get("year") or "") or None,
                air_date=r.get("digitalRelease") or r.get("physicalRelease") or r.get("inCinemas"),
                poster=_poster(r.get("images")),
            )
            for r in payload.get("records", [])
        ]
    elif app == "sonarr":
        payload = await sonarr.wanted(kind, page, WANTED_PAGE_SIZE)
        items = [
            WantedItemOut(
                app="sonarr",
                id=e["id"],
                library_id=e.get("seriesId", 0),
                title=(e.get("series") or {}).get("title", ""),
                subtitle=(
                    f"S{e.get('seasonNumber', 0):02d}E{e.get('episodeNumber', 0):02d}"
                    f" {e.get('title', '')}"
                ),
                air_date=e.get("airDateUtc"),
                poster=_poster((e.get("series") or {}).get("images")),
            )
            for e in payload.get("records", [])
        ]
    else:
        raise HTTPException(404, f"unknown app {app!r}")
    total = payload.get("totalRecords", 0)
    return WantedPageOut(items=items, total=total, has_more=page * WANTED_PAGE_SIZE < total)


@router.post("/wanted/{app}/search-all", status_code=204)
async def wanted_search_all(
    app: str,
    kind: str = "missing",
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    commands = {
        ("radarr", "missing"): {"name": "MissingMoviesSearch"},
        ("radarr", "cutoff"): {"name": "CutoffUnmetMoviesSearch"},
        ("sonarr", "missing"): {"name": "MissingEpisodeSearch"},
        ("sonarr", "cutoff"): {"name": "CutoffUnmetEpisodeSearch"},
    }
    command = commands.get((app, kind))
    if command is None:
        raise HTTPException(404, "unknown app/kind")
    client = radarr if app == "radarr" else sonarr
    await client.command(command)
