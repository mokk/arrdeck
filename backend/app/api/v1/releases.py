"""Release search and grabbing, via Prowlarr and the arrs themselves."""

from fastapi import APIRouter, Depends, HTTPException, Request
from ...clients.prowlarr import ProwlarrClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_overseerr, get_prowlarr, get_radarr, get_sonarr
from ...schemas import (
    AddMovieIn,
    AddSeriesIn,
    ArrReleaseOut,
    CollectionDetailOut,
    CollectionOut,
    GrabIn,
    OptionsOut,
    ReleaseOut,
    MediaRequestOut,
    SearchResultOut,
    ServiceBlock,
)

router = APIRouter(tags=["releases"])


@router.get("/search/releases", response_model=list[ReleaseOut])
async def search_releases(q: str, prowlarr: ProwlarrClient = Depends(get_prowlarr)) -> list[ReleaseOut]:
    results = await prowlarr.search(q)
    return [
        ReleaseOut(
            guid=r.get("guid", ""),
            indexer_id=r.get("indexerId", 0),
            indexer=r.get("indexer"),
            title=r.get("title", ""),
            size=r.get("size"),
            seeders=r.get("seeders"),
            leechers=r.get("leechers"),
            age_days=r.get("ageMinutes", 0) / 1440 if r.get("ageMinutes") is not None else None,
            download_url=r.get("downloadUrl"),
        )
        for r in results[:100]
    ]


@router.post("/releases/grab", status_code=204)
async def grab_release(body: GrabIn, prowlarr: ProwlarrClient = Depends(get_prowlarr)) -> None:
    await prowlarr.grab(body.guid, body.indexer_id)


def _arr_release(r: dict) -> ArrReleaseOut:
    return ArrReleaseOut(
        guid=r.get("guid", ""),
        indexer_id=r.get("indexerId", 0),
        indexer=r.get("indexer"),
        title=r.get("title", ""),
        quality=((r.get("quality") or {}).get("quality") or {}).get("name"),
        size=r.get("size"),
        seeders=r.get("seeders"),
        leechers=r.get("leechers"),
        age_days=r.get("ageHours", 0) / 24 if r.get("ageHours") is not None else None,
        approved=not r.get("rejected", False),
        rejections=r.get("rejections", []),
    )


def _sort_releases(rows: list[ArrReleaseOut]) -> list[ArrReleaseOut]:
    return sorted(rows, key=lambda r: (not r.approved, -(r.seeders or 0)))


@router.get("/releases/movie/{movie_id}", response_model=list[ArrReleaseOut])
async def movie_releases(
    movie_id: int, radarr: RadarrClient = Depends(get_radarr)
) -> list[ArrReleaseOut]:
    rows = await radarr.releases(movieId=movie_id)
    return _sort_releases([_arr_release(r) for r in rows])


@router.get("/releases/series/{series_id}", response_model=list[ArrReleaseOut])
async def series_releases(
    series_id: int,
    season: int | None = None,
    episode_id: int | None = None,
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[ArrReleaseOut]:
    if episode_id is not None:
        rows = await sonarr.releases(episodeId=episode_id)
    elif season is not None:
        rows = await sonarr.releases(seriesId=series_id, seasonNumber=season)
    else:
        raise HTTPException(422, "season or episode_id required")
    return _sort_releases([_arr_release(r) for r in rows])


@router.post("/releases/{app}/grab", status_code=204)
async def grab_arr_release(
    app: str,
    body: GrabIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app == "radarr":
        await radarr.grab_release(body.guid, body.indexer_id)
    elif app == "sonarr":
        await sonarr.grab_release(body.guid, body.indexer_id)
    else:
        raise HTTPException(404, f"unknown app {app!r}")
