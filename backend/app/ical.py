"""One calendar subscription for Radarr, Sonarr and Readarr together.

Calendar apps (Apple Calendar, Google Calendar, Outlook) poll a URL and
cannot sign in, so the feed lives outside /api under a secret token in its
path, the way the OPDS feed does, and the token can be replaced or switched
off in Settings. Each arr's own iCal feed is fetched with its key and their
events are merged under one calendar; the arr keys never leave arrdeck.
"""

import asyncio
import hmac
import logging
import secrets

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from .cache import cached
from .clients.base import ServiceUnavailable

router = APIRouter(include_in_schema=False)
log = logging.getLogger("arrdeck.ical")

TOKEN_KEY = "ical.token"
APPS = ("radarr", "sonarr", "readarr")
PAST_DAYS = 14
FUTURE_DAYS = 90
FEED_TTL = 900  # calendar apps poll every 15 minutes to a day


def new_token() -> str:
    return secrets.token_urlsafe(24)


def current_token(db) -> str | None:
    return db.kv_get(TOKEN_KEY) or None


def check_token(request: Request, token: str) -> None:
    expected = current_token(request.app.state.db)
    # constant-time, and a disabled feed looks the same as a wrong token
    if not expected or not hmac.compare_digest(expected, token):
        raise HTTPException(404, "not found")


def events(ics: str) -> list[str]:
    """The VEVENT blocks of a calendar, verbatim — folded lines included."""
    out: list[str] = []
    block: list[str] | None = None
    for line in ics.splitlines():
        if line == "BEGIN:VEVENT":
            block = [line]
        elif block is not None:
            block.append(line)
            if line == "END:VEVENT":
                out.append("\r\n".join(block))
                block = None
    return out


def merge(blocks: list[str], name: str = "arrdeck") -> str:
    head = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//arrdeck//calendar//EN",
        "CALSCALE:GREGORIAN",
        f"NAME:{name}",
        f"X-WR-CALNAME:{name}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]
    return "\r\n".join([*head, *blocks, "END:VCALENDAR"]) + "\r\n"


def pick_apps(raw: str | None, configured: set[str]) -> list[str]:
    wanted = [a.strip() for a in raw.split(",")] if raw else list(APPS)
    return [a for a in APPS if a in wanted and a in configured]


async def app_events(request: Request, app: str) -> list[str]:
    client = request.app.state.registry.get(app)

    async def fetch() -> list[str]:
        return events(await client.calendar_feed(PAST_DAYS, FUTURE_DAYS))

    try:
        return await cached(f"ical:{app}", FEED_TTL, fetch)
    except (
        ServiceUnavailable,
        httpx.HTTPError,
    ) as exc:  # one arr down should not empty the whole calendar
        log.warning("calendar feed failed", extra={"service": app, "error": str(exc)})
        return []


@router.get("/ical/{token}/arrdeck.ics")
async def feed(request: Request, token: str, apps: str | None = None) -> Response:
    """`?apps=sonarr` (or `radarr,readarr`) subscribes to part of it."""
    check_token(request, token)
    registry = request.app.state.registry
    chosen = pick_apps(apps, {a for a in APPS if registry.is_configured(a)})
    per_app = await asyncio.gather(*(app_events(request, a) for a in chosen))
    body = merge([e for blocks in per_app for e in blocks])
    return Response(
        body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="arrdeck.ics"'},
    )
