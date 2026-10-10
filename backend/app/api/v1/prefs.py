"""Display preferences shared by every client signed in to this server.

One household, so one set: layouts, tab order, date and size style, theme and
palette. Stored as a single JSON value in the settings store (which the backup
carries): {"values": {...}, "updated_at": <unix ms>}. Clients keep their own
copy and reconcile with this one, so it works offline and between the PWA and
the iOS app. The contract is on the two routes below.

The server never reads a key, so a client can add a preference without a
backend change.
"""

import json
import threading
import time

from fastapi import APIRouter, Request

from ...schemas import PrefsIn, PrefsOut

router = APIRouter(tags=["settings"])

KEY = "display_prefs"

# check-then-write must not interleave: two PUTs arriving together would both
# pass the staleness check against the same stored value
_write = threading.Lock()


def load(db) -> dict:
    try:
        stored = json.loads(db.kv_get(KEY) or "{}")
        return {"values": dict(stored["values"]), "updated_at": int(stored["updated_at"])}
    except (ValueError, KeyError, TypeError):
        return {"values": {}, "updated_at": 0}


@router.get("/prefs", response_model=PrefsOut)
def get_prefs(request: Request) -> dict:
    """The stored set: {values, updated_at}. updated_at is unix milliseconds of
    the write that produced it; values is {} and updated_at 0 until something
    has been written."""
    return load(request.app.state.db)


@router.put("/prefs", response_model=PrefsOut)
def put_prefs(body: PrefsIn, request: Request) -> dict:
    """Replaces the whole set with {values, updated_at}, unless the server holds
    a newer one. Always answers with what is stored now.

    Last write wins: a PUT whose updated_at (unix milliseconds) is older than the
    stored one changes nothing, and the answer carries the stored values and a
    greater updated_at than was sent, which tells the client its write lost and
    the returned values are the ones to adopt. An equal updated_at is accepted,
    so a retry is harmless. One in the future is clamped to the server's clock,
    so a device with a wrong clock cannot lock out the others; the answer carries
    the clamped value, which the client should record as its sync time.

    values must be flat. Keys are 1-64 characters, at most 100 of them; each
    value is a string, number, boolean, null or an array of strings; the whole
    object is at most 16 KB. Anything else is a 422. A client should send back,
    unchanged, any key it does not know.
    """
    db = request.app.state.db
    updated_at = min(body.updated_at, int(time.time() * 1000))
    with _write:
        if updated_at >= load(db)["updated_at"]:
            db.kv_set(KEY, json.dumps({"values": body.values, "updated_at": updated_at}))
        return load(db)
