"""Power tools: exclusions, the release name tester, and the season grid."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request

from ...cache import cache
from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_readarr, get_sonarr
from ...schemas import ExclusionOut, ParseOut, SeasonGridOut
from .dashboard import _has
from .discover import _poster

router = APIRouter(tags=["tools"])

# Where each arr keeps the titles its lists may not add back.
EXCLUSION_PATHS = {
    "radarr": "/exclusions",
    "sonarr": "/importlistexclusion",
    "readarr": "/importlistexclusion",
}


def exclusion_row(app: str, e: dict) -> dict:
    if app == "radarr":
        return {
            "app": app,
            "id": e["id"],
            "title": e.get("movieTitle"),
            "year": e.get("movieYear") or None,
            "remote_id": str(e.get("tmdbId")) if e.get("tmdbId") else None,
        }
    if app == "sonarr":
        return {
            "app": app,
            "id": e["id"],
            "title": e.get("title"),
            "remote_id": str(e.get("tvdbId")) if e.get("tvdbId") else None,
        }
    return {
        "app": app,
        "id": e["id"],
        "title": e.get("authorName") or e.get("title"),
        "remote_id": e.get("foreignId"),
    }


@router.get("/exclusions", response_model=list[ExclusionOut])
async def exclusions(
    request: Request,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> list[dict]:
    """Everything the arrs keep off their lists, newest first."""
    clients = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    apps = [a for a in clients if _has(request, a)]
    results = await asyncio.gather(
        *(clients[a].get(EXCLUSION_PATHS[a]) for a in apps), return_exceptions=True
    )
    rows = []
    for app, result in zip(apps, results, strict=True):
        if isinstance(result, BaseException):
            continue
        items = result.get("records", []) if isinstance(result, dict) else result
        rows += [exclusion_row(app, e) for e in items]
    return sorted(rows, key=lambda r: -r["id"])


@router.delete("/exclusions/{app}/{exclusion_id}", status_code=204)
async def remove_exclusion(
    app: str,
    exclusion_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> None:
    """Let the lists add it again."""
    clients = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    await clients[app].request("DELETE", f"{EXCLUSION_PATHS[app]}/{exclusion_id}")
    cache.set("radarr:recommendations", None)


def parse_row(app: str, title: str, d: dict) -> dict:
    info = d.get("parsedMovieInfo") or d.get("parsedEpisodeInfo") or {}
    quality = (info.get("quality") or {}).get("quality") or {}
    languages = [
        lang.get("name")
        for lang in (info.get("languages") or d.get("languages") or [])
        if lang.get("name")
    ]
    match = d.get("movie") or d.get("series") or {}
    return {
        "app": app,
        "title": title,
        "parsed_title": (info.get("movieTitles") or [None])[0]
        if app == "radarr"
        else info.get("seriesTitle"),
        "year": info.get("year") or None,
        "season": info.get("seasonNumber") if app == "sonarr" else None,
        "episodes": info.get("episodeNumbers") or [],
        "full_season": bool(info.get("fullSeason")),
        "quality": quality.get("name"),
        "resolution": quality.get("resolution") or None,
        "source": quality.get("source"),
        "languages": [lang for lang in languages if lang != "Unknown"],
        "release_group": info.get("releaseGroup"),
        "edition": info.get("edition") or None,
        "custom_formats": [c.get("name") for c in d.get("customFormats") or [] if c.get("name")],
        "custom_format_score": d.get("customFormatScore") or 0,
        "match_id": match.get("id"),
        "match_title": match.get("title"),
        "match_episodes": [
            f"S{e.get('seasonNumber', 0):02d}E{e.get('episodeNumber', 0):02d} {e.get('title') or ''}".strip()
            for e in d.get("episodes") or []
        ],
    }


@router.get("/parse/{app}", response_model=ParseOut)
async def parse(
    app: str,
    title: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    """What Radarr or Sonarr makes of a release name: title, quality, custom
    formats and score, and which library title it would go to."""
    clients = {"radarr": radarr, "sonarr": sonarr}
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    title = title.strip()
    if not title:
        raise HTTPException(422, "title is empty")
    return parse_row(app, title, await clients[app].get("/parse", params={"title": title}))


@router.get("/library/series/seasons", response_model=list[SeasonGridOut])
async def season_grid(sonarr: SonarrClient = Depends(get_sonarr)) -> list[dict]:
    """Every show with its seasons, for monitoring many at once."""
    rows = []
    for s in sorted(await sonarr.series(), key=lambda s: s.get("sortTitle", "")):
        seasons = []
        for season in sorted(s.get("seasons") or [], key=lambda x: x.get("seasonNumber", 0)):
            stats = season.get("statistics") or {}
            seasons.append(
                {
                    "number": season.get("seasonNumber", 0),
                    "monitored": season.get("monitored", False),
                    "have": stats.get("episodeFileCount", 0),
                    "total": stats.get("totalEpisodeCount", 0),
                }
            )
        rows.append(
            {
                "id": s["id"],
                "title": s.get("title"),
                "poster": _poster(s.get("images")),
                "monitored": s.get("monitored", False),
                "status": s.get("status"),
                "seasons": seasons,
            }
        )
    return rows
