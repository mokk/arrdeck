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
    EpisodeIdsIn,
    EpisodeMonitorIn,
    EpisodeOut,
    IndexerOut,
    LibraryMovieOut,
    LibrarySeriesOut,
    LibraryUpdateIn,
    MonitorIn,
    SeasonOut,
    SeriesDetailOut,
)

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
        }
        for s in sorted(items, key=lambda s: s.get("sortTitle", ""))
    ]


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
    return SeriesDetailOut(id=series["id"], title=series.get("title"), seasons=seasons)


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
