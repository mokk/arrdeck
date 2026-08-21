"""The "why hasn't this arrived" checks.

Each finding is a claim about the user's stack, so a wrong one is worse than none
— it sends someone to fix an indexer when the film simply is not out yet.
"""

from datetime import UTC, datetime, timedelta

from app.api.v1.diagnose import (
    HEALTH_NOTICES,
    LEVELS,
    _availability_findings,
    _blocklist_findings,
    _delay_findings,
    _indexer_findings,
    _queue_findings,
    _rss_findings,
)


def codes(findings) -> list[str]:
    return [f.code for f in findings]


# --- is it already coming? ---------------------------------------------------


def test_a_downloading_item_is_reported_as_fine():
    queue = [{"movie_id": 7, "status": "downloading", "size_left": 5_000_000}]
    findings = _queue_findings(queue, 7, "radarr")
    assert codes(findings) == ["queue_downloading"]
    assert findings[0].level == "ok"


def test_a_queue_item_for_another_title_is_ignored():
    queue = [{"movie_id": 99, "status": "downloading", "size_left": 1}]
    assert _queue_findings(queue, 7, "radarr") == []


def test_series_queue_items_are_matched_on_the_series_id():
    """The id field differs per arr; matching on movie_id for Sonarr would find
    nothing and report the wrong answer."""
    queue = [{"series_id": 7, "status": "downloading", "size_left": 1}]
    assert codes(_queue_findings(queue, 7, "sonarr")) == ["queue_downloading"]
    assert _queue_findings(queue, 7, "radarr") == []


def test_a_failed_import_is_blocking_even_though_the_arr_still_says_downloading():
    """The arrs leave `status` at downloading after a failed import, so the
    errors are the only honest signal — this is the case people actually chase."""
    queue = [{"movie_id": 7, "status": "downloading", "errors": ["no space left"]}]
    findings = _queue_findings(queue, 7, "radarr")
    assert codes(findings) == ["queue_failed"]
    assert findings[0].level == "blocked"
    assert findings[0].params["reason"] == "no space left"


def test_a_stalled_download_is_a_warning_not_a_success():
    queue = [{"movie_id": 7, "tracked_state": "stalled", "size_left": 500}]
    findings = _queue_findings(queue, 7, "radarr")
    assert codes(findings) == ["queue_stalled"]
    assert findings[0].level == "warning"


def test_a_fully_downloaded_item_is_waiting_to_import():
    queue = [{"movie_id": 7, "status": "completed", "size_left": 0}]
    assert codes(_queue_findings(queue, 7, "radarr")) == ["queue_importing"]


# --- is it even out yet? -----------------------------------------------------


def test_an_unreleased_film_is_the_answer_rather_than_a_broken_indexer():
    """Radarr will not search until a film reaches its minimum availability, so
    without this check an unreleased film looks exactly like an indexer fault."""
    movie = {
        "monitored": True,
        "isAvailable": False,
        "minimumAvailability": "released",
        "physicalRelease": "2027-01-05T00:00:00Z",
    }
    findings = _availability_findings(movie)
    assert codes(findings) == ["not_yet_available"]
    assert findings[0].level == "blocked"
    assert findings[0].params["date"] == "2027-01-05"


def test_an_available_film_produces_no_availability_finding():
    assert _availability_findings({"monitored": True, "isAvailable": True}) == []


def test_an_unmonitored_film_is_blocked_on_that_alone():
    findings = _availability_findings({"monitored": False, "isAvailable": True})
    assert codes(findings) == ["not_monitored"]


def test_a_film_with_no_release_date_still_reports_the_reason():
    """A 2027 announcement has no physical or digital date yet; the finding has
    to survive that rather than dropping out."""
    movie = {"monitored": True, "isAvailable": False, "minimumAvailability": "released"}
    findings = _availability_findings(movie)
    assert codes(findings) == ["not_yet_available"]
    assert findings[0].params["date"] is None


# --- was it grabbed and rejected? -------------------------------------------


def test_a_blocklisted_release_is_surfaced():
    entries = [
        {
            "movieId": 85,
            "sourceTitle": "Roofman 2025 1080p WEB h264-ETHEL",
            "indexer": "TLTorznab",
            "message": "Manually marked as failed",
        }
    ]
    findings = _blocklist_findings(entries, 85, "radarr")
    assert codes(findings) == ["blocklisted"]
    assert findings[0].params["indexer"] == "TLTorznab"
    assert findings[0].params["release"].startswith("Roofman")


def test_the_join_is_on_the_id_not_the_release_name():
    """The record names the release, not the film, so matching on title missed
    every entry — including the one real blocklisted release in this library."""
    entries = [{"movieId": 85, "sourceTitle": "Roofman 2025 1080p WEB h264-ETHEL"}]
    assert codes(_blocklist_findings(entries, 85, "radarr")) == ["blocklisted"]
    assert _blocklist_findings(entries, 86, "radarr") == []


def test_series_blocklist_entries_use_the_series_id():
    entries = [{"seriesId": 24, "sourceTitle": "Alien.Earth.S01E01"}]
    assert codes(_blocklist_findings(entries, 24, "sonarr")) == ["blocklisted"]
    assert _blocklist_findings(entries, 24, "radarr") == []


def test_several_blocked_releases_are_counted():
    entries = [{"movieId": 85}, {"movieId": 85}, {"movieId": 99}]
    findings = _blocklist_findings(entries, 85, "radarr")
    assert findings[0].params["count"] == 2


def test_an_empty_blocklist_says_nothing():
    assert _blocklist_findings([], 85, "radarr") == []


# --- is anyone looking? ------------------------------------------------------


def test_an_overdue_rss_sync_explains_a_missing_grab():
    tasks = [{"app": "radarr", "name": "RssSync", "overdue": True, "overdue_by_seconds": 7200}]
    findings = _rss_findings(tasks, "radarr")
    assert codes(findings) == ["rss_overdue"]
    assert findings[0].params["minutes"] == 120


def test_another_arrs_rss_task_is_not_used():
    tasks = [{"app": "sonarr", "name": "RssSync", "overdue": True, "overdue_by_seconds": 60}]
    assert _rss_findings(tasks, "radarr") == []


def test_a_recent_rss_sync_says_nothing():
    recent = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    tasks = [{"app": "radarr", "name": "RssSync", "overdue": False, "last_execution": recent}]
    assert _rss_findings(tasks, "radarr") == []


def test_an_rss_sync_that_has_not_run_in_hours_is_mentioned_even_if_not_overdue():
    """A 30-minute interval that last ran three hours ago is inside its grace
    period but still the likeliest reason nothing has been picked up."""
    old = (datetime.now(UTC) - timedelta(hours=3)).isoformat()
    tasks = [{"app": "radarr", "name": "RssSync", "overdue": False, "last_execution": old}]
    findings = _rss_findings(tasks, "radarr")
    assert codes(findings) == ["rss_stale"]
    assert findings[0].level == "info"


# --- is it being held on purpose? -------------------------------------------


def test_a_delay_profile_is_reported_because_the_wait_is_deliberate():
    profiles = [{"usenetDelay": 0, "torrentDelay": 30, "bypassIfHighestQuality": True}]
    findings = _delay_findings(profiles)
    assert codes(findings) == ["delay_profile"]
    assert findings[0].params["torrent"] == 30
    assert findings[0].params["bypass"] is True


def test_a_zero_delay_profile_is_not_worth_mentioning():
    assert _delay_findings([{"usenetDelay": 0, "torrentDelay": 0}]) == []


# --- is there anywhere to look? ---------------------------------------------


def test_no_enabled_indexers_blocks_everything():
    findings = _indexer_findings({"enabled": 0, "total": 3, "health": []})
    assert codes(findings) == ["no_indexers"]
    assert findings[0].level == "blocked"


def test_an_update_notice_is_not_reported_as_an_indexer_failure():
    """Prowlarr files "New update is available" as a warning. Calling that an
    indexer fault is the false alarm this endpoint exists to avoid."""
    stats = {
        "enabled": 2,
        "total": 2,
        "health": [
            {"type": "warning", "source": "UpdateCheck", "message": "New update is available"}
        ],
    }
    assert _indexer_findings(stats) == []


def test_every_notice_source_is_filtered():
    for source in HEALTH_NOTICES:
        stats = {"enabled": 1, "health": [{"type": "warning", "source": source, "message": "x"}]}
        assert _indexer_findings(stats) == [], source


def test_a_real_indexer_warning_is_reported():
    stats = {
        "enabled": 2,
        "total": 2,
        "health": [
            {
                "type": "error",
                "source": "IndexerStatusCheck",
                "message": "Indexers unavailable due to failures: TLTorznab",
            }
        ],
    }
    findings = _indexer_findings(stats)
    assert codes(findings) == ["indexers_failing"]
    assert "TLTorznab" in findings[0].params["message"]


def test_healthy_indexers_produce_nothing():
    assert _indexer_findings({"enabled": 2, "total": 2, "health": []}) == []


def test_levels_are_ordered_worst_first():
    """The UI leads with findings[0], so the order is the feature."""
    assert LEVELS.index("blocked") < LEVELS.index("warning") < LEVELS.index("info")
    assert LEVELS.index("info") < LEVELS.index("ok")
