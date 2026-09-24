"""The weekly digest: when it is due, and what it says."""

from datetime import UTC, datetime

from app.push import digest_note, due_slot, get_rules, latest_slot, summarise

RULES = {"timezone": "Europe/Copenhagen", "digest_day": 6, "digest_time": "18:00"}


def test_latest_slot_is_the_last_chosen_weekday_and_time_in_the_zone():
    # Thursday 24 Sep 2026, 05:00 UTC → the Sunday before at 18:00 Copenhagen (16:00 UTC)
    slot = latest_slot(RULES, datetime(2026, 9, 24, 5, 0, tzinfo=UTC))
    assert slot.astimezone(UTC) == datetime(2026, 9, 20, 16, 0, tzinfo=UTC)
    # on the day, just before the time, it is still last week's
    before = latest_slot(RULES, datetime(2026, 9, 27, 15, 59, tzinfo=UTC))
    assert before.astimezone(UTC) == datetime(2026, 9, 20, 16, 0, tzinfo=UTC)


def test_due_once_and_only_shortly_after_the_slot():
    sunday = datetime(2026, 9, 27, 16, 5, tzinfo=UTC)
    slot = due_slot(RULES, sunday, 0)
    assert slot is not None
    assert due_slot(RULES, sunday, slot.timestamp()) is None  # already sent
    # starting up on Wednesday does not announce Sunday's digest
    assert due_slot(RULES, datetime(2026, 9, 30, 9, 0, tzinfo=UTC), 0) is None


def test_summary_counts_imports_and_upcoming_and_names_a_few_shows():
    params = summarise(
        {
            "radarr": [{"eventType": "downloadFolderImported"}, {"eventType": "grabbed"}],
            "sonarr": [{"eventType": "downloadFolderImported"}] * 3,
            "readarr": [{"eventType": "bookFileImported"}],
        },
        {
            "sonarr": [{"series": {"title": "Slow Horses"}}, {"series": {"title": "Slow Horses"}}],
            "radarr": [{"title": "Dune"}],
        },
    )
    assert params["radarr_imported"] == 1 and params["sonarr_imported"] == 3
    assert params["readarr_imported"] == 1
    assert params["sonarr_upcoming"] == 2 and params["radarr_upcoming"] == 1
    assert params["titles"] == ["Slow Horses", "Dune"]


def test_note_reads_like_a_sentence_and_a_quiet_week_sends_nothing():
    note = digest_note(
        summarise(
            {"sonarr": [{"eventType": "downloadFolderImported"}]},
            {"radarr": [{"title": "Dune"}] * 2},
        )
    )
    assert note.code == "digest"
    assert note.body == "1 episode downloaded · 2 movies coming up"
    assert note.heading == "Dune"
    assert note.params["sonarr_imported"] == 1 and "titles" not in note.params
    assert digest_note(summarise({}, {})) is None


def test_rules_keep_a_valid_schedule_and_ignore_a_broken_one():
    class DB(dict):
        def kv_get(self, key):
            return self.get(key)

    db = DB()
    assert get_rules(db)["digest_day"] == 6 and get_rules(db)["digest_time"] == "18:00"
    db["push_rules"] = '{"digest_day": 0, "digest_time": "08:30"}'
    assert (get_rules(db)["digest_day"], get_rules(db)["digest_time"]) == (0, "08:30")
    db["push_rules"] = '{"digest_day": 9, "digest_time": "25:00"}'
    assert (get_rules(db)["digest_day"], get_rules(db)["digest_time"]) == (6, "18:00")
