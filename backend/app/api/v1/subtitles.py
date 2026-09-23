"""Bazarr: what is missing subtitles, and asking it to look again."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache, cached, guarded
from ...clients.bazarr import BazarrClient
from ...deps import (
    get_bazarr,
)
from ...schemas import (
    EpisodeSubtitlesOut,
    ServiceBlock,
    SubtitleDownloadIn,
    SubtitleSearchIn,
    SubtitlesOut,
    TitleSubtitlesOut,
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


def _track(sub: dict) -> dict:
    return {
        "language": sub.get("name") or sub.get("code2") or "",
        "code": sub.get("code2") or "",
        "forced": bool(sub.get("forced")),
        "hi": bool(sub.get("hi")),
        "path": sub.get("path"),
    }


def title_subtitles(row: dict | None) -> dict:
    """Bazarr's row for a movie or episode as present/missing tracks. A title
    without a language profile has nothing to be missing, which is not the
    same as complete — hence `tracked`."""
    if row is None:
        return {"tracked": False, "present": [], "missing": []}
    return {
        "tracked": True,
        "present": [_track(x) for x in row.get("subtitles") or []],
        "missing": [_track(x) for x in row.get("missing_subtitles") or []],
    }


@router.get("/subtitles/movie/{radarr_id}", response_model=TitleSubtitlesOut)
async def movie_subtitles(radarr_id: int, bazarr: BazarrClient = Depends(get_bazarr)):
    return title_subtitles(await bazarr.movie(radarr_id))


@router.get("/subtitles/series/{series_id}", response_model=list[EpisodeSubtitlesOut])
async def series_subtitles(series_id: int, bazarr: BazarrClient = Depends(get_bazarr)):
    rows = await bazarr.series_episodes(series_id)
    return [
        {
            "episode_id": r.get("sonarrEpisodeId", 0),
            "season": r.get("season") or 0,
            "episode": r.get("episode") or 0,
            "subtitles": title_subtitles(r),
        }
        for r in rows
        if r.get("sonarrEpisodeId")
    ]


@router.post("/subtitles/movie/{radarr_id}/download", status_code=204)
async def movie_subtitle_download(
    radarr_id: int, body: SubtitleDownloadIn, bazarr: BazarrClient = Depends(get_bazarr)
) -> None:
    await bazarr.download_movie_subtitle(radarr_id, body.language, body.hi, body.forced)
    cache.set("subtitles", None)


@router.post("/subtitles/series/{series_id}/episodes/{episode_id}/download", status_code=204)
async def episode_subtitle_download(
    series_id: int,
    episode_id: int,
    body: SubtitleDownloadIn,
    bazarr: BazarrClient = Depends(get_bazarr),
) -> None:
    await bazarr.download_episode_subtitle(
        series_id, episode_id, body.language, body.hi, body.forced
    )
    cache.set("subtitles", None)
