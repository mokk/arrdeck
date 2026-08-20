"""The cache keeps values past their TTL so a dead upstream can still render.

That makes the key space the thing to bound: calendar keys embed a date range,
so browsing a year of weeks used to add ~100 permanent entries.
"""

import time

from app.cache import TTLCache


def test_a_value_is_returned_inside_its_ttl():
    c = TTLCache()
    c.set("k", "v")
    assert c.get("k", ttl=60) == "v"


def test_an_expired_value_is_withheld_but_still_available_as_stale():
    c = TTLCache()
    c.set("k", "v")
    time.sleep(0.01)
    assert c.get("k", ttl=0.001) is None
    age, value = c.get_stale("k")
    assert value == "v" and age > 0


def test_entries_are_capped():
    c = TTLCache(max_entries=10)
    for i in range(50):
        c.set(f"k{i}", i)
    assert c.stats()["entries"] == 10
    assert c.stats()["evictions"] == 40


def test_the_oldest_untouched_entry_is_evicted_first():
    c = TTLCache(max_entries=3)
    for key in ("a", "b", "c"):
        c.set(key, key)
    c.set("d", "d")  # pushes out "a"
    assert c.get_stale("a") is None
    assert c.get("d", ttl=60) == "d"


def test_reading_an_entry_protects_it_from_eviction():
    # this is what keeps the dashboard's fixed-key blocks resident while
    # one-off date-range keys churn through
    c = TTLCache(max_entries=3)
    for key in ("health", "b", "c"):
        c.set(key, key)
    c.get("health", ttl=60)          # a dashboard poll
    c.set("calendar:1", 1)           # someone steps a week
    assert c.get("health", ttl=60) == "health"
    assert c.get_stale("b") is None  # "b" was the least recently used


def test_a_stale_read_also_protects_an_entry():
    # an offline service is read through get_stale, not get
    c = TTLCache(max_entries=2)
    c.set("vpn", "v")
    c.set("x", 1)
    c.get_stale("vpn")
    c.set("y", 2)
    assert c.get_stale("vpn") is not None
    assert c.get_stale("x") is None


def test_overwriting_a_key_does_not_grow_the_store():
    c = TTLCache(max_entries=5)
    for _ in range(20):
        c.set("same", 1)
    assert c.stats()["entries"] == 1
    assert c.stats()["evictions"] == 0


def test_a_year_of_calendar_browsing_stays_bounded():
    # the motivating case: one permanent key per week, per arr
    c = TTLCache(max_entries=64)
    for week in range(52):
        for app in ("radarr", "sonarr"):
            c.set(f"calendar:{app}:2026-{week:02d}", [])
    assert c.stats()["entries"] == 64
    assert c.stats()["evictions"] == 40


def test_clear_empties_everything():
    c = TTLCache()
    c.set("a", 1)
    c.clear()
    assert c.stats()["entries"] == 0
    assert c.get_stale("a") is None
