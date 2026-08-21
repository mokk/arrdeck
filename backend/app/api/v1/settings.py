import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ... import webhooks
from ...api.v1.auth import is_request_allowed
from ...cache import cache
from ...db import SERVICES
from ...push import (
    EVENT_LABELS,
    WEBHOOK_SEEN_KEY,
    enabled_events,
    ensure_vapid,
    get_rules,
    in_quiet_hours,
    send_test,
    set_enabled_events,
    set_rules,
)
from ...registry import probe_version
from ...schemas import (
    BackupOut,
    PushEventsIn,
    PushEventsOut,
    PushRulesIn,
    PushRulesOut,
    PushSubscribeIn,
    PushTestIn,
    PushTestOut,
    RestoreIn,
    RestoreOut,
    ServiceInfoOut,
    ServiceSettingsOut,
    SettingsExportOut,
    SettingsImportIn,
    StatsSampleOut,
    WebhookAppOut,
    WebhookInstallIn,
    WebhookStatusOut,
)

router = APIRouter(tags=["settings"])


class ServiceSettingsIn(BaseModel):
    url: str = ""
    api_key: str = ""
    username: str = ""
    password: str = ""


def _check_name(name: str) -> None:
    if name not in SERVICES:
        raise HTTPException(404, f"unknown service {name!r}")


@router.get("/services", response_model=list[ServiceInfoOut])
def services(request: Request) -> list[dict]:
    registry = request.app.state.registry
    return [{"service": n, "configured": registry.is_configured(n)} for n in SERVICES]


@router.get("/settings/services", response_model=dict[str, ServiceSettingsOut])
def all_settings(request: Request) -> dict[str, dict]:
    registry = request.app.state.registry
    conf = request.app.state.db.all()
    for name, values in conf.items():
        values["configured"] = registry.is_configured(name)
    return conf


@router.put("/settings/services/{name}")
def save_settings(name: str, body: ServiceSettingsIn, request: Request) -> dict:
    _check_name(name)
    values = {
        "url": body.url.strip().rstrip("/"),
        "api_key": body.api_key.strip(),
        "username": body.username.strip(),
        "password": body.password,
    }
    request.app.state.db.upsert(name, values)
    request.app.state.registry.rebuild(name, values)
    cache.clear()  # cached data may belong to the old connection
    return {"service": name, "configured": request.app.state.registry.is_configured(name)}


@router.get("/push/vapid")
def push_vapid(request: Request) -> dict:
    return {"key": ensure_vapid(request.app.state.db)}


@router.post("/push/subscribe", status_code=204)
def push_subscribe(body: PushSubscribeIn, request: Request) -> None:
    import json as _json

    endpoint = body.subscription.get("endpoint", "")
    if not endpoint:
        raise HTTPException(422, "subscription missing endpoint")
    request.app.state.db.push_add(endpoint, _json.dumps(body.subscription), body.language)


@router.post("/push/unsubscribe", status_code=204)
def push_unsubscribe(body: PushSubscribeIn, request: Request) -> None:
    request.app.state.db.push_remove(body.subscription.get("endpoint", ""))


def _events_payload(db, endpoint: str) -> dict:
    return {
        "available": [{"key": k, "label": v} for k, v in EVENT_LABELS.items()],
        "enabled": enabled_events(db),
        "device": db.push_get_events(endpoint) if endpoint else None,
    }


@router.get("/push/events", response_model=PushEventsOut)
def push_events(request: Request, endpoint: str = "") -> dict:
    return _events_payload(request.app.state.db, endpoint)


@router.put("/push/events", response_model=PushEventsOut)
def save_push_events(body: PushEventsIn, request: Request) -> dict:
    """With a subscribed endpoint the choice is that device's alone; otherwise
    it becomes the default that unconfigured devices follow."""
    db = request.app.state.db
    if body.endpoint and db.push_set_events(body.endpoint, body.enabled):
        return _events_payload(db, body.endpoint)
    set_enabled_events(db, body.enabled)
    return _events_payload(db, body.endpoint)


def _rules_payload(db) -> dict:
    rules = get_rules(db)
    return {**rules, "quiet_now": in_quiet_hours(rules)}


@router.get("/push/rules", response_model=PushRulesOut)
def push_rules(request: Request) -> dict:
    return _rules_payload(request.app.state.db)


@router.put("/push/rules", response_model=PushRulesOut)
def save_push_rules(body: PushRulesIn, request: Request) -> dict:
    db = request.app.state.db
    set_rules(db, body.model_dump())
    return _rules_payload(db)


@router.post("/push/test", response_model=PushTestOut)
async def push_test(body: PushTestIn, request: Request) -> dict:
    sent = await send_test(request.app.state.db, body.endpoint)
    if sent == 0:
        raise HTTPException(404, "no push subscription to deliver to")
    return {"sent": sent}


@router.get("/push/webhook", response_model=WebhookStatusOut)
async def webhook_status(request: Request) -> dict:
    db = request.app.state.db
    last = db.kv_get(WEBHOOK_SEEN_KEY)
    return {
        "base_url": webhooks.guess_base_url(db),
        "last_event": int(last) if last else None,
        "apps": await webhooks.status(db, request.app.state.registry),
    }


@router.post("/push/webhook/install", response_model=list[WebhookAppOut])
async def webhook_install(body: WebhookInstallIn, request: Request) -> list[dict]:
    if not body.base_url.strip():
        raise HTTPException(422, "a base URL is required")
    return await webhooks.install(
        request.app.state.db, request.app.state.registry, body.base_url
    )


@router.post("/push/webhook/uninstall", response_model=list[WebhookAppOut])
async def webhook_uninstall(request: Request) -> list[dict]:
    return await webhooks.uninstall(request.app.state.db, request.app.state.registry)


@router.get("/settings/export", response_model=SettingsExportOut)
def export_settings(request: Request) -> dict:
    return {"services": request.app.state.db.all()}


@router.post("/settings/import", status_code=204)
def import_settings(body: SettingsImportIn, request: Request) -> None:
    for name, values in body.services.items():
        if name in SERVICES:
            request.app.state.db.upsert(name, values)
    request.app.state.registry.rebuild_all(request.app.state.db.all())
    cache.clear()


@router.get("/backup", response_model=BackupOut)
def backup(request: Request) -> dict:
    """A full snapshot. This contains passkey public keys and the VAPID private
    key — it is a credential file, not a settings file."""
    if not is_request_allowed(request):
        raise HTTPException(401, "unauthorized")
    return request.app.state.db.snapshot()


@router.post("/restore", response_model=RestoreOut)
def restore(body: RestoreIn, request: Request) -> dict:
    if not is_request_allowed(request):
        raise HTTPException(401, "unauthorized")
    if body.version != 1:
        raise HTTPException(422, f"unsupported backup version {body.version}")
    db = request.app.state.db
    counts = db.restore(body.model_dump())
    request.app.state.registry.rebuild_all(db.all())
    cache.clear()
    return counts


@router.get("/stats/history", response_model=list[StatsSampleOut])
def stats_history(request: Request, days: int = 30) -> list[dict]:
    return request.app.state.db.samples_since(int(time.time()) - days * 86400)


@router.post("/settings/services/{name}/test")
async def test_service(name: str, request: Request) -> dict:
    _check_name(name)
    client = request.app.state.registry.get(name)
    version = await probe_version(name, client)  # raises ServiceUnavailable -> 502
    return {"service": name, "version": version}
