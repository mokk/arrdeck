"""Switching the OPDS feed on, off, or onto a new secret. The feed itself is
app/opds.py, outside /api, since e-reader apps cannot sign in."""

from fastapi import APIRouter, Depends, Request

from ...clients.readarr import ReadarrClient
from ...deps import get_readarr
from ...opds import TOKEN_KEY, current_token, new_token
from ...schemas import OpdsSettingsOut
from .books import DOWNLOAD_FEATURE, fork_features
from .dashboard import _has

router = APIRouter(tags=["settings"])


async def payload(request: Request, readarr: ReadarrClient) -> dict:
    token = current_token(request.app.state.db)
    available = _has(request, "readarr") and DOWNLOAD_FEATURE in await fork_features(readarr)
    return {"enabled": bool(token), "token": token, "available": available}


@router.get("/opds/settings", response_model=OpdsSettingsOut)
async def opds_settings(request: Request, readarr: ReadarrClient = Depends(get_readarr)) -> dict:
    return await payload(request, readarr)


@router.post("/opds/settings/token", response_model=OpdsSettingsOut)
async def opds_new_token(request: Request, readarr: ReadarrClient = Depends(get_readarr)) -> dict:
    """Turns the feed on, or replaces its secret: the old URL stops working."""
    request.app.state.db.kv_set(TOKEN_KEY, new_token())
    return await payload(request, readarr)


@router.delete("/opds/settings/token", response_model=OpdsSettingsOut)
async def opds_disable(request: Request, readarr: ReadarrClient = Depends(get_readarr)) -> dict:
    request.app.state.db.kv_set(TOKEN_KEY, "")
    return await payload(request, readarr)
