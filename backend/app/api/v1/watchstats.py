"""Watch statistics from Plex's own play history — who watched what, how much,
and when — joined to the arrs so a title links to its page. And the plex.tv
watchlist, with what of it is already in the library."""

import asyncio
import time
from collections import Counter, defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Request

from ...cache import cached, guarded
from ...clients.plex import PlexClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_plex, get_radarr, get_sonarr
from ...schemas import SearchResultOut, ServiceBlock, WatchStatsOut
from .dashboard import _has
from .discover import _poster
from .plex import _guid_keys
from .posters import proxy_poster

router = APIRouter(tags=["plex"])

TOP = 10
HOUR_MS = 3_600_000


async def catalogue(plex: PlexClient) -> dict[str, dict]:
    """Plex ratingKey → runtime and ids, for every movie and show. A show's
    duration is its usual episode length, which is what a play of it costs."""

    async def build() -> dict[str, dict]:
        sections = [s for s in await plex.sections() if s.get("type") in ("movie", "show")]
        results = await asyncio.gather(*(plex.section_items(s["key"]) for s in sections))
        return {
            str(item["ratingKey"]): {
                "duration": item.get("duration") or 0,
                "guids": _guid_keys(item),
            }
            for items in results
            for item in items
            if item.get("ratingKey")
        }

    return await cached("plex:catalogue", 3600, build)


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def build_stats(
    history: list[dict],
    titles: dict[str, dict],
    accounts: dict[int, str],
    movies: dict[str, dict],
    series: dict[str, dict],
    days: int,
    tz: str,
) -> dict:
    """`movies`/`series` are the arr titles keyed by "tmdb:ID" / "tvdb:ID"."""
    zone = _zone(tz)
    weekday, hour = [0] * 7, [0] * 24
    users: dict[int, dict] = defaultdict(lambda: {"plays": 0, "ms": 0})
    shows: dict[str, dict] = {}
    films: dict[str, dict] = {}
    kinds: Counter = Counter()
    total_ms = 0
    for play in history:
        kind = play.get("type")
        if kind not in ("movie", "episode"):
            continue
        kinds[kind] += 1
        key = str(
            (play.get("grandparentKey") if kind == "episode" else play.get("key")) or ""
        ).rsplit("/", 1)[-1]
        entry = titles.get(key, {})
        ms = entry.get("duration") or 0
        total_ms += ms
        account = users[play.get("accountID") or 0]
        account["plays"] += 1
        account["ms"] += ms
        if viewed := play.get("viewedAt"):
            local = datetime.fromtimestamp(viewed, zone)
            weekday[local.weekday()] += 1
            hour[local.hour] += 1
        bucket, name = (
            (shows, play.get("grandparentTitle"))
            if kind == "episode"
            else (films, play.get("title"))
        )
        row = bucket.setdefault(
            key or name or "",
            {"title": name or "", "plays": 0, "ms": 0, "guids": entry.get("guids", [])},
        )
        row["plays"] += 1
        row["ms"] += ms

    def link(row: dict, arr: dict[str, dict], id_key: str) -> dict:
        match = next((arr[g] for g in row["guids"] if g in arr), None)
        return {
            "title": row["title"],
            "plays": row["plays"],
            "hours": round(row["ms"] / HOUR_MS, 1),
            "poster": _poster(match.get("images")) if match else None,
            id_key: match.get("id") if match else None,
        }

    def ranked(rows: dict[str, dict]) -> list[dict]:
        return sorted(rows.values(), key=lambda r: (-r["plays"], r["title"]))[:TOP]

    return {
        "days": days,
        "plays": kinds["movie"] + kinds["episode"],
        "hours": round(total_ms / HOUR_MS, 1),
        "movies": kinds["movie"],
        "episodes": kinds["episode"],
        "users": sorted(
            (
                {
                    "name": accounts.get(uid) or f"#{uid}",
                    "plays": u["plays"],
                    "hours": round(u["ms"] / HOUR_MS, 1),
                }
                for uid, u in users.items()
            ),
            key=lambda u: -u["plays"],
        ),
        "top_shows": [link(r, series, "series_id") for r in ranked(shows)],
        "top_movies": [link(r, movies, "movie_id") for r in ranked(films)],
        "by_weekday": weekday,
        "by_hour": hour,
    }


def _by_guid(items: list[dict], source: str, field: str) -> dict[str, dict]:
    return {f"{source}:{i[field]}": i for i in items if i.get(field)}


@router.get("/plex/stats", response_model=ServiceBlock[WatchStatsOut])
async def watch_stats(
    request: Request,
    days: int = Query(30, ge=0, le=3650),
    tz: str = "UTC",
    plex: PlexClient = Depends(get_plex),
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
):
    """`days=0` is all time. Hours are estimated from runtimes."""

    async def fetch() -> dict:
        async def call() -> dict:
            since = 0 if days == 0 else int(time.time()) - days * 86400
            history, titles, accounts, movies, series = await asyncio.gather(
                plex.history(since),
                catalogue(plex),
                plex.accounts(),
                radarr.movies() if _has(request, "radarr") else asyncio.sleep(0, []),
                sonarr.series() if _has(request, "sonarr") else asyncio.sleep(0, []),
            )
            return build_stats(
                history,
                titles,
                accounts,
                _by_guid(movies, "tmdb", "tmdbId"),
                _by_guid(series, "tvdb", "tvdbId"),
                days,
                tz,
            )

        return await cached(f"plex:stats:{days}:{tz}", 600, call)

    return await guarded(fetch(), f"plex:stats:{days}:{tz}:block")


def _ids(item: dict) -> dict[str, str]:
    out = {}
    for guid in item.get("Guid") or []:
        source, _, value = (guid.get("id") or "").partition("://")
        if value:
            out[source] = value
    return out


def watchlist_rows(items: list[dict], movies: list[dict], series: list[dict]) -> list[dict]:
    """The watchlist as search results, so the clients' add flow takes it as
    is. Items the arrs have are marked, with their id and whether they're done."""
    have_movies = {m["tmdbId"]: m for m in movies if m.get("tmdbId")}
    have_series = {s["tvdbId"]: s for s in series if s.get("tvdbId")}
    rows = []
    for item in items:
        kind = item.get("type")
        ids = _ids(item)
        if kind == "movie" and ids.get("tmdb", "").isdigit():
            remote = int(ids["tmdb"])
            match = have_movies.get(remote)
            done = bool(match and match.get("hasFile"))
        elif kind == "show" and ids.get("tvdb", "").isdigit():
            remote = int(ids["tvdb"])
            match = have_series.get(remote)
            stats = (match or {}).get("statistics") or {}
            done = bool(match and stats.get("percentOfEpisodes", 0) >= 100)
        else:
            continue  # nothing an arr could add
        rows.append(
            {
                "kind": "movie" if kind == "movie" else "series",
                "title": item.get("title") or "",
                "year": item.get("year") or None,
                "overview": item.get("summary"),
                "remote_id": remote,
                "tmdb_id": int(ids["tmdb"]) if ids.get("tmdb", "").isdigit() else None,
                "imdb_id": ids.get("imdb"),
                "poster": proxy_poster(item.get("thumb")),
                "in_library": match is not None,
                "library_id": match.get("id") if match else None,
                "monitored": match.get("monitored") if match else None,
                "has_file": done if match else None,
            }
        )
    return rows


@router.get("/plex/watchlist", response_model=list[SearchResultOut])
async def plex_watchlist(
    request: Request,
    plex: PlexClient = Depends(get_plex),
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    items, movies, series = await asyncio.gather(
        cached("plex:watchlist", 300, plex.watchlist),
        radarr.movies() if _has(request, "radarr") else asyncio.sleep(0, []),
        sonarr.series() if _has(request, "sonarr") else asyncio.sleep(0, []),
    )
    return watchlist_rows(items, movies, series)
