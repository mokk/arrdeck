"""Bazarr: what is missing subtitles, and asking it to look again."""

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ...cache import cache, cached, guarded
from ...clients.bazarr import BazarrClient
from ...deps import (
    get_bazarr,
)
from ...schemas import (
    EpisodeSubtitlesOut,
    LanguageProfileOut,
    ProfileAssignIn,
    ServiceBlock,
    SubtitleDownloadIn,
    SubtitleSearchIn,
    SubtitlesOut,
    SubtitleTitleOut,
    SubtitleWantedOut,
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
            items = [wanted_movie(m) for m in movies] + [wanted_episode(e) for e in episodes]
            return {
                "episodes": badges.get("episodes", 0),
                "movies": badges.get("movies", 0),
                "throttled_providers": badges.get("providers", 0),
                "items": items,
            }

        return await cached("subtitles", 300, call)

    return await guarded(fetch(), "subtitles:block")


def _missing(row: dict) -> list[str]:
    return [x.get("name", "") for x in row.get("missing_subtitles") or []]


def wanted_movie(m: dict) -> dict:
    return {
        "kind": "movie",
        "id": m.get("radarrId", 0),
        "title": m.get("title", ""),
        "missing": _missing(m),
    }


def wanted_episode(e: dict) -> dict:
    return {
        "kind": "episode",
        "id": e.get("sonarrEpisodeId", 0),
        "series_id": e.get("sonarrSeriesId"),
        "title": e.get("seriesTitle", ""),
        "subtitle": f"{e.get('episode_number', '')} {e.get('episodeTitle', '')}".strip(),
        "missing": _missing(e),
    }


@router.get("/subtitles/wanted", response_model=SubtitleWantedOut)
async def subtitles_wanted(
    kind: Literal["movie", "episode"],
    start: int = Query(0, ge=0),
    length: int = Query(50, ge=1, le=200),
    bazarr: BazarrClient = Depends(get_bazarr),
):
    """Everything missing subtitles, a page at a time — the dashboard only
    shows the first few."""
    page = await bazarr.wanted_page(f"{kind}s", start, length)
    row = wanted_movie if kind == "movie" else wanted_episode
    return {"items": [row(x) for x in page["data"]], "total": page["total"]}


# Bazarr's own jobs that go through the whole wanted list.
SEARCH_ALL_TASKS = {
    "movie": "wanted_search_missing_subtitles_movies",
    "episode": "wanted_search_missing_subtitles_series",
}


@router.post("/subtitles/wanted/search", status_code=204)
async def subtitles_search_all(
    kind: Literal["movie", "episode"], bazarr: BazarrClient = Depends(get_bazarr)
) -> None:
    await bazarr.run_task(SEARCH_ALL_TASKS[kind])


def profile_row(p: dict) -> dict:
    return {
        "id": p.get("profileId", 0),
        "name": p.get("name") or "",
        "languages": [i.get("language") for i in p.get("items") or [] if i.get("language")],
    }


def title_row(kind: str, r: dict) -> dict:
    return {
        "kind": kind,
        "id": r.get("radarrId") if kind == "movie" else r.get("sonarrSeriesId"),
        "title": r.get("title") or "",
        "year": r.get("year") or None,
        "profile_id": r.get("profileId"),
    }


@router.get("/subtitles/profiles", response_model=list[LanguageProfileOut])
async def language_profiles(bazarr: BazarrClient = Depends(get_bazarr)):
    return [profile_row(p) for p in await bazarr.profiles()]


@router.get("/subtitles/titles", response_model=list[SubtitleTitleOut])
async def subtitle_titles(bazarr: BazarrClient = Depends(get_bazarr)):
    """Every movie and series with its language profile, so titles without
    one — which Bazarr never fetches anything for — can be given one in bulk."""
    movies, series = await asyncio.gather(bazarr.all_titles("movies"), bazarr.all_titles("series"))
    rows = [title_row("movie", m) for m in movies] + [title_row("series", s) for s in series]
    rows = [r for r in rows if r["id"]]
    return sorted(rows, key=lambda r: r["title"].lower())


@router.put("/subtitles/profile", status_code=204)
async def assign_profile(body: ProfileAssignIn, bazarr: BazarrClient = Depends(get_bazarr)) -> None:
    if body.profile_id is not None:
        known = {p.get("profileId") for p in await bazarr.profiles()}
        if body.profile_id not in known:
            raise HTTPException(404, "no such language profile")
    await bazarr.set_profile(
        "movies" if body.kind == "movie" else "series", body.ids, body.profile_id
    )
    cache.set("subtitles", None)


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
    # Movies carry their language profile; a movie without one is not tracked
    # either. Episode rows do not carry it, so they count as tracked.
    tracked = "profileId" not in row or row.get("profileId") is not None
    return {
        "tracked": tracked,
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
