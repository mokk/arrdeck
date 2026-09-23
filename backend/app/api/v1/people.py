"""People from a film's credits: their films in the library, and the ones not.

Radarr answers every credit of every film in one call, but keys them by an
internal metadata id its movie list does not carry. A film's own credits do
carry it, so the map from metadata id to movie id is built once, one call per
film, and kept in the settings database: the pairing never changes, and only
films added since need asking about.
"""

import asyncio
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request

from ...cache import cached
from ...clients.overseerr import OverseerrClient
from ...clients.radarr import RadarrClient
from ...deps import get_overseerr, get_radarr
from ...schemas import PersonOut
from .dashboard import _has
from .discover import _poster
from .posters import TMDB_HEADSHOT_SIZE, proxy_poster

router = APIRouter(tags=["library"])

METADATA_MAP_KEY = "radarr:metadata_map"
MAP_CONCURRENCY = 4
INDEX_TTL = 3600
ELSEWHERE_LIMIT = 40
TMDB_IMG = "https://image.tmdb.org/t/p/original"


async def metadata_map(radarr: RadarrClient, db, movies: list[dict]) -> dict[int, int]:
    """movieMetadataId → movie id, asking Radarr only about films not yet mapped."""
    stored = {int(k): v for k, v in json.loads(db.kv_get(METADATA_MAP_KEY) or "{}").items()}
    known = set(stored.values())
    missing = [m["id"] for m in movies if m["id"] not in known]
    if missing:
        gate = asyncio.Semaphore(MAP_CONCURRENCY)

        async def one(movie_id: int) -> tuple[int, int | None]:
            async with gate:
                try:
                    rows = await radarr.credits(movie_id)
                except Exception:  # noqa: BLE001 — try again next time
                    return movie_id, None
                return movie_id, next((r.get("movieMetadataId") for r in rows), None)

        for movie_id, metadata_id in await asyncio.gather(*(one(m) for m in missing)):
            if metadata_id is not None:
                stored[metadata_id] = movie_id
        db.kv_set(METADATA_MAP_KEY, json.dumps(stored))
    return stored


def index_credits(credits: list[dict], mapping: dict[int, int]) -> dict[int, dict]:
    """Person tmdb id → their name and (movie id, role) pairs, a film once per
    person even when they both wrote and directed it."""
    people: dict[int, dict] = {}
    for c in credits:
        person, movie = c.get("personTmdbId"), mapping.get(c.get("movieMetadataId"))
        if person is None or movie is None:
            continue
        entry = people.setdefault(person, {"name": c.get("personName"), "movies": {}})
        role = c.get("character") if c.get("type") == "cast" else c.get("job")
        entry["movies"].setdefault(movie, role or None)
    return people


async def person_index(radarr: RadarrClient, db) -> tuple[dict[int, dict], dict[int, dict]]:
    async def build() -> dict:
        movies, credits = await asyncio.gather(radarr.movies(), radarr.all_credits())
        mapping = await metadata_map(radarr, db, movies)
        return {
            "people": index_credits(credits, mapping),
            "movies": {m["id"]: m for m in movies},
        }

    built = await cached("people:index", INDEX_TTL, build)
    return built["people"], built["movies"]


def year_of(date: str | None) -> int | None:
    return int(date[:4]) if date and date[:4].isdigit() else None


def elsewhere_rows(credits: dict, in_library: set[int], today: str | None = None) -> list[dict]:
    """The person's released films missing from the library, best known first."""
    today = today or date.today().isoformat()
    seen: set[int] = set()
    rows = []
    for c in sorted(
        [*(credits.get("cast") or []), *(credits.get("crew") or [])],
        key=lambda c: -(c.get("popularity") or 0),
    ):
        tmdb = c.get("id")
        if c.get("mediaType") != "movie" or not tmdb or tmdb in seen or tmdb in in_library:
            continue
        if not c.get("releaseDate") or c["releaseDate"][:10] > today:
            continue  # announced or not out yet: nothing to download
        seen.add(tmdb)
        rows.append(
            {
                "kind": "movie",
                "title": c.get("title") or "",
                "year": year_of(c.get("releaseDate")),
                "overview": c.get("overview"),
                "remote_id": tmdb,
                "tmdb_id": tmdb,
                "poster": proxy_poster(TMDB_IMG + c["posterPath"]) if c.get("posterPath") else None,
            }
        )
    return rows[:ELSEWHERE_LIMIT]


@router.get("/library/people/{tmdb_id}", response_model=PersonOut)
async def person(
    tmdb_id: int,
    request: Request,
    radarr: RadarrClient = Depends(get_radarr),
    overseerr: OverseerrClient = Depends(get_overseerr),
) -> dict:
    people, movies = await person_index(radarr, request.app.state.db)
    entry = people.get(tmdb_id)
    info: dict = {}
    elsewhere: list[dict] = []
    if _has(request, "overseerr"):
        try:
            info, credits = await cached(
                f"person:{tmdb_id}",
                86_400,
                lambda: asyncio.gather(
                    overseerr.person(tmdb_id), overseerr.person_credits(tmdb_id)
                ),
            )
            owned_tmdb = {m.get("tmdbId") for m in movies.values()}
            elsewhere = elsewhere_rows(credits, owned_tmdb)
        except Exception:  # noqa: BLE001 — the library half stands on its own
            info, elsewhere = {}, []
    if entry is None and not info:
        raise HTTPException(404, "no one by that id in the library")
    owned = []
    for movie_id, role in (entry or {}).get("movies", {}).items():
        m = movies.get(movie_id) or {}
        owned.append(
            {
                "movie_id": int(movie_id),
                "title": m.get("title"),
                "year": m.get("year"),
                "poster": _poster(m.get("images")),
                "role": role,
                "has_file": m.get("hasFile", False),
                "monitored": m.get("monitored", False),
            }
        )
    owned.sort(key=lambda r: -(r["year"] or 0))
    profile = info.get("profilePath")
    return {
        "tmdb_id": tmdb_id,
        "name": info.get("name") or (entry or {}).get("name"),
        "image": proxy_poster(TMDB_IMG + profile, TMDB_HEADSHOT_SIZE) if profile else None,
        "known_for": info.get("knownForDepartment"),
        "owned": owned,
        "elsewhere": elsewhere,
    }
