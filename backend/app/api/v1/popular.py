"""What is actually being downloaded right now, per indexer.

Torznab has no notion of "trending", so this is built from an empty-query RSS
fetch and ranked by the indexer's own grab count. Prowlarr caps every search at
100 results and ignores offset, so a single movies+tv query only reaches back a
few hours on a busy tracker — the fan-out below asks each sub-category
separately, which is what makes a 24h window reachable at all.
"""

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from ...cache import cached, guarded
from ...clients.prowlarr import ProwlarrClient
from ...deps import get_prowlarr
from ...schemas import PopularIndexerOut, ServiceBlock

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


@router.get("/popular", response_model=ServiceBlock[list[PopularIndexerOut]])
async def popular(
    hours: int = 24,
    limit: int = 10,
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
):
    hours = max(1, min(hours, 168))
    limit = max(1, min(limit, 50))

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
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

            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            # dedupe within an indexer: the same release shows up under every
            # sub-category it is tagged with
            seen: dict[int, dict[str, dict]] = {i["id"]: {} for i in indexers}
            for indexer, rows in zip(owners, results):
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

        # the fan-out takes ~30s and hits real trackers; don't repeat it per view
        return await cached(f"popular:{hours}:{limit}", 900, call)

    return await guarded(fetch(), f"popular:{hours}:{limit}")
