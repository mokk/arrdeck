import asyncio
import json
import logging

from py_vapid import Vapid, b64urlencode
from pywebpush import WebPushException, webpush

from .db import SettingsDB
from .registry import Registry

logger = logging.getLogger("arrdeck.push")

CHECK_INTERVAL = 60
VAPID_CLAIMS = {"sub": "mailto:arrdeck@localhost"}

NOTIFY_EVENTS = {
    "downloadFolderImported": "Downloaded and imported",
    "downloadFailed": "Download failed",
}

HISTORY_PARAMS = {
    "radarr": {"includeMovie": True},
    "sonarr": {"includeSeries": True, "includeEpisode": True},
}


def describe_record(app_name: str, rec: dict) -> str:
    """Human title for a history record: movie name + year, or series + SxxEyy."""
    if app_name == "radarr":
        movie = rec.get("movie") or {}
        name = movie.get("title") or rec.get("sourceTitle") or ""
        year = movie.get("year")
        return f"{name} ({year})" if name and year else name
    series = rec.get("series") or {}
    episode = rec.get("episode") or {}
    name = series.get("title") or rec.get("sourceTitle") or ""
    season = episode.get("seasonNumber")
    number = episode.get("episodeNumber")
    if name and season is not None and number is not None:
        name = f"{name} S{season:02d}E{number:02d}"
        if episode.get("title"):
            name = f"{name} – {episode['title']}"
    return name


def ensure_vapid(db: SettingsDB) -> str:
    """Create/load the VAPID keypair; returns the base64url public key."""
    pem = db.kv_get("vapid_private_pem")
    if pem is None:
        vapid = Vapid()
        vapid.generate_keys()
        pem = vapid.private_pem().decode()
        db.kv_set("vapid_private_pem", pem)
    else:
        vapid = Vapid.from_pem(pem.encode())
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    raw = vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return b64urlencode(raw)


def _send_all(db: SettingsDB, title: str, body: str) -> None:
    pem = db.kv_get("vapid_private_pem")
    if pem is None:
        return
    payload = json.dumps({"title": title, "body": body})
    for raw in db.push_all():
        sub = json.loads(raw)
        try:
            webpush(sub, payload, vapid_private_key=pem, vapid_claims=dict(VAPID_CLAIMS))
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):  # subscription expired
                db.push_remove(sub.get("endpoint", ""))
            else:
                logger.warning("push failed: %s", exc)


async def check_events(db: SettingsDB, registry: Registry) -> None:
    """Notify subscribers about new imports/failures since the last check."""
    if not db.push_all():
        return
    last_seen = db.kv_get("push_last_seen") or ""
    newest = last_seen
    for app_name in ("radarr", "sonarr"):
        if not registry.is_configured(app_name):
            continue
        try:
            hist = await registry.get(app_name).history(
                page_size=20, **HISTORY_PARAMS.get(app_name, {})
            )
        except Exception:  # noqa: BLE001
            continue
        for rec in hist.get("records", []):
            date = rec.get("date", "")
            if date > newest:
                newest = date
            label = NOTIFY_EVENTS.get(rec.get("eventType", ""))
            if label and last_seen and date > last_seen:
                title = describe_record(app_name, rec) or label
                await asyncio.to_thread(_send_all, db, title, label)
    if newest != last_seen:
        db.kv_set("push_last_seen", newest)


async def push_loop(db: SettingsDB, registry: Registry) -> None:
    while True:
        try:
            await check_events(db, registry)
        except Exception:  # noqa: BLE001 — the notifier must never die
            logger.exception("push check failed")
        await asyncio.sleep(CHECK_INTERVAL)
