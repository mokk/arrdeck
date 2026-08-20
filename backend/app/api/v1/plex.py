"""Plex: what is playing now, and what has been watched."""

import asyncio

from fastapi import APIRouter, Depends

from ...cache import cached, guarded
from ...clients.plex import PlexClient
from ...deps import (
    get_plex,
)
from ...schemas import (
    PlaySessionOut,
    ServiceBlock,
    WatchedItemOut,
)

router = APIRouter(tags=["plex"])


def _plex_session(machine_id: str, item: dict) -> dict:
    kind = item.get("type", "")
    title = item.get("grandparentTitle") if kind == "episode" else item.get("title", "")
    subtitle = None
    if kind == "episode":
        season, number = item.get("parentIndex"), item.get("index")
        subtitle = item.get("title", "")
        if season is not None and number is not None:
            subtitle = f"S{season:02d}E{number:02d} – {subtitle}".rstrip(" –")
    duration = item.get("duration") or 0
    rating_key = item.get("ratingKey")
    return {
        "title": title or "",
        "subtitle": subtitle,
        "kind": kind,
        "user": (item.get("User") or {}).get("title", ""),
        "player": (item.get("Player") or {}).get("title", ""),
        "state": (item.get("Player") or {}).get("state", ""),
        "progress": (item.get("viewOffset") or 0) / duration if duration else 0.0,
        # a transcode session means the server is doing real work for this play
        "transcoding": bool(item.get("TranscodeSession")),
        "url": (
            f"https://app.plex.tv/desktop/#!/server/{machine_id}"
            f"/details?key=/library/metadata/{rating_key}"
            if machine_id and rating_key
            else None
        ),
    }


def _guid_keys(item: dict) -> list[str]:
    """Plex reports imdb/tmdb/tvdb ids per item; index under all of them so
    either arr can join on whichever id it happens to hold."""
    keys = []
    for guid in item.get("Guid") or []:
        raw = guid.get("id") or ""
        if "://" in raw:
            source, _, value = raw.partition("://")
            keys.append(f"{source}:{value}")
    return keys


@router.get("/watched", response_model=ServiceBlock[dict[str, WatchedItemOut]])
async def watched(plex: PlexClient = Depends(get_plex)):
    """Watched state keyed by external id (tmdb:123, imdb:tt123, tvdb:123).

    One call per library section rather than per title — the arrs hold the same
    ids, so the join happens client-side for free.
    """

    async def fetch() -> dict[str, dict]:
        async def call() -> dict[str, dict]:
            identity, sections = await asyncio.gather(
                plex.identity(), plex.sections(), return_exceptions=True
            )
            if isinstance(sections, BaseException):
                raise sections
            machine_id = (
                "" if isinstance(identity, BaseException) else identity.get("machineIdentifier", "")
            )
            wanted = [s for s in sections if s.get("type") in ("movie", "show")]
            results = await asyncio.gather(
                *(plex.section_items(s["key"]) for s in wanted), return_exceptions=True
            )
            out: dict[str, dict] = {}
            for section, items in zip(wanted, results, strict=False):
                if isinstance(items, BaseException):
                    continue
                for item in items:
                    if section.get("type") == "show":
                        total = item.get("leafCount") or 0
                        seen = item.get("viewedLeafCount") or 0
                        progress = seen / total if total else 0.0
                        is_watched = total > 0 and seen >= total
                    else:
                        progress = 1.0 if item.get("viewCount") else 0.0
                        is_watched = bool(item.get("viewCount"))
                    rating_key = item.get("ratingKey")
                    entry = {
                        "watched": is_watched,
                        "progress": progress,
                        "url": (
                            f"https://app.plex.tv/desktop/#!/server/{machine_id}"
                            f"/details?key=/library/metadata/{rating_key}"
                            if machine_id and rating_key
                            else None
                        ),
                    }
                    for key in _guid_keys(item):
                        out[key] = entry
            return out

        return await cached("watched", 600, call)

    return await guarded(fetch(), "watched:block")


@router.get("/sessions", response_model=ServiceBlock[list[PlaySessionOut]])
async def play_sessions(plex: PlexClient = Depends(get_plex)):
    """Who is watching what right now."""

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            identity, items = await asyncio.gather(
                plex.identity(), plex.sessions(), return_exceptions=True
            )
            if isinstance(items, BaseException):
                raise items
            machine_id = (
                "" if isinstance(identity, BaseException) else identity.get("machineIdentifier", "")
            )
            return [_plex_session(machine_id, item) for item in items]

        # short ttl: this is the one card that is meant to be live
        return await cached("sessions", 15, call)

    return await guarded(fetch(), "sessions:block")
