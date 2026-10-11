"""Actions that apply to every library: search triggers and bulk edits. The
music library's bulk actions address artists."""

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache
from ...clients.lidarr import LidarrClient
from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_lidarr, get_radarr, get_readarr, get_sonarr
from ...schemas import BulkDeleteIn, BulkEditIn
from .music import forget_artists

router = APIRouter(tags=["library"])


@router.post("/library/{app}/{item_id}/search", status_code=204)
async def trigger_search(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    if app == "radarr":
        await radarr.command({"name": "MoviesSearch", "movieIds": [item_id]})
    elif app == "sonarr":
        await sonarr.command({"name": "SeriesSearch", "seriesId": item_id})
    elif app == "readarr":
        await readarr.command({"name": "BookSearch", "bookIds": [item_id]})
    elif app == "lidarr":
        # item_id is an album: what Wanted lists and the calendar opens
        await lidarr.command({"name": "AlbumSearch", "albumIds": [item_id]})
    else:
        raise HTTPException(404, f"unknown app {app!r}")


@router.post("/library/{kind}/bulk", status_code=204)
async def library_bulk_edit(
    kind: str,
    body: BulkEditIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    ids_key = {
        "movies": "movieIds",
        "series": "seriesIds",
        "books": "bookIds",
        "artists": "artistIds",
    }.get(kind)
    if ids_key is None:
        raise HTTPException(404, f"unknown kind {kind!r}")
    payload: dict = {ids_key: body.ids}
    if body.monitored is not None:
        payload["monitored"] = body.monitored
    if body.quality_profile_id is not None:
        payload["qualityProfileId"] = body.quality_profile_id
    if body.tags is not None:
        payload["tags"] = body.tags
        payload["applyTags"] = body.apply_tags
    client = {"movies": radarr, "series": sonarr, "books": readarr, "artists": lidarr}[kind]
    await client.bulk_edit(payload)
    cache.set(f"library_map:{'movie' if kind == 'movies' else 'series'}", None)
    cache.set("readarr:authors", None)
    if kind == "artists":
        forget_artists()


@router.post("/library/{kind}/bulk-delete", status_code=204)
async def library_bulk_delete(
    kind: str,
    body: BulkDeleteIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    clients = {"movies": radarr, "series": sonarr, "books": readarr, "artists": lidarr}
    if kind not in clients:
        raise HTTPException(404, f"unknown kind {kind!r}")
    await clients[kind].bulk_delete(body.ids, body.delete_files, body.exclude)
    cache.set(f"library_map:{'movie' if kind == 'movies' else 'series'}", None)
    if kind == "artists":
        forget_artists()


@router.post("/library/{kind}/bulk-search", status_code=204)
async def library_bulk_search(
    kind: str,
    body: BulkDeleteIn,  # only ids used
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    lidarr: LidarrClient = Depends(get_lidarr),
) -> None:
    if kind == "movies":
        await radarr.command({"name": "MoviesSearch", "movieIds": body.ids})
    elif kind == "series":
        for series_id in body.ids:
            await sonarr.command({"name": "SeriesSearch", "seriesId": series_id})
    elif kind == "books":
        await readarr.command({"name": "BookSearch", "bookIds": body.ids})
    elif kind == "artists":
        # every monitored album of each artist that is missing or below cutoff
        for artist_id in body.ids:
            await lidarr.command({"name": "ArtistSearch", "artistId": artist_id})
    else:
        raise HTTPException(404, f"unknown kind {kind!r}")
