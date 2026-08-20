import json
import time

from app.push import describe_record


def test_movie_title_with_year():
    rec = {"movie": {"title": "Inception", "year": 2010}, "sourceTitle": "Inception.2010.x265"}
    assert describe_record("radarr", rec) == "Inception (2010)"


def test_movie_falls_back_to_source_title():
    rec = {"sourceTitle": "Inception.2010.x265"}
    assert describe_record("radarr", rec) == "Inception.2010.x265"


def test_episode_title():
    rec = {
        "series": {"title": "The Bear"},
        "episode": {"seasonNumber": 3, "episodeNumber": 4, "title": "Violet"},
    }
    assert describe_record("sonarr", rec) == "The Bear S03E04 – Violet"


def test_episode_without_episode_details():
    rec = {"series": {"title": "The Bear"}, "sourceTitle": "The.Bear.S03E04"}
    assert describe_record("sonarr", rec) == "The Bear"


def test_private_key_b64_roundtrip():
    from py_vapid import Vapid

    from app.push import _private_key_b64

    vapid = Vapid()
    vapid.generate_keys()
    key = _private_key_b64(vapid.private_pem().decode())
    # pywebpush hands this string to Vapid.from_string — must parse and match
    restored = Vapid.from_string(private_key=key)
    assert (
        restored.private_key.private_numbers().private_value
        == vapid.private_key.private_numbers().private_value
    )


# --- webhook translation -------------------------------------------------


def test_webhook_import_maps_to_movie_page():
    from app.push import webhook_event

    event = webhook_event(
        "radarr",
        {"eventType": "Download", "movie": {"id": 7, "title": "Inception", "year": 2010}},
    )
    assert event.key == "imported"
    assert event.title == "Inception (2010)"
    assert event.url == "/movie/7"
    assert event.group == "radarr:imported:7"


def test_webhook_upgrade_is_its_own_event():
    from app.push import webhook_event

    event = webhook_event(
        "radarr",
        {
            "eventType": "Download",
            "isUpgrade": True,
            "movie": {"id": 7, "title": "Inception", "year": 2010},
        },
    )
    assert event.key == "upgraded"
    assert event.label == "Upgraded"


def test_webhook_episode_links_to_series_and_groups_by_it():
    from app.push import webhook_event

    event = webhook_event(
        "sonarr",
        {
            "eventType": "Download",
            "series": {"id": 12, "title": "The Bear"},
            "episodes": [{"seasonNumber": 3, "episodeNumber": 4, "title": "Violet"}],
        },
    )
    assert event.title == "The Bear S03E04 – Violet"
    assert event.url == "/series/12"
    assert event.group == "sonarr:imported:12"
    assert event.group_title == "The Bear"


def test_webhook_season_pack_grab_names_the_span():
    from app.push import webhook_event

    event = webhook_event(
        "sonarr",
        {
            "eventType": "Grab",
            "series": {"id": 12, "title": "The Bear"},
            "episodes": [
                {"seasonNumber": 3, "episodeNumber": n, "title": f"Ep {n}"} for n in (1, 2, 3)
            ],
        },
    )
    assert event.title == "The Bear S03 · 3 episodes"


def test_health_events_stay_separate_and_point_at_manage():
    from app.push import webhook_event

    one = webhook_event("sonarr", {"eventType": "Health", "message": "Indexer unavailable"})
    two = webhook_event("sonarr", {"eventType": "Health", "message": "No download client"})
    assert one.url == "/manage"
    assert one.group != two.group  # distinct issues must not merge into a count
    restored = webhook_event("sonarr", {"eventType": "HealthRestored", "message": "back"})
    assert restored.label == "Health restored"


def test_unknown_webhook_events_are_ignored():
    from app.push import webhook_event

    assert webhook_event("radarr", {"eventType": "Rename", "movie": {"id": 1}}) is None
    assert webhook_event("radarr", {}) is None


def test_test_event_is_recognised():
    from app.push import webhook_event

    assert webhook_event("radarr", {"eventType": "Test"}).key == "test"


# --- coalescing ----------------------------------------------------------


def test_single_event_renders_title_and_label():
    from app.push import Event, _Slot, render

    event = Event(key="imported", app="radarr", title="Inception (2010)")
    assert render(_Slot(event=event, due=0.0)) == ("Inception (2010)", "Downloaded")


def test_burst_of_episodes_collapses_under_the_series():
    from app.push import Event, _Slot, render

    event = Event(
        key="imported", app="sonarr", title="The Bear S03E01", group_title="The Bear"
    )
    slot = _Slot(event=event, due=0.0, count=8)
    assert render(slot) == ("The Bear", "Downloaded · 8 episodes")


def test_burst_without_a_group_title_counts_by_label():
    from app.push import Event, _Slot, render

    event = Event(key="imported", app="radarr", title="Inception (2010)")
    assert render(_Slot(event=event, due=0.0, count=3)) == ("Downloaded", "3 movies")


def test_coalescer_merges_within_the_window():
    import asyncio

    from app.push import COALESCE_WINDOW, Coalescer, Event

    async def run():
        c = Coalescer()
        for n in (1, 2, 3):
            await c.add(
                Event(key="imported", app="sonarr", title=f"S01E0{n}", group="sonarr:imported:1"),
                100.0,
            )
        assert await c.due(100.0 + COALESCE_WINDOW - 1) == []
        due = await c.due(100.0 + COALESCE_WINDOW)
        assert len(due) == 1 and due[0].count == 3
        assert await c.due(1e9) == []  # flushed groups are gone

    asyncio.run(run())


# --- history source ------------------------------------------------------


def test_history_record_becomes_a_linked_event():
    from app.push import history_event

    event = history_event(
        "sonarr",
        {
            "eventType": "downloadFolderImported",
            "seriesId": 12,
            "series": {"title": "The Bear"},
            "episode": {"seasonNumber": 3, "episodeNumber": 4, "title": "Violet"},
        },
    )
    assert event.key == "imported"
    assert event.url == "/series/12"
    assert event.group == "sonarr:imported:12"


def test_history_ignores_uninteresting_event_types():
    from app.push import history_event

    assert history_event("radarr", {"eventType": "movieFileRenamed", "movieId": 3}) is None


def test_webhook_and_history_dedupe_to_the_same_key():
    from app.push import history_event, webhook_event

    hook = webhook_event(
        "radarr", {"eventType": "Download", "movie": {"id": 7, "title": "Inception", "year": 2010}}
    )
    hist = history_event(
        "radarr",
        {
            "eventType": "downloadFolderImported",
            "movieId": 7,
            "movie": {"title": "Inception", "year": 2010},
        },
    )
    assert hook.dedupe_key == hist.dedupe_key


# --- preferences ---------------------------------------------------------


def test_event_preferences_default_and_round_trip():
    from app.push import DEFAULT_EVENTS, enabled_events, set_enabled_events

    class FakeDB:
        def __init__(self):
            self.store = {}

        def kv_get(self, key):
            return self.store.get(key)

        def kv_set(self, key, value):
            self.store[key] = value

    db = FakeDB()
    assert enabled_events(db) == DEFAULT_EVENTS
    set_enabled_events(db, ["grabbed", "imported", "bogus"])
    assert enabled_events(db) == ["grabbed", "imported"]
    set_enabled_events(db, [])
    assert enabled_events(db) == []  # an explicit empty set is not the default


# --- end to end ----------------------------------------------------------


def _pipeline_db(tmp_path):
    """A real SettingsDB with one subscription, so notify() doesn't short-circuit."""
    from app.db import SettingsDB

    db = SettingsDB(str(tmp_path / "push.db"))
    db.push_add("https://example.test/sub", '{"endpoint": "https://example.test/sub"}')
    return db


def _drive(db, payloads, monkeypatch):
    """Feed webhooks through the pipeline and return what would be pushed."""
    import asyncio

    from app import push

    sent = []
    # patch where it is used: pipeline imported the name, so patching the
    # barrel would leave pipeline's own reference untouched
    monkeypatch.setattr(
        push.pipeline,
        "_send_all",
        lambda _db, title, body, url, tag, *rest: sent.append((title, body, url, tag)),
    )
    monkeypatch.setattr(push.pipeline, "COALESCER", push.Coalescer())

    async def run():
        for app_name, payload in payloads:
            await push.handle_webhook(db, app_name, payload)
        # jump past the coalescing window instead of waiting it out
        for slot in await push.pipeline.COALESCER.due(time.monotonic() + push.COALESCE_WINDOW + 1):
            title, body = push.render(slot)
            push.pipeline._send_all(db, title, body, slot.event.url, slot.event.tag, slot.event.key)

    asyncio.run(run())
    return sent


def test_a_season_pack_arrives_as_one_notification(tmp_path, monkeypatch):
    db = _pipeline_db(tmp_path)
    payloads = [
        (
            "sonarr",
            {
                "eventType": "Download",
                "series": {"id": 12, "title": "The Bear"},
                "episodes": [{"seasonNumber": 3, "episodeNumber": n, "title": f"Ep {n}"}],
            },
        )
        for n in range(1, 9)
    ]
    sent = _drive(db, payloads, monkeypatch)
    assert sent == [("The Bear", "Downloaded · 8 episodes", "/series/12", "arrdeck:sonarr:imported:12")]


def test_two_shows_stay_separate(tmp_path, monkeypatch):
    db = _pipeline_db(tmp_path)
    payloads = [
        (
            "sonarr",
            {
                "eventType": "Download",
                "series": {"id": sid, "title": name},
                "episodes": [{"seasonNumber": 1, "episodeNumber": 1, "title": "Pilot"}],
            },
        )
        for sid, name in ((12, "The Bear"), (13, "Severance"))
    ]
    sent = _drive(db, payloads, monkeypatch)
    assert {s[0] for s in sent} == {"The Bear S01E01 – Pilot", "Severance S01E01 – Pilot"}


def test_a_repeated_webhook_only_notifies_once(tmp_path, monkeypatch):
    db = _pipeline_db(tmp_path)
    payload = (
        "radarr",
        {"eventType": "Download", "movie": {"id": 7, "title": "Inception", "year": 2010}},
    )
    sent = _drive(db, [payload, payload], monkeypatch)
    assert sent == [("Inception (2010)", "Downloaded", "/movie/7", "arrdeck:radarr:imported:7")]


def test_disabled_events_never_reach_the_phone(tmp_path, monkeypatch):
    from app.push import set_enabled_events

    db = _pipeline_db(tmp_path)
    set_enabled_events(db, ["failed"])
    sent = _drive(
        db,
        [("radarr", {"eventType": "Download", "movie": {"id": 7, "title": "Inception"}})],
        monkeypatch,
    )
    assert sent == []


def test_a_test_webhook_skips_the_queue(tmp_path, monkeypatch):
    db = _pipeline_db(tmp_path)
    # delivered immediately, and again on a retry: it exists to prove the wiring
    sent = _drive(db, [("radarr", {"eventType": "Test"})] * 2, monkeypatch)
    assert len(sent) == 2
    assert sent[0][0] == "Test notification"
    assert sent[0][2] == "/manage"


# --- per-device preferences ----------------------------------------------


def _two_devices(tmp_path):
    from app.db import SettingsDB

    db = SettingsDB(str(tmp_path / "devices.db"))
    for name in ("phone", "ipad"):
        endpoint = f"https://example.test/{name}"
        db.push_add(endpoint, json.dumps({"endpoint": endpoint}))
    return db


def test_a_device_without_a_choice_follows_the_global_default(tmp_path):
    from app.push import set_enabled_events, wants_event

    db = _two_devices(tmp_path)
    set_enabled_events(db, ["imported"])
    assert wants_event(db, "imported") is True
    assert wants_event(db, "grabbed") is False


def test_one_device_can_opt_into_an_event_the_default_excludes(tmp_path):
    from app.push import set_enabled_events, wants_event

    db = _two_devices(tmp_path)
    set_enabled_events(db, ["imported"])
    assert db.push_set_events("https://example.test/phone", ["grabbed"]) is True
    # the phone wants it, so the event must not be dropped before delivery
    assert wants_event(db, "grabbed") is True


def test_prefs_for_an_unknown_endpoint_are_rejected(tmp_path):
    db = _two_devices(tmp_path)
    assert db.push_set_events("https://example.test/nope", ["grabbed"]) is False


def test_clearing_a_device_choice_returns_it_to_the_default(tmp_path):
    db = _two_devices(tmp_path)
    db.push_set_events("https://example.test/phone", ["grabbed"])
    assert db.push_get_events("https://example.test/phone") == ["grabbed"]
    db.push_set_events("https://example.test/phone", None)
    assert db.push_get_events("https://example.test/phone") is None


def test_delivery_respects_each_device_separately(tmp_path, monkeypatch):
    import app.push as push
    import app.push.delivery
    import app.push.pipeline

    db = _two_devices(tmp_path)
    push.set_enabled_events(db, ["imported"])
    db.push_set_events("https://example.test/ipad", ["grabbed"])

    delivered = []
    monkeypatch.setattr(
        push.delivery, "webpush", lambda sub, *a, **kw: delivered.append(sub["endpoint"])
    )
    push.ensure_vapid(db)

    push.delivery._send_all(db, "t", "b", "/", "tag", "imported")
    assert delivered == ["https://example.test/phone"]  # ipad opted out

    delivered.clear()
    push.delivery._send_all(db, "t", "b", "/", "tag", "grabbed")
    assert delivered == ["https://example.test/ipad"]


def test_a_test_banner_ignores_every_preference(tmp_path, monkeypatch):
    import asyncio

    import app.push as push
    import app.push.delivery
    import app.push.pipeline

    db = _two_devices(tmp_path)
    push.set_enabled_events(db, [])  # nothing enabled anywhere
    delivered = []
    monkeypatch.setattr(push.delivery, "webpush", lambda sub, *a, **kw: delivered.append(sub["endpoint"]))
    push.ensure_vapid(db)

    assert asyncio.run(push.send_test(db)) == 2
    delivered.clear()
    assert asyncio.run(push.send_test(db, "https://example.test/ipad")) == 1
    assert delivered == ["https://example.test/ipad"]


# --- notification rules --------------------------------------------------


def _rules(**over):
    from app.push import DEFAULT_RULES

    base = {**DEFAULT_RULES, "tags": {"radarr": [], "sonarr": []}}
    base.update(over)
    return base


def test_quiet_hours_across_midnight_cover_the_night():
    from datetime import datetime

    from app.push import in_quiet_hours

    rules = _rules(quiet_start="23:00", quiet_end="07:00")
    for hour, quiet in ((23, True), (2, True), (6, True), (7, False), (12, False), (22, False)):
        now = datetime(2026, 1, 1, hour, 30)
        assert in_quiet_hours(rules, now) is quiet, hour


def test_a_same_day_window_only_covers_that_span():
    from datetime import datetime

    from app.push import in_quiet_hours

    rules = _rules(quiet_start="09:00", quiet_end="17:00")
    assert in_quiet_hours(rules, datetime(2026, 1, 1, 12, 0)) is True
    assert in_quiet_hours(rules, datetime(2026, 1, 1, 8, 0)) is False
    assert in_quiet_hours(rules, datetime(2026, 1, 1, 17, 0)) is False


def test_an_unset_or_degenerate_window_is_never_quiet():
    from datetime import datetime

    from app.push import in_quiet_hours

    now = datetime(2026, 1, 1, 3, 0)
    assert in_quiet_hours(_rules(), now) is False
    assert in_quiet_hours(_rules(quiet_start="22:00", quiet_end="22:00"), now) is False
    assert in_quiet_hours(_rules(quiet_start="nonsense", quiet_end="07:00"), now) is False


def test_a_tag_rule_keeps_only_matching_media():
    from app.push import Event, passes_rules

    rules = _rules(tags={"radarr": [3], "sonarr": []})
    tagged = Event(key="imported", app="radarr", title="A", tags=[3, 9])
    untagged = Event(key="imported", app="radarr", title="B", tags=[])
    other = Event(key="imported", app="radarr", title="C", tags=[9])
    assert passes_rules(rules, tagged) is True
    assert passes_rules(rules, untagged) is False
    assert passes_rules(rules, other) is False


def test_a_tag_rule_for_one_app_does_not_filter_the_other():
    from app.push import Event, passes_rules

    rules = _rules(tags={"radarr": [3], "sonarr": []})
    assert passes_rules(rules, Event(key="imported", app="sonarr", title="S", tags=[])) is True


def test_non_media_events_are_never_filtered_by_tags():
    from app.push import Event, passes_rules

    rules = _rules(tags={"radarr": [3], "sonarr": [4]})
    # tags=None marks "this isn't a movie or series", e.g. a health warning
    assert passes_rules(rules, Event(key="health", app="radarr", title="disk")) is True


def test_a_test_banner_ignores_quiet_hours():
    from app.push import Event, passes_rules

    rules = _rules(quiet_start="00:00", quiet_end="23:59")
    assert passes_rules(rules, Event(key="test", app="arrdeck", title="t")) is True


def test_rules_round_trip_and_reject_junk(tmp_path):
    from app.db import SettingsDB
    from app.push import get_rules, set_rules

    db = SettingsDB(str(tmp_path / "rules.db"))
    assert get_rules(db)["quiet_start"] == ""
    set_rules(db, {"quiet_start": "23:00", "quiet_end": "07:00",
                   "timezone": "Europe/Copenhagen", "tags": {"radarr": [1, "x"], "bogus": [2]}})
    saved = get_rules(db)
    assert saved["quiet_start"] == "23:00"
    assert saved["timezone"] == "Europe/Copenhagen"
    assert saved["tags"] == {"radarr": [1], "sonarr": []}  # junk dropped


def test_an_unknown_timezone_falls_back_to_utc():
    from app.push import in_quiet_hours

    # must not raise: a bad tz shouldn't take the notifier down
    in_quiet_hours(_rules(quiet_start="00:00", quiet_end="23:59", timezone="Mars/Olympus"))
