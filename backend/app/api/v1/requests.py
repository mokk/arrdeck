"""Overseerr's request queue, with approve and decline."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache, cached, guarded
from ...clients.overseerr import OverseerrClient
from ...deps import get_overseerr
from ...schemas import (
    MediaRequestOut,
    ServiceBlock,
)
from .posters import proxy_poster

router = APIRouter(tags=["requests"])

TMDB_IMG = "https://image.tmdb.org/t/p/w342"


async def _describe_request(overseerr: OverseerrClient, req: dict) -> dict:
    """Overseerr's request list carries only a tmdbId, so the title comes from
    a second lookup — cheap enough since Overseerr caches TMDB itself."""
    media = req.get("media") or {}
    kind = req.get("type") or media.get("mediaType") or "movie"
    tmdb = media.get("tmdbId")
    title, year, poster = "", None, None
    if tmdb:
        try:
            details = await (
                overseerr.movie_details(tmdb) if kind == "movie" else overseerr.tv_details(tmdb)
            )
        except Exception:  # noqa: BLE001 — a missing title must not drop the request
            details = {}
        title = details.get("title") or details.get("name") or ""
        date = details.get("releaseDate") or details.get("firstAirDate") or ""
        year = date[:4] or None
        if details.get("posterPath"):
            poster = proxy_poster(TMDB_IMG + details["posterPath"])
    return {
        "id": req.get("id", 0),
        "type": kind,
        "status": req.get("status", 0),
        "title": title,
        "year": year,
        "poster": poster,
        "requested_by": (req.get("requestedBy") or {}).get("displayName") or "",
        "created_at": req.get("createdAt"),
        "seasons": [s.get("seasonNumber") for s in (req.get("seasons") or []) if s.get("seasonNumber")],
    }


@router.get("/requests", response_model=ServiceBlock[list[MediaRequestOut]])
async def media_requests(
    filter: str = "pending",
    take: int = 20,
    overseerr: OverseerrClient = Depends(get_overseerr),
):
    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            payload = await overseerr.requests(filter, take)
            results = payload.get("results") or []
            return list(
                await asyncio.gather(*(_describe_request(overseerr, r) for r in results))
            )

        return await cached(f"requests:{filter}:{take}", 60, call)

    return await guarded(fetch(), f"requests:{filter}")


@router.post("/requests/{request_id}/{action}", status_code=204)
async def request_action(
    request_id: int, action: str, overseerr: OverseerrClient = Depends(get_overseerr)
) -> None:
    if action not in ("approve", "decline"):
        raise HTTPException(404, f"unknown action {action!r}")
    await overseerr.request_action(request_id, action)
    cache.clear()  # the pending list and the arrs' queues both just changed
