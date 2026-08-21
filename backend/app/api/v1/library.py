"""The movie and series libraries: listing, detail, editing and bulk actions."""

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache, cached
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_sonarr
from ...schemas import (
    BulkDeleteIn,
    BulkEditIn,
    CreditPersonOut,
    CreditsOut,
    EpisodeIdsIn,
    EpisodeMonitorIn,
    EpisodeOut,
    HistoryEventOut,
    LibraryMovieOut,
    LibrarySeriesOut,
    LibraryUpdateIn,
    MonitorIn,
    MovieDetailOut,
    MovieFileOut,
    SeasonOut,
    SeriesDetailOut,
)
from .dashboard import EVENT_LABELS
from .discover import _poster
from .posters import TMDB_HEADSHOT_SIZE, proxy_poster

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


@router.get("/library/series", response_model=list[LibrarySeriesOut])
async def library_series(sonarr: SonarrClient = Depends(get_sonarr)) -> list[dict]:
    items = await sonarr.series()
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
            "quality_profile_id": s.get("qualityProfileId"),
            "poster": _poster(s.get("images")),
            "tags": s.get("tags") or [],
            "tvdb_id": s.get("tvdbId"),
            "imdb_id": s.get("imdbId"),
        }
        for s in sorted(items, key=lambda s: s.get("sortTitle", ""))
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


# Crew is 30 rows deep and includes Thanks, Painter and Stunt Double. These are
# the jobs someone actually looks for on a film's page, Director first.
CREW_JOBS = ("Director", "Screenplay", "Writer", "Story", "Original Music Composer")
CAST_LIMIT = 12
CREW_LIMIT = 6
# A blockbuster can carry four Screenplay credits plus a Story credit, which
# fills the whole crew list with writers and pushes the director out of view.
CREW_PER_JOB = 2


@router.get("/library/movies/{movie_id}/credits", response_model=CreditsOut)
async def movie_credits(
    movie_id: int, radarr: RadarrClient = Depends(get_radarr)
) -> CreditsOut:
    """Top-billed cast and the crew worth naming.

    Kept off the detail response on purpose: credits are ~60 rows per film and
    almost never change, so they cache far longer than the file and monitoring
    state the page reloads for.
    """

    async def build() -> dict:
        rows = await radarr.credits(movie_id)

        def person(row: dict, role_key: str) -> CreditPersonOut:
            images = row.get("images") or []
            headshot = next(
                (i.get("remoteUrl") or i.get("url") for i in images if i.get("remoteUrl")),
                None,
            )
            return CreditPersonOut(
                name=row.get("personName") or "",
                role=row.get(role_key) or None,
                image=proxy_poster(headshot, TMDB_HEADSHOT_SIZE),
                tmdb_id=row.get("personTmdbId"),
            )

        # The arr returns cast unsorted; `order` is TMDB's billing order, so
        # sorting by it is what makes "top billed" mean anything.
        cast = sorted(
            (r for r in rows if r.get("type") == "cast"),
            key=lambda r: r.get("order") if r.get("order") is not None else 999,
        )
        crew_rows = [r for r in rows if r.get("type") == "crew" and r.get("job") in CREW_JOBS]
        crew_rows.sort(key=lambda r: CREW_JOBS.index(r.get("job", "")))
        # One person often holds two of these credits — Screenplay and Story is
        # the common pair — and listing them twice reads as a mistake. Jobs are
        # already in priority order, so the first mention is the one to keep.
        seen_people: set[str] = set()
        per_job: dict[str, int] = {}
        crew = []
        for row in crew_rows:
            name, job = row.get("personName") or "", row.get("job") or ""
            if name in seen_people or per_job.get(job, 0) >= CREW_PER_JOB:
                continue
            seen_people.add(name)
            per_job[job] = per_job.get(job, 0) + 1
            crew.append(row)
        return CreditsOut(
            cast=[person(r, "character") for r in cast[:CAST_LIMIT]],
            crew=[person(r, "job") for r in crew[:CREW_LIMIT]],
        ).model_dump()

    return CreditsOut(**await cached(f"credits:{movie_id}", 86_400, build))


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
    seasons = sorted(
        (_season_out(s) for s in series.get("seasons", [])), key=lambda s: s.number
    )
    stats = series.get("statistics") or {}
    return SeriesDetailOut(
        id=series["id"],
        title=series.get("title"),
        year=series.get("year"),
        overview=series.get("overview"),
        poster=_poster(series.get("images")),
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
    out = [
        EpisodeOut(
            id=e["id"],
            season=e.get("seasonNumber", 0),
            episode=e.get("episodeNumber", 0),
            title=e.get("title"),
            air_date=e.get("airDateUtc"),
            has_file=e.get("hasFile", False),
            monitored=e.get("monitored", False),
        )
        for e in episodes
        if season is None or e.get("seasonNumber") == season
    ]
    return sorted(out, key=lambda e: (e.season, e.episode))


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
    await sonarr.command(
        {"name": "SeasonSearch", "seriesId": series_id, "seasonNumber": season}
    )


@router.patch("/library/episodes/monitor", status_code=204)
async def episodes_monitor(
    body: EpisodeMonitorIn, sonarr: SonarrClient = Depends(get_sonarr)
) -> None:
    await sonarr.monitor_episodes(body.ids, body.monitored)


@router.post("/library/episodes/search", status_code=204)
async def episodes_search(
    body: EpisodeIdsIn, sonarr: SonarrClient = Depends(get_sonarr)
) -> None:
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
