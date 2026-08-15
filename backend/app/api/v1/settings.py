import time

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ...cache import cache
from ...db import SERVICES
from ...registry import probe_version
from ...schemas import (
    ServiceInfoOut,
    ServiceSettingsOut,
    SettingsExportOut,
    SettingsImportIn,
    StatsSampleOut,
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


@router.get("/stats/history", response_model=list[StatsSampleOut])
def stats_history(request: Request, days: int = 30) -> list[dict]:
    return request.app.state.db.samples_since(int(time.time()) - days * 86400)


@router.post("/settings/services/{name}/test")
async def test_service(name: str, request: Request) -> dict:
    _check_name(name)
    client = request.app.state.registry.get(name)
    version = await probe_version(name, client)  # raises ServiceUnavailable -> 502
    return {"service": name, "version": version}
