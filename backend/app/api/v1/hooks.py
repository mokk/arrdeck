import secrets

from fastapi import APIRouter, HTTPException, Request

from ...push import handle_webhook
from ...webhooks import HOOK_APPS, token

router = APIRouter(tags=["hooks"])


@router.post("/hooks/{hook_token}/{app_name}", status_code=204, include_in_schema=False)
async def receive(hook_token: str, app_name: str, request: Request) -> None:
    """Radarr/Sonarr Connect target. Unauthenticated by design — the arrs can't
    hold a passkey session — so the secret lives in the URL and a wrong one is
    indistinguishable from a wrong path."""
    db = request.app.state.db
    if app_name not in HOOK_APPS or not secrets.compare_digest(hook_token, token(db)):
        raise HTTPException(404, "not found")
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(422, "expected a JSON body") from None
    if not isinstance(payload, dict):
        raise HTTPException(422, "expected a JSON object")
    await handle_webhook(db, app_name, payload)
