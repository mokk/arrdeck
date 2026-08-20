"""What is actually being downloaded right now, per indexer.

Torznab has no notion of "trending", so this is built from an empty-query RSS
fetch and ranked by the indexer's own grab count. Prowlarr caps every search at
100 results and ignores offset, so a single movies+tv query only reaches back a
few hours on a busy tracker — the fan-out below asks each sub-category
separately, which is what makes a 24h window reachable at all.
"""

import asyncio
import json
import logging
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Request

from ...cache import guarded
from ...clients.base import ServiceUnavailable
from ...clients.prowlarr import ProwlarrClient
from ...schemas import PopularSnapshotOut, ServiceBlock

logger = logging.getLogger("arrdeck.popular")

router = APIRouter(tags=["popular"])

MOVIE_ROOT, TV_ROOT = 2000, 5000
# Prowlarr fans each of these out to the tracker, so keep the pressure modest.
MAX_CONCURRENCY = 4
PER_QUERY = 100


def _kind(category_ids: list[int]) -> str:
    if any(MOVIE_ROOT <= c < 3000 for c in category_ids):
        return "movie"
    if any(TV_ROOT <= c < 6000 for c in category_ids):
        return "tv"
    return ""


def _query_categories(indexer: dict) -> list[int]:
    """Sub-categories where the indexer has them, roots otherwise.

    Asking for 'Movies' returns the 100 newest across all of them; asking for
    'Movies/HD' and 'Movies/WEB-DL' separately returns 100 of each, which is
    how the window gets deep enough to be worth showing.
    """
    out: list[int] = []
    for category in (indexer.get("capabilities") or {}).get("categories") or []:
        root = category.get("id")
        if not isinstance(root, int) or not (
            MOVIE_ROOT <= root < 3000 or TV_ROOT <= root < 6000
        ):
            continue
        subs = [s.get("id") for s in category.get("subCategories") or [] if isinstance(s.get("id"), int)]
        out.extend(subs or [root])
    return out


def _describe(release: dict) -> dict:
    ids = [c.get("id") for c in release.get("categories") or [] if isinstance(c.get("id"), int)]
    names = [c.get("name") for c in release.get("categories") or [] if c.get("name")]
    return {
        "guid": release.get("guid") or release.get("downloadUrl") or "",
        "indexer_id": release.get("indexerId", 0),
        "title": release.get("title", ""),
        "category": names[0] if names else None,
        "kind": _kind(ids),
        "size": release.get("size") or 0,
        "seeders": release.get("seeders") or 0,
        "leechers": release.get("leechers") or 0,
        "grabs": release.get("grabs") or 0,
        "published": release.get("publishDate"),
        "info_url": release.get("infoUrl"),
    }


SNAPSHOT_KEY = "popular_snapshot"
SNAPSHOT_HOURS = 24
SNAPSHOT_LIMIT = 50  # stored deep enough that the page can slice any limit
REFRESH_INTERVAL = 3600


async def collect(prowlarr: ProwlarrClient, hours: int, limit: int) -> list[dict]:
    """Query every indexer's movie/TV sub-categories and rank what is inside
    the window. This is the expensive part: ~10 real tracker queries."""
    indexers = [i for i in await prowlarr.indexers() if i.get("enable")]
    gate = asyncio.Semaphore(MAX_CONCURRENCY)

    async def one(indexer_id: int, category: int) -> list:
        async with gate:
            try:
                return await prowlarr.search(
                    "", categories=[category], indexer_ids=[indexer_id], limit=PER_QUERY
                )
            except Exception:  # noqa: BLE001 — one dead category shouldn't empty the page
                return []

    jobs, owners = [], []
    for indexer in indexers:
        for category in _query_categories(indexer):
            jobs.append(one(indexer["id"], category))
            owners.append(indexer)
    results = await asyncio.gather(*jobs)

    cutoff = datetime.now(UTC) - timedelta(hours=hours)
    # dedupe within an indexer: a release appears under every sub-category it
    # is tagged with
    seen: dict[int, dict[str, dict]] = {i["id"]: {} for i in indexers}
    for indexer, rows in zip(owners, results, strict=False):
        bucket = seen[indexer["id"]]
        for row in rows:
            published = row.get("publishDate")
            if not published:
                continue
            try:
                when = datetime.fromisoformat(published.replace("Z", "+00:00"))
            except ValueError:
                continue
            if when < cutoff:
                continue
            key = row.get("downloadUrl") or row.get("guid") or row.get("title", "")
            bucket.setdefault(key, row)

    out = []
    for indexer in indexers:
        bucket = seen[indexer["id"]]
        ranked = sorted(
            bucket.values(),
            key=lambda r: (r.get("grabs") or 0, r.get("seeders") or 0),
            reverse=True,
        )
        out.append(
            {
                "indexer": indexer.get("name", ""),
                "indexer_id": indexer["id"],
                "scanned": len(bucket),
                "releases": [_describe(r) for r in ranked[:limit]],
            }
        )
    return out


def read_snapshot(db) -> dict | None:
    raw = db.kv_get(SNAPSHOT_KEY)
    if not raw:
        return None
    try:
        snap = json.loads(raw)
    except ValueError:
        return None
    return snap if isinstance(snap, dict) else None


async def refresh_snapshot(db, registry) -> dict | None:
    """Recompute and persist. Stored in sqlite rather than the in-memory cache
    so a redeploy doesn't send the next visitor to a 45-second cold fetch."""
    if not registry.is_configured("prowlarr"):
        return None
    indexers = await collect(registry.get("prowlarr"), SNAPSHOT_HOURS, SNAPSHOT_LIMIT)
    snap = {
        "generated_at": int(time.time()),
        "hours": SNAPSHOT_HOURS,
        "indexers": indexers,
    }
    db.kv_set(SNAPSHOT_KEY, json.dumps(snap))
    logger.info(
        "popular refreshed: %d indexers, %d releases",
        len(indexers),
        sum(len(i["releases"]) for i in indexers),
    )
    return snap


async def popular_loop(db, registry) -> None:
    """Hourly refresh. Runs once at startup only if there is no snapshot yet,
    so a restart doesn't re-hit the trackers unnecessarily."""
    while True:
        try:
            snap = read_snapshot(db)
            age = time.time() - (snap or {}).get("generated_at", 0)
            if snap is None or age >= REFRESH_INTERVAL:
                await refresh_snapshot(db, registry)
        except Exception:
            logger.exception("popular refresh failed")
        await asyncio.sleep(300)


@router.get("/popular", response_model=ServiceBlock[PopularSnapshotOut])
async def popular(
    request: Request,
    hours: int = SNAPSHOT_HOURS,
    limit: int = 10,
):
    """Served from the hourly snapshot. A window other than the stored one is
    computed live, which is slow — the UI only ever asks for the stored one."""
    limit = max(1, min(limit, SNAPSHOT_LIMIT))
    db = request.app.state.db
    registry = request.app.state.registry

    async def fetch() -> dict:
        snap = read_snapshot(db) if hours == SNAPSHOT_HOURS else None
        if snap is None:
            if hours != SNAPSHOT_HOURS:
                if not registry.is_configured("prowlarr"):
                    raise ServiceUnavailable("prowlarr", "not configured")
                indexers = await collect(registry.get("prowlarr"), hours, limit)
                return {"generated_at": int(time.time()), "hours": hours, "indexers": indexers}
            # first boot: build it now rather than show an empty page
            snap = await refresh_snapshot(db, registry)
            if snap is None:
                raise ServiceUnavailable("prowlarr", "not configured")
        return {
            **snap,
            "indexers": [
                {**i, "releases": (i.get("releases") or [])[:limit]} for i in snap["indexers"]
            ],
        }

    return await guarded(fetch(), None)
