"""Trakt's public lists — trending, most anticipated, popular — as search
results on the Add page. Trakt has no artwork, so each title's poster comes
from the arr's own lookup, cached a day per title."""

import asyncio
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, Request

from ...cache import cache, cached
from ...clients.base import ServiceUnavailable
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...clients.trakt import TraktClient
from ...deps import get_radarr, get_sonarr
from ...schemas import SearchResultOut
from .dashboard import _has
from .discover import _library_map, _poster
from .posters import proxy_poster

router = APIRouter(tags=["discover"])

LIST_TTL = 3600
POSTER_TTL = 86400


def get_trakt(request: Request) -> TraktClient:
    return request.app.state.registry.get("trakt")


def trakt_rows(items: list[dict], kind: str) -> list[dict]:
    """Movies are keyed by TMDB id (Radarr's), shows by TVDB id (Sonarr's);
    a title without that id cannot be added, so it is left out."""
    id_field = "tmdb" if kind == "movie" else "tvdb"
    rows = []
    for item in items:
        ids = item.get("ids") or {}
        remote = ids.get(id_field)
        if not remote:
            continue
        rows.append(
            {
                "kind": kind,
                "title": item.get("title") or "",
                "year": item.get("year") or None,
                "overview": item.get("overview"),
                "remote_id": remote,
                "tmdb_id": ids.get("tmdb"),
                "imdb_id": ids.get("imdb"),
            }
        )
    return rows


def lookup_poster(results: list[dict]) -> str | None:
    first = (results or [{}])[0]
    if first.get("remotePoster"):
        return proxy_poster(first["remotePoster"])
    return _poster(first.get("images"))


async def poster_for(client, kind: str, remote: int) -> str | None:
    key = f"trakt:poster:{kind}:{remote}"
    hit = cache.get(key, POSTER_TTL)
    if hit is not None:
        return hit or None
    term = f"tmdb:{remote}" if kind == "movie" else f"tvdb:{remote}"
    try:
        poster = lookup_poster(await client.lookup(term))
    except (ServiceUnavailable, httpx.HTTPError):
        return None  # not cached: the next load tries again
    cache.set(key, poster or "")
    return poster


@router.get("/discover/trakt", response_model=list[SearchResultOut])
async def trakt_list(
    request: Request,
    kind: Literal["movie", "series"],
    which: Literal["trending", "anticipated", "popular"] = "trending",
    trakt: TraktClient = Depends(get_trakt),
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    arr = radarr if kind == "movie" else sonarr
    app = "radarr" if kind == "movie" else "sonarr"

    async def fetch() -> list[dict]:
        return trakt_rows(await trakt.list("movies" if kind == "movie" else "shows", which), kind)

    rows = await cached(f"trakt:{kind}:{which}", LIST_TTL, fetch)
    if not _has(request, app):
        return [{**r, "in_library": False} for r in rows]
    library, posters = await asyncio.gather(
        _library_map(arr, kind),
        asyncio.gather(*(poster_for(arr, kind, r["remote_id"]) for r in rows)),
    )
    return [
        {
            **r,
            "poster": poster,
            "in_library": r["remote_id"] in library,
            **library.get(r["remote_id"], {}),
        }
        for r, poster in zip(rows, posters, strict=True)
    ]
