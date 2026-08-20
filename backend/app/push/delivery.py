"""Getting a notification onto a device: VAPID keys and the web-push send."""

import asyncio
import json

from py_vapid import Vapid, b64urlencode
from pywebpush import WebPushException, webpush

from ..db import SettingsDB
from .events import Event, enabled_events, logger

VAPID_CLAIMS = {"sub": "mailto:arrdeck@thrawn.dk"}


async def send_test(db: SettingsDB, endpoint: str = "") -> int:
    """Deliver a test banner, to one device when an endpoint is given."""
    event = Event(key="test", app="arrdeck", title="Test notification", url="/manage")
    return await asyncio.to_thread(
        _send_all, db, event.title, event.label, event.url, event.tag, "test", endpoint
    )


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


def _private_key_b64(pem: str) -> str:
    # pywebpush's vapid_private_key only takes a file path or the raw
    # base64url-encoded key — handing it PEM content fails to deserialize.
    vapid = Vapid.from_pem(pem.encode())
    raw = vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    return b64urlencode(raw)


def _send_all(
    db: SettingsDB,
    title: str,
    body: str,
    url: str,
    tag: str,
    event_key: str = "",
    only_endpoint: str = "",
) -> int:
    """Deliver to every subscription that wants this event; returns how many."""
    pem = db.kv_get("vapid_private_pem")
    if pem is None:
        return 0
    key = _private_key_b64(pem)
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    default = enabled_events(db)
    sent = 0
    for raw, events in db.push_targets():
        sub = json.loads(raw)
        if only_endpoint and sub.get("endpoint") != only_endpoint:
            continue
        # a device that hasn't chosen its own set follows the global default
        if (
            event_key
            and event_key != "test"
            and event_key not in (default if events is None else events)
        ):
            continue
        try:
            webpush(sub, payload, vapid_private_key=key, vapid_claims=dict(VAPID_CLAIMS))
            sent += 1
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):  # subscription expired
                db.push_remove(sub.get("endpoint", ""))
            else:
                logger.warning("push failed: %s", exc)
        except Exception:  # noqa: BLE001 — one bad subscription must not block the rest
            logger.exception("push failed for %s", sub.get("endpoint", ""))
    return sent
