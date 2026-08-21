"""The movie library: listing, detail, editing, removal."""

from fastapi import APIRouter, Depends

from ...cache import cache
from ...clients.radarr import RadarrClient
from ...deps import get_radarr
from ...schemas import (
    HistoryEventOut,
    LibraryMovieOut,
    LibraryUpdateIn,
    MovieDetailOut,
    MovieFileOut,
)
from .dashboard import EVENT_LABELS
from .discover import _poster

router = APIRouter(tags=["library"])


@router.get("/library/movies", response_model=list[LibraryMovieOut])
async def library_movies(radarr: RadarrClient = Depends(get_radarr)) -> list[dict]:
    items = await radarr.movies()
    return [
        {
            "id": m["id"],
            "title": m.get("title"),
            "year": m.get("year"),
            "monitored": m.get("monitored", False),
            "has_file": m.get("hasFile", False),
            "size_on_disk": m.get("sizeOnDisk", 0),
            "quality_profile_id": m.get("qualityProfileId"),
            "poster": _poster(m.get("images")),
            "tags": m.get("tags") or [],
            "tmdb_id": m.get("tmdbId"),
            "imdb_id": m.get("imdbId"),
        }
        for m in sorted(items, key=lambda m: m.get("sortTitle", ""))
    ]


@router.get("/library/movies/{movie_id}/detail", response_model=MovieDetailOut)
async def movie_detail(
    movie_id: int, radarr: RadarrClient = Depends(get_radarr)
) -> MovieDetailOut:
    movie = await radarr.get_movie(movie_id)
    try:
        history = await radarr.history_movie(movie_id)
    except Exception:  # noqa: BLE001 — history is decoration
        history = []
    movie_file = movie.get("movieFile")
    file_out = None
    if movie_file:
        media = movie_file.get("mediaInfo") or {}
        file_out = MovieFileOut(
            quality=((movie_file.get("quality") or {}).get("quality") or {}).get("name"),
            size=movie_file.get("size", 0),
            resolution=media.get("resolution"),
            release_group=movie_file.get("releaseGroup"),
        )
    return MovieDetailOut(
        id=movie["id"],
        title=movie.get("title"),
        year=movie.get("year"),
        overview=movie.get("overview"),
        poster=_poster(movie.get("images")),
        status=movie.get("status"),
        runtime=movie.get("runtime"),
        path=movie.get("path"),
        monitored=movie.get("monitored", False),
        has_file=movie.get("hasFile", False),
        size_on_disk=movie.get("sizeOnDisk", 0),
        quality_profile_id=movie.get("qualityProfileId"),
        imdb_id=movie.get("imdbId"),
        tmdb_id=movie.get("tmdbId"),
        file=file_out,
        history=[
            HistoryEventOut(
                type=EVENT_LABELS.get(h.get("eventType", ""), h.get("eventType", "")),
                date=h.get("date", ""),
            )
            for h in history[:12]
        ],
    )


@router.patch("/library/movies/{movie_id}")
async def update_movie(
    movie_id: int, body: LibraryUpdateIn, radarr: RadarrClient = Depends(get_radarr)
) -> dict:
    movie = await radarr.get_movie(movie_id)
    if body.monitored is not None:
        movie["monitored"] = body.monitored
    if body.quality_profile_id is not None:
        movie["qualityProfileId"] = body.quality_profile_id
    updated = await radarr.update_movie(movie_id, movie)
    cache.set("library_map:movie", None)
    return {
        "id": updated["id"],
        "monitored": updated.get("monitored", False),
        "quality_profile_id": updated.get("qualityProfileId"),
    }


@router.delete("/library/movies/{movie_id}", status_code=204)
async def delete_movie(
    movie_id: int, delete_files: bool = False, radarr: RadarrClient = Depends(get_radarr)
) -> None:
    await radarr.delete_movie(movie_id, delete_files)
    cache.set("library_map:movie", None)
