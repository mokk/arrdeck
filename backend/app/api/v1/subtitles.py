"""Bazarr: what is missing subtitles, and asking it to look again."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache, cached, guarded
from ...clients.bazarr import BazarrClient
from ...deps import (
    get_bazarr,
)
from ...schemas import (
    ServiceBlock,
    SubtitleSearchIn,
    SubtitlesOut,
)

router = APIRouter(tags=["subtitles"])


@router.get("/subtitles", response_model=ServiceBlock[SubtitlesOut])
async def subtitles(bazarr: BazarrClient = Depends(get_bazarr)):
    """What Bazarr is still missing. Counts come from its badges endpoint, so
    they stay right even though the item list is capped."""

    async def fetch() -> dict:
        async def call() -> dict:
            badges, episodes, movies = await asyncio.gather(
                bazarr.badges(), bazarr.wanted_episodes(), bazarr.wanted_movies()
            )
            items = [
                {
                    "kind": "movie",
                    "id": m.get("radarrId", 0),
                    "title": m.get("title", ""),
                    "missing": [x.get("name", "") for x in m.get("missing_subtitles") or []],
                }
                for m in movies
            ] + [
                {
                    "kind": "episode",
                    "id": e.get("sonarrEpisodeId", 0),
                    "series_id": e.get("sonarrSeriesId"),
                    "title": e.get("seriesTitle", ""),
                    "subtitle": f"{e.get('episode_number', '')} {e.get('episodeTitle', '')}".strip(),
                    "missing": [x.get("name", "") for x in e.get("missing_subtitles") or []],
                }
                for e in episodes
            ]
            return {
                "episodes": badges.get("episodes", 0),
                "movies": badges.get("movies", 0),
                "throttled_providers": badges.get("providers", 0),
                "items": items,
            }

        return await cached("subtitles", 300, call)

    return await guarded(fetch(), "subtitles:block")


@router.post("/subtitles/search", status_code=204)
async def subtitle_search(
    body: SubtitleSearchIn, bazarr: BazarrClient = Depends(get_bazarr)
) -> None:
    if body.kind == "movie":
        await bazarr.search_movie(body.id)
    else:
        if body.series_id is None:
            raise HTTPException(422, "episodes need a series_id")
        await bazarr.search_episode(body.series_id, body.id)
    cache.set("subtitles", None)
