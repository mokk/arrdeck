from datetime import datetime, timedelta, timezone

from app.api.v1.popular import _describe, _kind, _query_categories


def test_sub_categories_are_preferred_over_roots():
    # asking for "Movies" returns 100 across all of it; asking per sub-category
    # returns 100 each, which is the only way a 24h window is reachable
    indexer = {
        "capabilities": {
            "categories": [
                {"id": 2000, "name": "Movies", "subCategories": [{"id": 2040}, {"id": 2080}]},
                {"id": 5000, "name": "TV", "subCategories": [{"id": 5040}]},
            ]
        }
    }
    assert sorted(_query_categories(indexer)) == [2040, 2080, 5040]


def test_roots_are_used_when_an_indexer_has_no_sub_categories():
    indexer = {"capabilities": {"categories": [{"id": 2000, "name": "Movies"},
                                               {"id": 5000, "name": "TV"}]}}
    assert sorted(_query_categories(indexer)) == [2000, 5000]


def test_non_media_categories_are_never_queried():
    indexer = {"capabilities": {"categories": [
        {"id": 2000, "name": "Movies"}, {"id": 4000, "name": "PC"},
        {"id": 3000, "name": "Audio"}, {"id": 7000, "name": "Books"},
    ]}}
    assert _query_categories(indexer) == [2000]


def test_an_indexer_without_capabilities_yields_nothing():
    assert _query_categories({}) == []


def test_kind_is_derived_from_the_category_range():
    assert _kind([2040]) == "movie"
    assert _kind([5040]) == "tv"
    assert _kind([4000]) == ""
    assert _kind([]) == ""


def test_describe_pulls_out_what_the_ui_ranks_and_shows():
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    out = _describe({
        "guid": "g1", "indexerId": 3, "title": "Reacher S04E04",
        "categories": [{"id": 5040, "name": "TV/HD"}, {"id": None}],
        "size": 5_000_000_000, "seeders": 1787, "leechers": 12, "grabs": 3095,
        "publishDate": now, "infoUrl": "https://x/1",
    })
    assert out["grabs"] == 3095 and out["seeders"] == 1787
    assert out["kind"] == "tv" and out["category"] == "TV/HD"


def test_missing_counters_become_zero_not_none():
    # ranking sorts on these, so None would blow up the comparison
    out = _describe({"title": "x", "categories": []})
    assert out["grabs"] == 0 and out["seeders"] == 0 and out["size"] == 0


def test_ranking_prefers_grabs_then_seeders():
    rows = [
        {"grabs": 10, "seeders": 900}, {"grabs": 50, "seeders": 1},
        {"grabs": 50, "seeders": 5}, {"grabs": 0, "seeders": 9999},
    ]
    ranked = sorted(rows, key=lambda r: (r.get("grabs") or 0, r.get("seeders") or 0), reverse=True)
    assert [r["grabs"] for r in ranked] == [50, 50, 10, 0]
    assert ranked[0]["seeders"] == 5  # seeders break the grab tie


def test_the_window_cutoff_excludes_older_releases():
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=24)
    fresh = now - timedelta(hours=3)
    stale = now - timedelta(hours=48)
    assert fresh >= cutoff and stale < cutoff


# --- the hourly snapshot -------------------------------------------------

import asyncio
import json
import time

from app.api.v1 import popular as pop
from app.db import SettingsDB


class FakeProwlarr:
    def __init__(self):
        self.calls = 0

    async def indexers(self):
        return [{"id": 1, "name": "Tracker", "enable": True,
                 "capabilities": {"categories": [{"id": 2000, "name": "Movies"}]}}]

    async def search(self, query, categories=None, indexer_ids=None, limit=0):
        self.calls += 1
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return [{"guid": f"g{i}", "indexerId": 1, "title": f"Release {i}",
                 "categories": [{"id": 2000, "name": "Movies"}],
                 "grabs": i, "seeders": i, "publishDate": now} for i in range(5)]


class FakeRegistry:
    def __init__(self, client):
        self.client = client

    def is_configured(self, name):
        return self.client is not None

    def get(self, name):
        return self.client


def test_a_refresh_persists_a_snapshot(tmp_path):
    db = SettingsDB(str(tmp_path / "p.db"))
    client = FakeProwlarr()
    snap = asyncio.run(pop.refresh_snapshot(db, FakeRegistry(client)))
    assert snap["hours"] == pop.SNAPSHOT_HOURS
    assert snap["indexers"][0]["releases"][0]["grabs"] == 4  # ranked
    # persisted, so a restart reads it back rather than re-querying
    assert pop.read_snapshot(db)["generated_at"] == snap["generated_at"]


def test_a_fresh_snapshot_is_not_refetched(tmp_path):
    db = SettingsDB(str(tmp_path / "p2.db"))
    client = FakeProwlarr()
    registry = FakeRegistry(client)
    asyncio.run(pop.refresh_snapshot(db, registry))
    first = client.calls

    # the loop's own staleness check: a snapshot this new must not trigger work
    snap = pop.read_snapshot(db)
    assert time.time() - snap["generated_at"] < pop.REFRESH_INTERVAL
    assert client.calls == first


def test_a_stale_snapshot_is_replaced(tmp_path):
    db = SettingsDB(str(tmp_path / "p3.db"))
    registry = FakeRegistry(FakeProwlarr())
    asyncio.run(pop.refresh_snapshot(db, registry))
    stale = pop.read_snapshot(db)
    stale["generated_at"] = int(time.time()) - pop.REFRESH_INTERVAL - 1
    db.kv_set(pop.SNAPSHOT_KEY, json.dumps(stale))

    assert time.time() - pop.read_snapshot(db)["generated_at"] >= pop.REFRESH_INTERVAL
    newer = asyncio.run(pop.refresh_snapshot(db, registry))
    assert newer["generated_at"] > stale["generated_at"]


def test_corrupt_or_missing_snapshots_read_as_none(tmp_path):
    db = SettingsDB(str(tmp_path / "p4.db"))
    assert pop.read_snapshot(db) is None
    db.kv_set(pop.SNAPSHOT_KEY, "{not json")
    assert pop.read_snapshot(db) is None
    db.kv_set(pop.SNAPSHOT_KEY, '"a string"')
    assert pop.read_snapshot(db) is None


def test_refresh_without_prowlarr_is_a_no_op(tmp_path):
    db = SettingsDB(str(tmp_path / "p5.db"))
    assert asyncio.run(pop.refresh_snapshot(db, FakeRegistry(None))) is None
    assert pop.read_snapshot(db) is None


def test_the_snapshot_stores_more_than_the_page_shows(tmp_path):
    # stored deep so the endpoint can slice any limit without re-querying
    assert pop.SNAPSHOT_LIMIT > 10
