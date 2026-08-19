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
