"""The series library: listing, detail, seasons, episodes, editing, removal."""

import asyncio
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache, cached
from ...clients.sonarr import SonarrClient
from ...deps import get_sonarr
from ...schemas import (
    EpisodeIdsIn,
    EpisodeMonitorIn,
    EpisodeOut,
    LibrarySeriesOut,
    LibraryUpdateIn,
    MonitorIn,
    SeasonOut,
    SeriesDetailOut,
)
from .discover import _fanart, _poster, _rating

router = APIRouter(tags=["library"])


UP_NEXT_DAYS = 120


async def next_episodes(sonarr: SonarrClient) -> dict[int, dict]:
    """The first upcoming episode per series, from one calendar call rather than
    one episode list per show. Cached: the calendar barely moves in minutes."""

    async def call() -> dict[int, dict]:
        now = datetime.now(UTC)
        end = now + timedelta(days=UP_NEXT_DAYS)
        episodes = await sonarr.calendar(now.isoformat(), end.isoformat())
        out: dict[int, dict] = {}
        for ep in sorted(episodes, key=lambda e: e.get("airDateUtc") or ""):
            series_id = ep.get("seriesId")
            if series_id is None or series_id in out or not ep.get("airDateUtc"):
                continue
            out[series_id] = {
                "season": ep.get("seasonNumber", 0),
                "episode": ep.get("episodeNumber", 0),
                "title": ep.get("title"),
                "air_date": ep.get("airDateUtc"),
            }
        return out

    try:
        return await cached("sonarr:next_episodes", 900, call)
    except Exception:  # noqa: BLE001 — "up next" is decoration on the library
        return {}


def current_season(series: dict, next_episode: dict | None) -> dict | None:
    """The season worth a progress bar: the one the next episode is in, else
    the latest real season (specials are season 0)."""
    seasons = {s.get("seasonNumber"): s for s in series.get("seasons") or []}
    number = (
        next_episode["season"] if next_episode else max((n for n in seasons if n), default=None)
    )
    season = seasons.get(number)
    if season is None:
        return None
    stats = season.get("statistics") or {}
    return {
        "number": number,
        "have": stats.get("episodeFileCount", 0),
        "total": stats.get("totalEpisodeCount", 0),
    }


@router.get("/library/series", response_model=list[LibrarySeriesOut])
async def library_series(sonarr: SonarrClient = Depends(get_sonarr)) -> list[dict]:
    items, upcoming = await asyncio.gather(sonarr.series(), next_episodes(sonarr))
    return [
        {
            "id": s["id"],
            "title": s.get("title"),
            "year": s.get("year"),
            "monitored": s.get("monitored", False),
            "status": s.get("status"),
            "episode_count": (s.get("statistics") or {}).get("episodeCount", 0),
            "episode_file_count": (s.get("statistics") or {}).get("episodeFileCount", 0),
            "size_on_disk": (s.get("statistics") or {}).get("sizeOnDisk", 0),
            "added": s.get("added"),
            "quality_profile_id": s.get("qualityProfileId"),
            "poster": _poster(s.get("images")),
            "tags": s.get("tags") or [],
            "tvdb_id": s.get("tvdbId"),
            "imdb_id": s.get("imdbId"),
            "tmdb_id": s.get("tmdbId"),
            "network": s.get("network"),
            "genres": s.get("genres") or [],
            "rating": _rating(s.get("ratings")),
            "next_airing": s.get("nextAiring"),
            "slug": s.get("titleSlug"),
            "previous_airing": s.get("previousAiring"),
            "next_episode": upcoming.get(s["id"]),
            "current_season": current_season(s, upcoming.get(s["id"])),
        }
        for s in sorted(items, key=lambda s: s.get("sortTitle", ""))
    ]


def _season_out(season: dict) -> SeasonOut:
    stats = season.get("statistics") or {}
    return SeasonOut(
        number=season.get("seasonNumber", 0),
        monitored=season.get("monitored", False),
        episode_count=stats.get("episodeCount", 0),
        episode_file_count=stats.get("episodeFileCount", 0),
        size_on_disk=stats.get("sizeOnDisk", 0),
    )


@router.get("/library/series/{series_id}/detail", response_model=SeriesDetailOut)
async def series_detail(
    series_id: int, sonarr: SonarrClient = Depends(get_sonarr)
) -> SeriesDetailOut:
    series = await sonarr.get_series(series_id)
    seasons = sorted((_season_out(s) for s in series.get("seasons", [])), key=lambda s: s.number)
    stats = series.get("statistics") or {}
    return SeriesDetailOut(
        id=series["id"],
        title=series.get("title"),
        year=series.get("year"),
        overview=series.get("overview"),
        poster=_poster(series.get("images")),
        fanart=_fanart(series.get("images")),
        status=series.get("status"),
        runtime=series.get("runtime"),
        path=series.get("path"),
        monitored=series.get("monitored", False),
        size_on_disk=stats.get("sizeOnDisk", 0),
        quality_profile_id=series.get("qualityProfileId"),
        imdb_id=series.get("imdbId"),
        tvdb_id=series.get("tvdbId"),
        tmdb_id=series.get("tmdbId"),
        network=series.get("network"),
        air_time=series.get("airTime"),
        certification=series.get("certification"),
        genres=series.get("genres") or [],
        episode_count=stats.get("episodeCount", 0),
        episode_file_count=stats.get("episodeFileCount", 0),
        total_episode_count=stats.get("totalEpisodeCount", 0),
        season_count=stats.get("seasonCount", 0),
        seasons=seasons,
    )


@router.get("/library/series/{series_id}/episodes", response_model=list[EpisodeOut])
async def series_episodes(
    series_id: int, season: int | None = None, sonarr: SonarrClient = Depends(get_sonarr)
) -> list[EpisodeOut]:
    episodes = await sonarr.episodes(series_id)
    out = [episode_row(e) for e in episodes if season is None or e.get("seasonNumber") == season]
    return sorted(out, key=lambda e: (e.season, e.episode))


def episode_row(e: dict) -> EpisodeOut:
    episode_file = e.get("episodeFile") or {}
    return EpisodeOut(
        id=e["id"],
        season=e.get("seasonNumber", 0),
        episode=e.get("episodeNumber", 0),
        title=e.get("title"),
        overview=e.get("overview") or None,
        air_date=e.get("airDateUtc"),
        has_file=e.get("hasFile", False),
        monitored=e.get("monitored", False),
        file_id=episode_file.get("id") or e.get("episodeFileId") or None,
        quality=((episode_file.get("quality") or {}).get("quality") or {}).get("name"),
        size=episode_file.get("size"),
    )


@router.delete("/library/episodes/files/{file_id}", status_code=204)
async def delete_episode_file(file_id: int, sonarr: SonarrClient = Depends(get_sonarr)) -> None:
    """Drop one episode's file so a search can replace it; the episode itself
    and its monitoring stay."""
    await sonarr.delete_episode_file(file_id)
    cache.set("library_map:series", None)


@router.post("/library/series/{series_id}/seasons/{season}/monitor", status_code=204)
async def season_monitor(
    series_id: int, season: int, body: MonitorIn, sonarr: SonarrClient = Depends(get_sonarr)
) -> None:
    series = await sonarr.get_series(series_id)
    for s in series.get("seasons", []):
        if s.get("seasonNumber") == season:
            s["monitored"] = body.monitored
            break
    else:
        raise HTTPException(404, "season not found")
    await sonarr.update_series(series_id, series)


@router.post("/library/series/{series_id}/seasons/{season}/search", status_code=204)
async def season_search(
    series_id: int, season: int, sonarr: SonarrClient = Depends(get_sonarr)
) -> None:
    await sonarr.command({"name": "SeasonSearch", "seriesId": series_id, "seasonNumber": season})


@router.patch("/library/episodes/monitor", status_code=204)
async def episodes_monitor(
    body: EpisodeMonitorIn, sonarr: SonarrClient = Depends(get_sonarr)
) -> None:
    await sonarr.monitor_episodes(body.ids, body.monitored)


@router.post("/library/episodes/search", status_code=204)
async def episodes_search(body: EpisodeIdsIn, sonarr: SonarrClient = Depends(get_sonarr)) -> None:
    await sonarr.command({"name": "EpisodeSearch", "episodeIds": body.ids})


@router.patch("/library/series/{series_id}")
async def update_series(
    series_id: int, body: LibraryUpdateIn, sonarr: SonarrClient = Depends(get_sonarr)
) -> dict:
    series = await sonarr.get_series(series_id)
    if body.monitored is not None:
        series["monitored"] = body.monitored
    if body.quality_profile_id is not None:
        series["qualityProfileId"] = body.quality_profile_id
    updated = await sonarr.update_series(series_id, series)
    cache.set("library_map:series", None)
    return {
        "id": updated["id"],
        "monitored": updated.get("monitored", False),
        "quality_profile_id": updated.get("qualityProfileId"),
    }


@router.delete("/library/series/{series_id}", status_code=204)
async def delete_series(
    series_id: int, delete_files: bool = False, sonarr: SonarrClient = Depends(get_sonarr)
) -> None:
    await sonarr.delete_series(series_id, delete_files)
    cache.set("library_map:series", None)
