"""Reading status: to read, reading, read. Readarr has no such notion, so it
lives in arrdeck's settings store — one JSON value, which the backup already
carries — and follows you between the PWA and the app."""

import json
import time

from fastapi import APIRouter, Request

from ...schemas import ReadingIn, ReadingOut

router = APIRouter(tags=["library"])

KEY = "reading.status"


def load(db) -> dict[str, dict]:
    try:
        return json.loads(db.kv_get(KEY) or "{}")
    except ValueError:
        return {}


def apply(statuses: dict[str, dict], book_id: int, status: str | None, now: int) -> dict[str, dict]:
    """The map after one change. Marking read stamps when; moving a finished
    book back to reading or to-read forgets that date."""
    out = dict(statuses)
    key = str(book_id)
    if status is None:
        out.pop(key, None)
        return out
    previous = out.get(key) or {}
    finished = previous.get("finished_at") if previous.get("status") == "read" else None
    out[key] = {
        "status": status,
        "finished_at": (finished or now) if status == "read" else None,
        "updated_at": now,
    }
    return out


@router.get("/library/books/reading", response_model=dict[str, ReadingOut])
def reading(request: Request) -> dict:
    return load(request.app.state.db)


@router.put("/library/books/{book_id}/reading", response_model=dict[str, ReadingOut])
def set_reading(book_id: int, body: ReadingIn, request: Request) -> dict:
    db = request.app.state.db
    statuses = apply(load(db), book_id, body.status, int(time.time()))
    db.kv_set(KEY, json.dumps(statuses))
    return statuses
