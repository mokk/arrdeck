"""Cleanup rules delete media, so the deciding and the lifecycle are pinned
here in detail: the pure evaluator, then mark → grace → recheck → delete or
release against a fake library, then the real clients against mock transports.
Nothing here talks to a real server."""

import asyncio
import json

import httpx
import pytest

from app.autoclean import job, store
from app.autoclean.job import CollectionGone, LiveLibrary, Unreachable, plan_run, run
from app.autoclean.rules import (
    DAY,
    GIB,
    Candidate,
    candidate,
    evaluate,
    has_conditions,
    matches,
)
from app.clients.overseerr import OverseerrClient
from app.clients.plex import PlexClient
from app.clients.radarr import RadarrClient
from app.clients.sonarr import SonarrClient

NOW = 1_800_000_000.0


def title(
    i: int,
    kind: str = "movie",
    size: float = 10 * GIB,
    added_days: float | None = 400,
    watched_days: float | None = None,
    progress: float | None = 0.0,
    monitored: bool = True,
    tags: tuple[int, ...] = (),
    rating: float | None = 7.0,
    requested: bool = False,
) -> Candidate:
    """watched_days: fully watched, last that many days ago. progress None: not in Plex."""
    plex = None
    if progress is not None or watched_days is not None:
        plex = {
            "watched": watched_days is not None,
            "progress": 1.0 if watched_days is not None else progress,
            "last_viewed_at": NOW - watched_days * DAY if watched_days is not None else None,
            "key": str(1000 + i),
            "section": "1" if kind == "movie" else "2",
            "section_type": "movie" if kind == "movie" else "show",
        }
    return Candidate(
        kind=kind,
        id=i,
        title=f"T{i}",
        year=2000,
        poster=None,
        size=int(size),
        added=NOW - added_days * DAY if added_days is not None else None,
        monitored=monitored,
        tags=tags,
        rating=rating,
        plex=plex,
        requested=requested,
    )


def rule(rule_id: str = "r1", kind: str = "movie", enabled: bool = True, grace: int = 14, **cond):
    return store.normalise_rule(
        {"id": rule_id, "name": rule_id, "kind": kind, "enabled": enabled, "grace_days": grace}
        | {"conditions": cond}
    )


def ids(evaluation) -> list[int]:
    return [m.candidate.id for m in evaluation.matches]


# --- the evaluator ---------------------------------------------------------------


def test_watched_long_ago_matches_and_nothing_else_does():
    titles = [
        title(1, watched_days=400),
        title(2, watched_days=10),  # watched recently
        title(3, progress=0.5),  # partly watched
        title(4, progress=None),  # Plex does not have it: unknown, not unwatched
        title(5, progress=0.0),  # never watched
    ]
    result = evaluate(titles, rule(watched_days=180), NOW, set())
    assert ids(result) == [1]
    assert result.matches[0].reasons == [{"code": "watched", "value": 400}]


def test_never_watched_needs_plex_to_know_it_and_an_old_added_date():
    titles = [
        title(1, progress=0.0, added_days=400),
        title(2, progress=0.0, added_days=100),
        title(3, progress=0.3, added_days=400),
        title(4, progress=None, added_days=400),
        title(5, watched_days=500, added_days=900),
    ]
    result = evaluate(titles, rule(unwatched_days=365), NOW, set())
    assert ids(result) == [1]
    assert result.matches[0].reasons == [{"code": "unwatched", "value": 400}]


def test_size_counts_in_gib_and_must_be_more_than_the_threshold():
    titles = [title(1, size=50 * GIB), title(2, size=50 * GIB + 1), title(3, size=80 * GIB)]
    assert ids(evaluate(titles, rule(min_size_gb=50), NOW, set())) == [3, 2]


def test_unmonitored_rating_and_tags():
    titles = [
        title(1, monitored=False, rating=4.0, tags=(7,)),
        title(2, monitored=True, rating=4.0, tags=(7,)),
        title(3, monitored=False, rating=6.0, tags=(7,)),
        title(4, monitored=False, rating=None, tags=(7,)),  # no rating is not a low one
        title(5, monitored=False, rating=4.0, tags=(7, 9)),  # carries an excluded tag
        title(6, monitored=False, rating=4.0, tags=()),  # lacks the required tag
    ]
    r = rule(unmonitored=True, rating_below=5.0, with_tags=[7], without_tags=[9])
    result = evaluate(titles, r, NOW, set())
    assert ids(result) == [1]
    assert [x["code"] for x in result.matches[0].reasons] == [
        "unmonitored",
        "rating",
        "without_tags",
        "with_tags",
    ]


def test_conditions_are_anded():
    titles = [
        title(1, watched_days=400, size=60 * GIB),
        title(2, watched_days=400, size=5 * GIB),
        title(3, watched_days=5, size=60 * GIB),
    ]
    assert ids(evaluate(titles, rule(watched_days=180, min_size_gb=50), NOW, set())) == [1]


def test_a_rule_without_conditions_matches_nothing():
    titles = [title(1, monitored=False, watched_days=999)]
    empty = rule()
    assert not has_conditions(empty["conditions"])
    assert evaluate(titles, empty, NOW, set()).matches == []
    assert matches(titles[0], empty, NOW, set()) is None
    # "unmonitored: false" and empty tag lists are not conditions either
    assert evaluate(titles, rule(unmonitored=False, with_tags=[]), NOW, set()).matches == []


def test_a_rule_only_looks_at_its_own_kind_and_at_titles_with_files():
    titles = [title(1, monitored=False), title(2, "series", monitored=False), title(3, size=0)]
    assert ids(evaluate(titles, rule(unmonitored=True), NOW, set())) == [1]
    assert ids(evaluate(titles, rule(kind="series", unmonitored=True), NOW, set())) == [2]


def test_brakes_hold_back_kept_requested_and_recent_titles():
    titles = [
        title(1, monitored=False),
        title(2, monitored=False),  # kept
        title(3, monitored=False, requested=True),
        title(4, monitored=False, added_days=29),
        title(5, monitored=False, added_days=None),  # unknown age is not old
    ]
    result = evaluate(titles, rule(unmonitored=True), NOW, {"movie:2"})
    assert ids(result) == [1]
    assert sorted((c.id, why) for c, why in result.held) == [
        (2, "kept"),
        (3, "requested"),
        (4, "recent"),
        (5, "recent"),
    ]
    for c in titles[1:]:
        assert matches(c, rule(unmonitored=True), NOW, {"movie:2"}) is None


def test_candidate_joins_plex_per_kind_and_requests_by_the_right_ids():
    movie = {
        "id": 1,
        "title": "Dune",
        "tmdbId": 438631,
        "imdbId": "tt1160419",
        "sizeOnDisk": 5,
        "added": "2020-01-01T00:00:00Z",
        "monitored": False,
        "tags": [3],
        "ratings": {"imdb": {"value": 8.0}, "tmdb": {"value": 7.0}},
    }
    show = {
        "id": 2,
        "title": "Show",
        "tvdbId": 99,
        "tmdbId": 438631,  # the same TMDB number as the film
        "statistics": {"sizeOnDisk": 7},
        "added": "2020-01-01T00:00:00Z",
        "ratings": {"value": 6.5},
    }
    movie_map = {"tmdb:438631": {"watched": True, "key": "11"}}
    c = candidate("movie", movie, movie_map, {"movie:tmdb:438631": {}})
    assert (c.size, c.monitored, c.tags, c.rating, c.requested) == (5, False, (3,), 8.0, True)
    assert c.plex["key"] == "11"
    # the show's map is the show sections' only: the film's watch state stays out
    s = candidate("series", show, {}, {"tv:tvdb:99": {}})
    assert (s.size, s.plex, s.rating, s.requested) == (7, None, 6.5, True)
    assert not candidate("series", show, {}, {"movie:tmdb:438631": {}}).requested


# --- stored state ----------------------------------------------------------------


class FakeDB:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}

    def kv_get(self, key: str) -> str | None:
        return self.kv.get(key)

    def kv_set(self, key: str, value: str) -> None:
        self.kv[key] = value

    def push_all(self) -> list[str]:
        return []


def test_everything_is_off_until_said_otherwise():
    db = FakeDB()
    assert store.load_settings(db) == {"enabled": False, "max_deletions": 10}
    db.kv[store.SETTINGS_KEY] = "not json"
    assert store.load_settings(db)["enabled"] is False
    db.kv[store.SETTINGS_KEY] = json.dumps({"enabled": "yes"})
    assert store.load_settings(db)["enabled"] is False
    r = store.normalise_rule({"kind": "series", "grace_days": 1, "conditions": {"x": 1}})
    assert r["enabled"] is False and r["grace_days"] == 3 and r["id"]
    assert not has_conditions(r["conditions"])
    assert store.normalise_rule({})["grace_days"] == 14
    junk = {"watched_days": "10", "min_size_gb": -5, "rating_below": True, "with_tags": ["a", 2]}
    cleaned = store.normalise_rule({"conditions": junk})["conditions"]
    assert cleaned["watched_days"] is None and cleaned["min_size_gb"] is None
    assert cleaned["rating_below"] is None and cleaned["with_tags"] == [2]


def test_the_log_keeps_the_last_fifty_runs():
    db = FakeDB()
    for n in range(60):
        store.append_log(db, {"ts": n})
    log = store.load_log(db)
    assert len(log) == 50 and log[0]["ts"] == 59


# --- the lifecycle ---------------------------------------------------------------


class FakeLibrary:
    """Records every write; a test asserts on what was (not) done."""

    def __init__(self, titles: list[Candidate]) -> None:
        self.titles = titles
        self.down: str | None = None
        self.fail_delete = False
        self.on_snapshot = None
        self.snapshots = 0
        self.deleted: list[tuple[str, list[int]]] = []
        self.notes: list = []
        self.collections: dict[str, dict] = {}
        self.plex_writes: list[tuple] = []
        self._next = 100

    async def snapshot(self):
        self.snapshots += 1
        if self.down:
            raise Unreachable(self.down, "connection refused")
        if self.on_snapshot:
            self.on_snapshot()
        return list(self.titles)

    async def delete(self, kind, ids):
        if self.fail_delete:
            raise RuntimeError("radarr said no")
        self.deleted.append((kind, list(ids)))

    async def collection_create(self, section, section_type, rating_key):
        self._next += 1
        cid = str(self._next)
        self.collections[cid] = {"section": section, "type": section_type, "items": [rating_key]}
        self.plex_writes.append(("create", section, rating_key))
        return cid

    async def collection_items(self, cid):
        if cid not in self.collections:
            raise CollectionGone
        return list(self.collections[cid]["items"])

    async def collection_add(self, cid, rating_key):
        self.collections[cid]["items"].append(rating_key)
        self.plex_writes.append(("add", cid, rating_key))

    async def collection_remove(self, cid, rating_key):
        self.collections[cid]["items"].remove(rating_key)
        self.plex_writes.append(("remove", cid, rating_key))

    async def collection_delete(self, cid):
        if cid not in self.collections:
            raise CollectionGone
        del self.collections[cid]
        self.plex_writes.append(("delete", cid))

    async def notify(self, note):
        self.notes.append(note)

    def wrote(self) -> bool:
        return bool(self.deleted or self.notes or self.plex_writes)


def setup(titles, rules, enabled=True, max_deletions=10):
    db = FakeDB()
    store.save_settings(db, {"enabled": enabled, "max_deletions": max_deletions})
    store.save_rules(db, rules)
    return db, FakeLibrary(titles)


def go(db, lib, now=NOW, **kw):
    return asyncio.run(run(db, lib, now, **kw))


def test_switched_off_nothing_happens_at_all():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)], enabled=False)
    entry = go(db, lib)
    assert entry["skipped"] == "disabled"
    assert lib.snapshots == 0 and not lib.wrote()
    assert store.load_pending(db) == {} and store.load_log(db) == []


def test_a_rule_that_is_off_marks_nothing_even_with_the_switch_on():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True, enabled=False)])
    entry = go(db, lib)
    assert entry["marked"] == [] and store.load_pending(db) == {} and not lib.wrote()


def test_a_dry_run_works_with_the_switch_off_and_changes_nothing():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)], enabled=False)
    entry = go(db, lib, dry_run=True)
    assert [t["id"] for t in entry["marked"]] == [1]
    assert not lib.wrote() and store.load_pending(db) == {} and store.load_log(db) == []
    assert db.kv.get(store.COLLECTIONS_KEY) is None


def test_mark_then_wait_then_delete():
    db, lib = setup([title(1, monitored=False), title(2)], [rule(unmonitored=True)])

    # day 0: marked, shelved in Plex, announced
    entry = go(db, lib)
    assert [t["id"] for t in entry["marked"]] == [1]
    pending = store.load_pending(db)
    assert list(pending) == ["movie:1"]
    assert pending["movie:1"]["leave_at"] == NOW + 14 * DAY
    assert lib.plex_writes == [("create", "1", "1001")]
    assert store.load_collections(db) == {"1": "101"}
    assert len(lib.notes) == 1 and lib.notes[0].params == {"action": "leaving", "days": 14}
    assert lib.notes[0].count == 1 and lib.notes[0].code == "cleanup"
    assert lib.deleted == []

    # day 13: still waiting, not marked again, no new banner
    entry = go(db, lib, NOW + 13 * DAY)
    assert entry["marked"] == [] and entry["deleted"] == [] and lib.deleted == []
    assert len(lib.notes) == 1

    # day 14: rechecked, still matches, deleted through the arr
    entry = go(db, lib, NOW + 14 * DAY)
    assert lib.deleted == [("movie", [1])]
    assert [t["id"] for t in entry["deleted"]] == [1]
    assert store.load_pending(db) == {}
    # the shelf went with its last title
    assert ("delete", "101") in lib.plex_writes and store.load_collections(db) == {}
    assert lib.notes[-1].params == {"action": "removed"} and lib.notes[-1].count == 1
    assert [e["ts"] for e in store.load_log(db)] == [
        int(NOW + 14 * DAY),
        int(NOW + 13 * DAY),
        int(NOW),
    ]


@pytest.mark.parametrize(
    "changed, reason",
    [
        (title(1, monitored=True), "no_match"),  # monitored again
        (title(1, monitored=False, requested=True), "requested"),
        (None, "gone"),  # deleted by hand
    ],
)
def test_the_recheck_releases_a_title_that_no_longer_qualifies(changed, reason):
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    lib.titles = [changed] if changed else []
    entry = go(db, lib, NOW + 15 * DAY)
    assert lib.deleted == []
    assert [(t["id"], t["reason"]) for t in entry["released"]] == [(1, reason)]
    assert store.load_pending(db) == {} and store.load_collections(db) == {}


def test_watched_again_during_the_grace_period_is_released():
    db, lib = setup([title(1, watched_days=400)], [rule(watched_days=180)])
    go(db, lib)
    lib.titles = [title(1, watched_days=1)]
    entry = go(db, lib, NOW + 15 * DAY)
    assert lib.deleted == [] and entry["released"][0]["reason"] == "no_match"


def test_turning_the_rule_off_releases_what_it_marked():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    store.save_rules(db, [rule(unmonitored=True, enabled=False)])
    entry = go(db, lib, NOW + 15 * DAY)
    assert lib.deleted == [] and entry["released"][0]["reason"] == "rule_off"


def test_kept_titles_leave_the_list_and_are_never_matched_again():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    kept = asyncio.run(job.keep_title(db, lib, "movie", 1, "", None))
    assert kept["title"] == "T1"
    assert store.load_pending(db) == {}
    assert store.load_collections(db) == {}  # the shelf emptied, so it went
    entry = go(db, lib, NOW + 30 * DAY)
    assert entry["marked"] == [] and lib.deleted == []
    assert [t["id"] for t in entry["kept"]] == [1]
    # off the keep list, the rule may take it again
    store.unkeep(db, "movie:1")
    assert [t["id"] for t in go(db, lib, NOW + 31 * DAY)["marked"]] == [1]


def test_a_keep_tapped_mid_run_beats_the_deletion():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    lib.on_snapshot = lambda: store.keep(db, "movie:1", {"kind": "movie", "id": 1, "kept_at": 0})
    go(db, lib, NOW + 15 * DAY)
    assert lib.deleted == []


def test_at_most_max_deletions_per_run_oldest_first():
    titles = [title(i, monitored=False) for i in range(1, 6)]
    db, lib = setup(titles, [rule(unmonitored=True)], max_deletions=2)
    go(db, lib)
    pending = store.load_pending(db)
    for i in range(1, 6):  # stagger the dates so the order is visible
        pending[f"movie:{i}"]["leave_at"] -= i
    db.kv[store.PENDING_KEY] = json.dumps(pending)
    entry = go(db, lib, NOW + 15 * DAY)
    assert lib.deleted == [("movie", [5, 4])] and entry["deferred"] == 3
    go(db, lib, NOW + 16 * DAY)
    assert lib.deleted[-1] == ("movie", [3, 2])


def test_a_down_service_skips_the_whole_run():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    before = dict(db.kv)
    lib.plex_writes.clear()
    lib.notes.clear()
    lib.down = "plex"
    entry = go(db, lib, NOW + 30 * DAY)  # well past the date
    assert entry["skipped"] == "unreachable" and entry["errors"] == ["plex: connection refused"]
    assert not lib.wrote()

    def unlogged(kv):
        return {k: v for k, v in kv.items() if k != store.LOG_KEY}

    assert unlogged(db.kv) == unlogged(before)
    assert store.load_log(db)[0]["skipped"] == "unreachable"


def test_a_failed_delete_stays_leaving_and_says_so():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    lib.fail_delete = True
    entry = go(db, lib, NOW + 15 * DAY)
    assert entry["deleted"] == [] and "radarr said no" in entry["errors"][0]
    assert "movie:1" in store.load_pending(db)
    assert all(n.params.get("action") != "removed" for n in lib.notes)


def test_a_dry_run_past_the_date_deletes_nothing():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    before = dict(db.kv)
    entry = go(db, lib, NOW + 15 * DAY, dry_run=True)
    assert [t["id"] for t in entry["deleted"]] == [1]  # what would go
    assert lib.deleted == [] and db.kv == before


def test_a_collection_deleted_in_plex_is_made_again():
    db, lib = setup(
        [title(1, monitored=False), title(2, monitored=False)], [rule(unmonitored=True)]
    )
    go(db, lib)
    lib.collections.clear()  # someone deleted it in Plex
    lib.titles.append(title(3, monitored=False))
    go(db, lib, NOW + DAY)
    (cid,) = lib.collections
    assert sorted(lib.collections[cid]["items"]) == ["1001", "1002", "1003"]


def test_one_shelf_per_section_and_series_go_through_sonarr():
    db, lib = setup(
        [title(1, monitored=False), title(2, "series", monitored=False)],
        [rule(unmonitored=True), rule("r2", kind="series", unmonitored=True, grace=3)],
    )
    entry = go(db, lib)
    assert {(c["section"], c["type"]) for c in lib.collections.values()} == {
        ("1", "movie"),
        ("2", "show"),
    }
    # the banner names the soonest date
    assert entry["marked"] and lib.notes[0].params["days"] == 3
    go(db, lib, NOW + 4 * DAY)
    assert lib.deleted == [("series", [2])]
    go(db, lib, NOW + 15 * DAY)
    assert lib.deleted[-1] == ("movie", [1])


def test_switching_off_releases_everything():
    db, lib = setup([title(1, monitored=False)], [rule(unmonitored=True)])
    go(db, lib)
    asyncio.run(job.release_all(db, lib))
    assert store.load_pending(db) == {} and store.load_collections(db) == {}
    assert store.load_log(db)[0]["released"][0]["reason"] == "switched_off"


def test_plan_marks_each_title_once_under_the_first_rule():
    titles = [title(1, monitored=False, size=60 * GIB)]
    rules = [rule("a", unmonitored=True), rule("b", min_size_gb=50)]
    plan = plan_run(titles, rules, {}, {}, 10, NOW)
    assert [(i["id"], i["rule_id"]) for i in plan.mark] == [(1, "a")]


# --- the real clients, against mock transports ---------------------------------


class Registry:
    def __init__(self, clients: dict) -> None:
        self.clients = clients

    def is_configured(self, name: str) -> bool:
        return name in self.clients

    def get(self, name: str):
        return self.clients[name]


def plex_handler(fail_section: bool = False, calls: list | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if calls is not None:
            calls.append((request.method, path, dict(request.url.params)))
        if path == "/identity":
            return httpx.Response(200, json={"MediaContainer": {"machineIdentifier": "abc"}})
        if path == "/library/sections":
            directory = [{"key": "1", "type": "movie"}, {"key": "2", "type": "show"}]
            return httpx.Response(200, json={"MediaContainer": {"Directory": directory}})
        if path == "/library/sections/1/all":
            item = {
                "ratingKey": 11,
                "viewCount": 1,
                "lastViewedAt": 5,
                "Guid": [{"id": "tmdb://7"}],
            }
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [item]}})
        if path == "/library/sections/2/all":
            if fail_section:
                return httpx.Response(500)
            item = {
                "ratingKey": 22,
                "leafCount": 4,
                "viewedLeafCount": 0,
                "Guid": [{"id": "tmdb://7"}],
            }
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [item]}})
        if path == "/library/collections" and request.method == "POST":
            return httpx.Response(200, json={"MediaContainer": {"Metadata": [{"ratingKey": 555}]}})
        if path == "/library/collections/9/children":
            return httpx.Response(404)
        if path.startswith("/library/collections/"):
            return httpx.Response(200)
        return httpx.Response(404)

    return handler


def arr_handler(calls: list):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, request.content))
        if request.url.path == "/api/v3/movie":
            movie = {"id": 1, "title": "M", "tmdbId": 7, "sizeOnDisk": 9, "added": "2020-01-01"}
            return httpx.Response(200, json=[movie])
        if request.url.path == "/api/v3/series":
            show = {
                "id": 2,
                "title": "S",
                "tmdbId": 7,
                "tvdbId": 70,
                "statistics": {"sizeOnDisk": 9},
            }
            return httpx.Response(200, json=[show])
        if request.url.path in ("/api/v3/movie/editor", "/api/v3/series/editor"):
            return httpx.Response(200)
        return httpx.Response(404)

    return handler


def overseerr_handler(fail: bool = False):
    def handler(request: httpx.Request) -> httpx.Response:
        if fail:
            return httpx.Response(500)
        if request.url.params.get("filter") == "pending":
            req = {"type": "tv", "media": {"tmdbId": 7, "tvdbId": 70}}
            return httpx.Response(200, json={"results": [req]})
        return httpx.Response(200, json={"results": []})

    return handler


def live(plex=None, overseerr=None, arr_calls=None, with_overseerr=True):
    async def build():
        def client(handler):
            return httpx.AsyncClient(transport=httpx.MockTransport(handler))

        arr = client(arr_handler(arr_calls if arr_calls is not None else []))
        clients = {
            "plex": PlexClient(client(plex or plex_handler()), "http://plex", "tok"),
            "radarr": RadarrClient(arr, "http://radarr", "k"),
            "sonarr": SonarrClient(arr, "http://sonarr", "k"),
        }
        if with_overseerr:
            clients["overseerr"] = OverseerrClient(
                client(overseerr or overseerr_handler()), "http://o", "k"
            )
        return LiveLibrary(FakeDB(), Registry(clients))

    return build


def test_live_snapshot_joins_each_kind_to_its_own_plex_sections():
    async def go_():
        lib = await live()()
        return await lib.snapshot()

    movie, show = asyncio.run(go_())
    # both carry tmdb 7; the film is watched, the show is not, and only the show is requested
    assert movie.plex["watched"] is True and movie.plex["section"] == "1"
    assert show.plex["watched"] is False and show.plex["section"] == "2"
    assert (movie.requested, show.requested) == (False, True)


@pytest.mark.parametrize(
    "kwargs, service",
    [
        ({"plex": plex_handler(fail_section=True)}, "plex"),
        ({"overseerr": overseerr_handler(fail=True)}, "overseerr"),
    ],
)
def test_live_snapshot_refuses_on_any_unknown(kwargs, service, monkeypatch):
    monkeypatch.setattr("app.clients.base.RETRY_BACKOFF_SECONDS", 0)

    async def go_():
        lib = await live(**kwargs)()
        await lib.snapshot()

    with pytest.raises(Unreachable) as exc:
        asyncio.run(go_())
    assert exc.value.service == service


def test_live_snapshot_without_overseerr_reads_no_requests():
    async def go_():
        return await (await live(with_overseerr=False)()).snapshot()

    assert not any(c.requested for c in asyncio.run(go_()))


def test_live_delete_removes_files_and_excludes_through_the_arrs():
    calls: list = []

    async def go_():
        lib = await live(arr_calls=calls)()
        await lib.delete("movie", [1])
        await lib.delete("series", [2])

    asyncio.run(go_())
    sent = [(m, p, json.loads(c)) for m, p, c in calls if m == "DELETE"]
    assert sent == [
        (
            "DELETE",
            "/api/v3/movie/editor",
            {"movieIds": [1], "deleteFiles": True, "addImportExclusion": True},
        ),
        (
            "DELETE",
            "/api/v3/series/editor",
            {"seriesIds": [2], "deleteFiles": True, "addImportListExclusion": True},
        ),
    ]


def test_live_collection_calls_match_what_plex_accepts():
    calls: list = []

    async def go_():
        lib = await live(plex=plex_handler(calls=calls))()
        cid = await lib.collection_create("2", "show", "22")
        await lib.collection_add(cid, "23")
        await lib.collection_remove(cid, "22")
        await lib.collection_delete(cid)
        with pytest.raises(CollectionGone):
            await lib.collection_items("9")
        return cid

    assert asyncio.run(go_()) == "555"
    uri = "server://abc/com.plexapp.plugins.library/library/metadata/"
    writes = [c for c in calls if c[0] != "GET"]
    assert writes == [
        (
            "POST",
            "/library/collections",
            {
                "type": "2",
                "title": "Leaving soon",
                "smart": "0",
                "sectionId": "2",
                "uri": uri + "22",
            },
        ),
        ("PUT", "/library/collections/555/items", {"uri": uri + "23"}),
        ("DELETE", "/library/collections/555/items/22", {}),
        ("DELETE", "/library/collections/555", {}),
    ]


# --- the API --------------------------------------------------------------------


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings

    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    get_settings.cache_clear()
    import app.main as main

    with TestClient(main.app, headers={"host": "localhost"}) as c:
        yield c
    get_settings.cache_clear()


def test_api_starts_switched_off_with_no_rules(client):
    assert client.get("/api/v1/cleanup/rules").json() == {
        "settings": {"enabled": False, "max_deletions": 10},
        "rules": [],
    }


def test_api_saves_rules_off_by_default_with_ids(client):
    body = {
        "settings": {"enabled": False, "max_deletions": 5},
        "rules": [{"kind": "movie", "conditions": {"unmonitored": True}}],
    }
    saved = client.put("/api/v1/cleanup/rules", json=body).json()
    (r,) = saved["rules"]
    assert r["id"] and r["enabled"] is False and r["grace_days"] == 14
    assert saved["settings"]["max_deletions"] == 5
    # an edit keeps the id
    body["rules"] = [r | {"name": "Unmonitored"}]
    assert client.put("/api/v1/cleanup/rules", json=body).json()["rules"][0]["id"] == r["id"]


@pytest.mark.parametrize(
    "bad",
    [
        {"kind": "movie", "grace_days": 2},
        {"kind": "book"},
        {"kind": "movie", "conditions": {"rating_below": 11}},
    ],
)
def test_api_rejects_rules_outside_the_limits(client, bad):
    body = {"settings": {"enabled": False}, "rules": [bad]}
    assert client.put("/api/v1/cleanup/rules", json=body).status_code == 422
    body = {"settings": {"enabled": True, "max_deletions": 0}, "rules": []}
    assert client.put("/api/v1/cleanup/rules", json=body).status_code == 422


def test_api_preview_without_the_services_is_a_502_not_an_empty_answer(client):
    resp = client.post("/api/v1/cleanup/rules/preview", json={"kind": "movie"})
    assert resp.status_code == 502
    assert resp.json()["error"]["service"] == "plex"


def test_api_run_respects_the_switch(client):
    resp = client.post("/api/v1/cleanup/run")
    assert resp.status_code == 200 and resp.json()["skipped"] == "disabled"
    # a dry run goes ahead, and without Plex it stops there
    assert client.post("/api/v1/cleanup/run?dry_run=true").json()["skipped"] == "unreachable"
    assert client.get("/api/v1/cleanup/log").json() == []


def test_api_keep_list(client):
    resp = client.post("/api/v1/cleanup/leaving/movie/5/keep", json={"title": "Heat", "year": 1995})
    assert resp.status_code == 200 and resp.json()["title"] == "Heat"
    client.post("/api/v1/cleanup/leaving/series/6/keep")
    assert {(k["kind"], k["id"]) for k in client.get("/api/v1/cleanup/kept").json()} == {
        ("movie", 5),
        ("series", 6),
    }
    assert client.delete("/api/v1/cleanup/kept/movie/5").status_code == 204
    assert [k["id"] for k in client.get("/api/v1/cleanup/kept").json()] == [6]
    assert client.delete("/api/v1/cleanup/kept").status_code == 204
    assert client.get("/api/v1/cleanup/kept").json() == []
    assert client.post("/api/v1/cleanup/leaving/book/1/keep").status_code == 404


def test_api_switching_off_releases_what_was_leaving(client):
    db = client.app.state.db
    on = {"settings": {"enabled": True}, "rules": []}
    client.put("/api/v1/cleanup/rules", json=on)
    item = {"kind": "movie", "id": 1, "title": "M", "marked_at": 1, "leave_at": 2}
    store.mark(db, "movie:1", item)
    assert [i["id"] for i in client.get("/api/v1/cleanup/leaving").json()] == [1]
    client.put("/api/v1/cleanup/rules", json={"settings": {"enabled": False}, "rules": []})
    assert client.get("/api/v1/cleanup/leaving").json() == []
    assert client.get("/api/v1/cleanup/log").json()[0]["released"][0]["reason"] == "switched_off"
