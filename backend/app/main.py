import asyncio
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

mimetypes.add_type("application/manifest+json", ".webmanifest")

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api.v1.auth import is_request_allowed
from .api.v1.router import router as v1_router
from .clients.base import ServiceUnavailable
from .config import get_settings
from .db import SettingsDB
from .registry import Registry
from .push import flush_loop, push_loop
from .stats import sampler_loop

# Docker layout: /srv/arrdeck/{app,static}. Dev layout: arrdeck/{backend/app,frontend/dist}.
_here = Path(__file__).resolve().parent
STATIC_DIR = next(
    (
        d
        for d in (_here.parent / "static", _here.parent.parent.parent / "frontend" / "dist")
        if (d / "index.html").exists()
    ),
    _here.parent / "static",
)


def _seed_from_env(db: SettingsDB) -> None:
    """First boot: populate the settings DB from environment/.env values."""
    s = get_settings()
    seeds = {
        "radarr": {"url": s.radarr_url, "api_key": s.radarr_api_key},
        "sonarr": {"url": s.sonarr_url, "api_key": s.sonarr_api_key},
        "prowlarr": {"url": s.prowlarr_url, "api_key": s.prowlarr_api_key},
        "qbittorrent": {
            "url": s.qbit_url,
            "username": s.qbit_username,
            "password": s.qbit_password,
        },
        "transmission": {"url": s.transmission_url},
        "overseerr": {"url": s.overseerr_url, "api_key": s.overseerr_api_key},
        "gluetun": {"url": s.gluetun_url, "api_key": s.gluetun_api_key},
        "bazarr": {"url": s.bazarr_url, "api_key": s.bazarr_api_key},
    }
    for name, values in seeds.items():
        db.upsert(name, values)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    timeout = httpx.Timeout(settings.request_timeout)
    arr_http = httpx.AsyncClient(timeout=timeout)
    qbit_http = httpx.AsyncClient(timeout=timeout)  # own client: cookie jar for SID
    tm_http = httpx.AsyncClient(timeout=timeout)

    db = SettingsDB(settings.db_path)
    if db.is_empty():
        _seed_from_env(db)
    registry = Registry(arr_http, qbit_http, tm_http)
    registry.rebuild_all(db.all())
    app.state.db = db
    app.state.registry = registry
    app.state.http = arr_http
    tasks = [
        asyncio.create_task(sampler_loop(db, registry)),
        asyncio.create_task(push_loop(db, registry)),
        asyncio.create_task(flush_loop(db)),
    ]
    yield
    for task in tasks:
        task.cancel()
    for client in (arr_http, qbit_http, tm_http):
        await client.aclose()


app = FastAPI(title="arrdeck", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)


OPEN_PREFIXES = ("/api/v1/auth/", "/api/v1/hooks/")


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    """Everything under /api requires LAN origin or a passkey session; the
    auth endpoints themselves (and the static shell) stay reachable so the
    login screen can function. Webhook targets carry their own secret in the
    path — Radarr and Sonarr have no way to hold a session."""
    path = request.url.path
    if path.startswith("/api/") and not path.startswith(OPEN_PREFIXES):
        if not is_request_allowed(request):
            return JSONResponse(status_code=401, content={"detail": "unauthorized"})
    return await call_next(request)


@app.exception_handler(ServiceUnavailable)
async def service_unavailable_handler(request: Request, exc: ServiceUnavailable) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "code": "service_unavailable",
                "service": exc.service,
                "message": exc.message,
            }
        },
    )


# --- SPA serving (production build copied to ./static by the Dockerfile) ---
if (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        candidate = STATIC_DIR / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})
