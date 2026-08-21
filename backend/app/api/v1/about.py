"""What this backend is and what it can do.

A client shipped alongside this backend never needed to ask — it was built from
the same commit. A client that talks to *any* arrdeck does: without this it has
to call an endpoint and read a 404 to discover the endpoint is missing, which is
indistinguishable from a bad path or a proxy problem.

Features are derived from the router that is actually mounted, not from a list
maintained by hand, so this cannot claim a capability that is not wired up.
"""

from fastapi import APIRouter, Request

from ...schemas import AboutOut
from ...version import VERSION

router = APIRouter(tags=["system"])

# Feature name -> the route path that implements it. The name is the contract a
# client codes against; the path is checked against the live router, so deleting
# an endpoint withdraws its feature automatically.
FEATURE_ROUTES: dict[str, str] = {
    "diagnose": "/api/v1/diagnose/{app}/{item_id}",
    "credits": "/api/v1/library/movies/{movie_id}/credits",
    "quality_profiles": "/api/v1/quality-profiles/{app}",
    "scheduled_tasks": "/api/v1/tasks",
    "arr_backups": "/api/v1/arr-backups",
    "blocklist": "/api/v1/blocklist",
    "push": "/api/v1/push/subscribe",
    "passkeys": "/api/v1/auth/login/options",
    "popular": "/api/v1/popular",
    "calendar": "/api/v1/calendar",
    "wanted": "/api/v1/wanted/{app}",
    "manual_import": "/api/v1/manual-import/{app}",
    "interactive_search": "/api/v1/releases/movie/{movie_id}",
    "subtitles": "/api/v1/subtitles",
    "vpn": "/api/v1/vpn",
    "backup_restore": "/api/v1/restore",
}


def available_features(app) -> list[str]:
    """Read the mounted paths from the OpenAPI schema rather than `app.routes`.

    Sub-routers are not flattened into `app.routes` — they sit behind an opaque
    included-router object whose children are reachable only through private
    attributes. The schema is the framework's own public view of what is served,
    and FastAPI caches it after the first call.
    """
    mounted = set(app.openapi().get("paths") or {})
    return sorted(name for name, path in FEATURE_ROUTES.items() if path in mounted)


@router.get("/about", response_model=AboutOut)
async def about(request: Request) -> AboutOut:
    """Behind the same auth as everything else, deliberately.

    Exempting it would hand an unauthenticated caller a version number and a
    capability list, and this backend is reachable from the internet. The 401 is
    itself the signal a client needs: reach /about, get 401, pair, ask again —
    which also separates "an arrdeck that wants pairing" from "not an arrdeck".
    """
    return AboutOut(
        name="arrdeck",
        version=VERSION,
        features=available_features(request.app),
    )
