"""What happened since the client last looked: imports, failures and grabs
from the arrs, finished torrents from the clients. The badge on the Activity
tab and its "New" list are both built from this."""

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request

from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...clients.transmission import TransmissionClient
from ...deps import get_qbit, get_radarr, get_readarr, get_sonarr, get_transmission
from ...schemas import ActivityEventOut, ActivitySinceOut
from .dashboard import EVENT_LABELS, _has

router = APIRouter(tags=["activity"])

# History events worth a badge. Renames, deletes and ignores are noise here.
NOTABLE = {"imported", "failed", "fetched", "incomplete"}


def parse_since(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(422, "since must be an ISO 8601 timestamp") from exc
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def history_events(app: str, records: list[dict], since: datetime) -> list[dict]:
    out = []
    for rec in records:
        raw = rec.get("date") or ""
        try:
            when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if when.tzinfo is None:
            when = when.replace(tzinfo=UTC)
        if when <= since:
            continue
        kind = EVENT_LABELS.get(rec.get("eventType", ""), rec.get("eventType", ""))
        if kind not in NOTABLE:
            continue
        out.append(
            {
                "kind": kind,
                "app": app,
                "title": rec.get("sourceTitle") or "",
                "date": when.isoformat(),
                "movie_id": rec.get("movieId"),
                "series_id": rec.get("seriesId"),
                "book_id": rec.get("bookId"),
            }
        )
    return out


def completed_torrents(
    client: str, torrents: list[dict], since: datetime, done_key: str, name_key: str
) -> list[dict]:
    threshold = since.timestamp()
    out = []
    for t in torrents:
        done = t.get(done_key) or 0
        if done <= threshold:
            continue
        out.append(
            {
                "kind": "completed",
                "app": client,
                "title": t.get(name_key) or "",
                "date": datetime.fromtimestamp(done, tz=UTC).isoformat(),
            }
        )
    return out


@router.get("/activity/since", response_model=ActivitySinceOut)
async def activity_since(
    since: str,
    request: Request,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
):
    cutoff = parse_since(since)
    items: list[dict] = []

    async def arr(app: str, client) -> list[dict]:
        if not _has(request, app):
            return []
        try:
            payload = await client.history(page_size=100)
        except Exception:  # noqa: BLE001 — one service down is not a reason to badge nothing
            return []
        return history_events(app, payload.get("records", []), cutoff)

    async def qbit_done() -> list[dict]:
        if not _has(request, "qbittorrent"):
            return []
        try:
            return completed_torrents(
                "qbittorrent", await qbit.torrents(), cutoff, "completion_on", "name"
            )
        except Exception:  # noqa: BLE001
            return []

    async def tm_done() -> list[dict]:
        if not _has(request, "transmission"):
            return []
        try:
            return completed_torrents(
                "transmission", await tm.torrents(), cutoff, "doneDate", "name"
            )
        except Exception:  # noqa: BLE001
            return []

    for chunk in await asyncio.gather(
        arr("radarr", radarr),
        arr("sonarr", sonarr),
        arr("readarr", readarr),
        qbit_done(),
        tm_done(),
    ):
        items.extend(chunk)
    items.sort(key=lambda e: e["date"], reverse=True)
    return ActivitySinceOut(
        since=cutoff.isoformat(),
        now=datetime.now(UTC).isoformat(),
        count=len(items),
        items=[ActivityEventOut(**e) for e in items[:200]],
    )
