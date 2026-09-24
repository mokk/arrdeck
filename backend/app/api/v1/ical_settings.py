"""Switching the calendar subscription on, off, or onto a new secret. The feed
itself is app/ical.py, outside /api, since calendar apps cannot sign in."""

from fastapi import APIRouter, Request

from ...ical import APPS, TOKEN_KEY, current_token, new_token
from ...schemas import IcalSettingsOut
from .dashboard import _has

router = APIRouter(tags=["settings"])


def payload(request: Request) -> dict:
    token = current_token(request.app.state.db)
    return {"enabled": bool(token), "token": token, "apps": [a for a in APPS if _has(request, a)]}


@router.get("/ical/settings", response_model=IcalSettingsOut)
async def ical_settings(request: Request) -> dict:
    return payload(request)


@router.post("/ical/settings/token", response_model=IcalSettingsOut)
async def ical_new_token(request: Request) -> dict:
    """Turns the feed on, or replaces its secret: the old URL stops working."""
    request.app.state.db.kv_set(TOKEN_KEY, new_token())
    return payload(request)


@router.delete("/ical/settings/token", response_model=IcalSettingsOut)
async def ical_disable(request: Request) -> dict:
    request.app.state.db.kv_set(TOKEN_KEY, "")
    return payload(request)
