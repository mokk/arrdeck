"""Actions that apply to either library: search triggers and bulk edits."""

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_sonarr
from ...schemas import BulkDeleteIn, BulkEditIn

router = APIRouter(tags=["library"])


@router.post("/library/{app}/{item_id}/search", status_code=204)
async def trigger_search(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app == "radarr":
        await radarr.command({"name": "MoviesSearch", "movieIds": [item_id]})
    elif app == "sonarr":
        await sonarr.command({"name": "SeriesSearch", "seriesId": item_id})
    else:
        raise HTTPException(404, f"unknown app {app!r}")


@router.post("/library/{kind}/bulk", status_code=204)
async def library_bulk_edit(
    kind: str,
    body: BulkEditIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if kind not in ("movies", "series"):
        raise HTTPException(404, f"unknown kind {kind!r}")
    payload: dict = {("movieIds" if kind == "movies" else "seriesIds"): body.ids}
    if body.monitored is not None:
        payload["monitored"] = body.monitored
    if body.quality_profile_id is not None:
        payload["qualityProfileId"] = body.quality_profile_id
    if body.tags is not None:
        payload["tags"] = body.tags
        payload["applyTags"] = body.apply_tags
    client = radarr if kind == "movies" else sonarr
    await client.bulk_edit(payload)
    cache.set(f"library_map:{'movie' if kind == 'movies' else 'series'}", None)


@router.post("/library/{kind}/bulk-delete", status_code=204)
async def library_bulk_delete(
    kind: str,
    body: BulkDeleteIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if kind not in ("movies", "series"):
        raise HTTPException(404, f"unknown kind {kind!r}")
    client = radarr if kind == "movies" else sonarr
    await client.bulk_delete(body.ids, body.delete_files)
    cache.set(f"library_map:{'movie' if kind == 'movies' else 'series'}", None)


@router.post("/library/{kind}/bulk-search", status_code=204)
async def library_bulk_search(
    kind: str,
    body: BulkDeleteIn,  # only ids used
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if kind == "movies":
        await radarr.command({"name": "MoviesSearch", "movieIds": body.ids})
    elif kind == "series":
        for series_id in body.ids:
            await sonarr.command({"name": "SeriesSearch", "seriesId": series_id})
    else:
        raise HTTPException(404, f"unknown kind {kind!r}")
