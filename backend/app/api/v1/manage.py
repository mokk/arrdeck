import asyncio
import copy
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...cache import cache
from ...clients.prowlarr import ProwlarrClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_prowlarr, get_radarr, get_sonarr
from ...schemas import (
    BulkDeleteIn,
    BulkEditIn,
    HistoryEventOut,
    MovieDetailOut,
    MovieFileOut,
    EpisodeIdsIn,
    EpisodeMonitorIn,
    EpisodeOut,
    IndexerOut,
    LibraryMovieOut,
    TagOut,
    LibrarySeriesOut,
    LibraryUpdateIn,
    MonitorIn,
    SeasonOut,
    SeriesDetailOut,
    WantedItemOut,
    WantedPageOut,
)
from .dashboard import EVENT_LABELS
from .media import _poster

router = APIRouter(tags=["manage"])


class AddIndexerIn(BaseModel):
    schema_name: str
    display_name: str = ""
    field_values: dict[str, Any] = {}


async def _schemas(prowlarr: ProwlarrClient) -> list:
    hit = cache.get("indexer_schemas", 3600)
    if hit is None:
        hit = await prowlarr.indexer_schemas()
        cache.set("indexer_schemas", hit)
    return hit


async def _build_indexer_payload(prowlarr: ProwlarrClient, body: AddIndexerIn) -> dict:
    schemas = await _schemas(prowlarr)
    schema = next((s for s in schemas if s["name"] == body.schema_name), None)
    if schema is None:
        raise HTTPException(404, f"unknown indexer definition {body.schema_name!r}")
    payload = copy.deepcopy(schema)
    for field in payload.get("fields", []):
        if field.get("name") in body.field_values:
            field["value"] = body.field_values[field["name"]]
    payload["name"] = body.display_name.strip() or schema["name"]
    payload["enable"] = True
    if not payload.get("appProfileId"):
        profiles = await prowlarr.app_profiles()
        payload["appProfileId"] = profiles[0]["id"] if profiles else 1
    return payload


def _prowlarr_validation_error(exc: httpx.HTTPStatusError) -> str:
    try:
        data = exc.response.json()
        if isinstance(data, list):
            return "; ".join(d.get("errorMessage", "") for d in data) or "validation failed"
        if isinstance(data, dict):
            return data.get("message") or str(data)
        return str(data)
    except Exception:  # noqa: BLE001
        return f"Prowlarr HTTP {exc.response.status_code}"


@router.get("/indexers/schemas")
async def indexer_schemas(prowlarr: ProwlarrClient = Depends(get_prowlarr)) -> list[dict]:
    schemas = await _schemas(prowlarr)
    out = []
    for s in schemas:
        out.append(
            {
                "name": s["name"],
                "protocol": s.get("protocol"),
                "privacy": s.get("privacy"),
                "description": s.get("description"),
                "fields": [
                    {
                        "name": f["name"],
                        "label": f.get("label", f["name"]),
                        "type": f.get("type", "textbox"),
                        "value": f.get("value"),
                        "help_text": f.get("helpText"),
                        "select_options": [
                            {"value": o.get("value"), "name": o.get("name")}
                            for o in (f.get("selectOptions") or [])
                        ],
                    }
                    for f in s.get("fields", [])
                    if not f.get("advanced")
                    and f.get("name") != "definitionFile"
                    and f.get("type") not in ("info", "tag", "tagSelect", "device")
                ],
            }
        )
    return sorted(out, key=lambda s: s["name"].lower())


@router.post("/indexers/test-new", status_code=204)
async def test_new_indexer(
    body: AddIndexerIn, prowlarr: ProwlarrClient = Depends(get_prowlarr)
) -> None:
    payload = await _build_indexer_payload(prowlarr, body)
    try:
        await prowlarr.test_indexer(payload)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(400, _prowlarr_validation_error(exc)) from exc


@router.post("/indexers", status_code=201)
async def add_indexer(
    body: AddIndexerIn, prowlarr: ProwlarrClient = Depends(get_prowlarr)
) -> dict:
    payload = await _build_indexer_payload(prowlarr, body)
    try:
        created = await prowlarr.add_indexer(payload)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(400, _prowlarr_validation_error(exc)) from exc
    return {"id": created.get("id"), "name": created.get("name")}


@router.get("/indexers", response_model=list[IndexerOut])
async def indexers(prowlarr: ProwlarrClient = Depends(get_prowlarr)) -> list[dict]:
    items = await prowlarr.indexers()
    return [
        {
            "id": i["id"],
            "name": i.get("name"),
            "enable": i.get("enable", False),
            "protocol": i.get("protocol"),
            "privacy": i.get("privacy"),
        }
        for i in items
    ]


@router.patch("/indexers/{indexer_id}")
async def toggle_indexer(
    indexer_id: int, enable: bool, prowlarr: ProwlarrClient = Depends(get_prowlarr)
) -> dict:
    items = await prowlarr.indexers()
    full = next((i for i in items if i["id"] == indexer_id), None)
    if full is None:
        raise HTTPException(404, "indexer not found")
    full["enable"] = enable
    updated = await prowlarr.update_indexer(indexer_id, full)
    return {"id": updated["id"], "enable": updated.get("enable", False)}


@router.post("/indexers/{indexer_id}/test", status_code=204)
async def test_indexer(indexer_id: int, prowlarr: ProwlarrClient = Depends(get_prowlarr)) -> None:
    items = await prowlarr.indexers()
    full = next((i for i in items if i["id"] == indexer_id), None)
    if full is None:
        raise HTTPException(404, "indexer not found")
    await prowlarr.test_indexer(full)


@router.get("/tags/{app}", response_model=list[TagOut])
async def tags(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    return [
        {"id": t["id"], "label": t.get("label", "")}
        for t in sorted(await client.tags(), key=lambda t: t.get("label", ""))
    ]


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
    return SeriesDetailOut(
        id=series["id"],
        title=series.get("title"),
        poster=_poster(series.get("images")),
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


@router.get("/profiles")
async def quality_profiles(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    r, s = await asyncio.gather(radarr.quality_profiles(), sonarr.quality_profiles())

    def slim(profiles: list) -> list[dict]:
        return [
            {
                "id": p["id"],
                "name": p["name"],
                "upgrade_allowed": p.get("upgradeAllowed", False),
                "cutoff": p.get("cutoff"),
            }
            for p in profiles
        ]

    return {"radarr": slim(r), "sonarr": slim(s)}


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
