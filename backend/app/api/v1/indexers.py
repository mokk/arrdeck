"""Prowlarr indexers: the schema-driven add form, testing and toggling."""

import copy
from typing import Any
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ...cache import cache
from ...clients.prowlarr import ProwlarrClient
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
    BlocklistItemOut,
    ImportListOut,
    LogEntryOut,
    BlocklistPageOut,
    TagOut,
    LibrarySeriesOut,
    LibraryUpdateIn,
    MonitorIn,
    SeasonOut,
    SeriesDetailOut,
    WantedItemOut,
    WantedPageOut,
)

router = APIRouter(tags=["indexers"])

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
