"""Installing arrdeck's webhook into Radarr/Sonarr's Connect settings.

Rather than making the user copy a URL into two web UIs, arrdeck creates the
notification itself over the arr API. The arrs validate a new Connect entry by
posting a Test payload to it, so a successful install also proves the arr can
reach us — and lands a test notification on the phone.
"""

import logging
import secrets
from urllib.parse import urlparse

import httpx

from .clients.base import ServiceUnavailable
from .db import SettingsDB
from .registry import Registry

logger = logging.getLogger("arrdeck.webhooks")

HOOK_APPS = ("radarr", "sonarr")
WEBHOOK_NAME = "arrdeck"
TOKEN_KEY = "webhook_token"
BASE_URL_KEY = "webhook_base_url"
DEFAULT_PORT = 3500

# Applied on top of the arr's own Webhook schema, and only for keys that schema
# actually has — the two apps name their triggers differently and keep adding
# new ones, so anything unknown here is simply skipped.
#
# Every trigger arrdeck understands is enabled here even when the matching
# notification is switched off in the app: filtering happens in push.notify(),
# so toggling an event on takes effect immediately instead of needing a
# reinstall. The exception is Sonarr's onImportComplete, which fires alongside
# onDownload for the same files and would inflate the coalesced episode count.
WEBHOOK_FLAGS = {
    "onGrab": True,
    "onDownload": True,
    "onImportComplete": False,
    "onUpgrade": True,
    "onRename": False,
    "onMovieAdded": True,
    "onSeriesAdd": True,
    "onMovieDelete": False,
    "onSeriesDelete": False,
    "onMovieFileDelete": False,
    "onEpisodeFileDelete": False,
    "onMovieFileDeleteForUpgrade": False,
    "onEpisodeFileDeleteForUpgrade": False,
    "onHealthIssue": True,
    "onHealthRestored": True,
    "includeHealthWarnings": True,
    "onApplicationUpdate": False,
    "onManualInteractionRequired": True,
    "onDownloadFailure": True,
    "onImportFailure": True,
}


def token(db: SettingsDB) -> str:
    """The shared secret in the hook URL; created on first use."""
    value = db.kv_get(TOKEN_KEY)
    if not value:
        value = secrets.token_urlsafe(24)
        db.kv_set(TOKEN_KEY, value)
    return value


def hook_url(base_url: str, db: SettingsDB, app_name: str) -> str:
    return f"{base_url.rstrip('/')}/api/v1/hooks/{token(db)}/{app_name}"


def guess_base_url(db: SettingsDB) -> str:
    """Best guess at how the arrs can reach arrdeck: same host, arrdeck's port.

    Radarr and Sonarr are containers on the same box in the common setup, so
    their configured host is also arrdeck's — but the public hostname the phone
    uses usually isn't routable from inside the LAN.
    """
    stored = db.kv_get(BASE_URL_KEY)
    if stored:
        return stored
    conf = db.all()
    for name in HOOK_APPS:
        host = urlparse(conf.get(name, {}).get("url", "")).hostname
        if host:
            return f"http://{host}:{DEFAULT_PORT}"
    return f"http://localhost:{DEFAULT_PORT}"


def _error_text(exc: Exception) -> str:
    """Pull the arr's validation message out of a failed save."""
    if isinstance(exc, ServiceUnavailable):
        return exc.message
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            body = exc.response.json()
        except ValueError:
            return f"HTTP {exc.response.status_code}"
        if isinstance(body, list) and body:
            first = body[0]
            if isinstance(first, dict):
                return first.get("errorMessage") or str(first)
        if isinstance(body, dict):
            return body.get("message") or body.get("error") or str(body)
        return f"HTTP {exc.response.status_code}"
    return str(exc) or type(exc).__name__


def _find_existing(notifications: list) -> dict | None:
    for entry in notifications:
        if entry.get("name") == WEBHOOK_NAME:
            return entry
        fields = {f.get("name"): f.get("value") for f in entry.get("fields") or []}
        if "/api/v1/hooks/" in str(fields.get("url") or ""):
            return entry
    return None


async def _build_payload(client, url: str) -> dict:
    schemas = await client.notification_schemas()
    base = next((s for s in schemas if s.get("implementation") == "Webhook"), None)
    if base is None:
        raise ValueError("this app has no Webhook connection type")
    payload = dict(base)
    payload["name"] = WEBHOOK_NAME
    payload["tags"] = []
    payload["fields"] = [dict(f) for f in payload.get("fields") or []]
    for field in payload["fields"]:
        if field.get("name") == "url":
            field["value"] = url
        elif field.get("name") == "method":
            field["value"] = 1  # POST
    for flag, value in WEBHOOK_FLAGS.items():
        if flag in payload:
            payload[flag] = value
    return payload


async def status(db: SettingsDB, registry: Registry) -> list[dict]:
    out = []
    for app_name in HOOK_APPS:
        row = {"app": app_name, "configured": registry.is_configured(app_name),
               "installed": False, "url": "", "error": ""}
        if row["configured"]:
            try:
                existing = _find_existing(await registry.get(app_name).notifications())
            except Exception as exc:  # noqa: BLE001 — a down arr must not break the page
                row["error"] = _error_text(exc)
            else:
                if existing:
                    fields = {f.get("name"): f.get("value") for f in existing.get("fields") or []}
                    row["installed"] = True
                    row["url"] = str(fields.get("url") or "")
        out.append(row)
    return out


async def install(db: SettingsDB, registry: Registry, base_url: str) -> list[dict]:
    base_url = base_url.strip().rstrip("/")
    results = []
    for app_name in HOOK_APPS:
        row = {"app": app_name, "installed": False, "error": ""}
        if not registry.is_configured(app_name):
            results.append(row)
            continue
        client = registry.get(app_name)
        url = hook_url(base_url, db, app_name)
        try:
            payload = await _build_payload(client, url)
            existing = _find_existing(await client.notifications())
            if existing:
                if existing.get("id") is None:
                    # Matched an arrdeck-shaped entry the arr gave no id for.
                    # Adding a second one would leave the user with duplicate
                    # notifications and no way to tell them apart, so refuse.
                    raise ValueError("existing webhook has no id")
                payload["id"] = existing["id"]
                # the arr validates on save by posting a Test payload to the url
                await client.update_notification(existing["id"], payload)
            else:
                await client.add_notification(payload)
            row["installed"] = True
        except Exception as exc:  # noqa: BLE001 — report per app, keep going
            logger.warning("webhook install failed for %s: %s", app_name, exc)
            row["error"] = _error_text(exc)
        results.append(row)
    # Persist only once an arr has accepted the URL. It was stored first, and
    # guess_base_url prefers the stored value, so a typo stuck permanently: every
    # later attempt reused the bad value instead of guessing again.
    if any(row["installed"] for row in results):
        db.kv_set(BASE_URL_KEY, base_url)
    return results


async def uninstall(db: SettingsDB, registry: Registry) -> list[dict]:
    results = []
    for app_name in HOOK_APPS:
        row = {"app": app_name, "installed": False, "error": ""}
        if registry.is_configured(app_name):
            client = registry.get(app_name)
            try:
                existing = _find_existing(await client.notifications())
                if existing:
                    await client.delete_notification(existing["id"])
            except Exception as exc:  # noqa: BLE001
                # The entry is still live in the arr, so say so. Reporting
                # installed=False here read as "removed" while push kept firing,
                # with only a separate error string to contradict it.
                row["installed"] = True
                row["error"] = _error_text(exc)
        results.append(row)
    return results
