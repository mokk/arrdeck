"""Overdue detection and parsing for the arrs' scheduled tasks."""

from datetime import UTC, datetime, timedelta

from app.api.v1.tasks import (
    MAX_GRACE_SECONDS,
    MIN_GRACE_SECONDS,
    _grace,
    _parse_duration,
    _parse_time,
    _to_task,
)

NOW = datetime(2026, 8, 20, 12, 0, 0, tzinfo=UTC)


def raw_task(name: str, interval: int, next_in_seconds: float, **extra) -> dict:
    return {
        "name": name,
        "taskName": name,
        "interval": interval,
        "nextExecution": (NOW + timedelta(seconds=next_in_seconds)).isoformat(),
        "lastExecution": (NOW - timedelta(seconds=1)).isoformat(),
        **extra,
    }


def test_a_task_due_in_the_future_is_not_overdue():
    task = _to_task("radarr", raw_task("RssSync", 30, 600), NOW)
    assert task.overdue is False
    assert task.overdue_by_seconds is None


def test_a_minutely_task_slipping_seconds_is_not_overdue():
    """RefreshMonitoredDownloads runs every minute; 30s late is business as usual."""
    task = _to_task("radarr", raw_task("RefreshMonitoredDownloads", 1, -30), NOW)
    assert task.overdue is False


def test_a_minutely_task_hours_late_is_overdue():
    task = _to_task("radarr", raw_task("RefreshMonitoredDownloads", 1, -7200), NOW)
    assert task.overdue is True
    assert task.overdue_by_seconds == 7200.0


def test_an_hourly_task_is_given_half_its_interval():
    # 30m interval -> 15m grace, so 10m late passes and 20m late does not.
    assert _to_task("radarr", raw_task("RssSync", 30, -600), NOW).overdue is False
    assert _to_task("radarr", raw_task("RssSync", 30, -1200), NOW).overdue is True


def test_grace_is_clamped_at_both_ends():
    assert _grace(1) == MIN_GRACE_SECONDS  # half a minute would be too tight
    assert _grace(10080) == MAX_GRACE_SECONDS  # weekly Backup, not 3.5 days of slack


def test_a_disabled_task_is_never_overdue():
    """interval 0 means the user turned it off, not that it failed."""
    task = _to_task("sonarr", raw_task("Backup", 0, -999999), NOW)
    assert task.overdue is False


def test_missing_next_execution_is_not_overdue():
    raw = {"taskName": "RssSync", "interval": 30}
    assert _to_task("radarr", raw, NOW).overdue is False


def test_notable_flag_marks_the_tasks_worth_showing():
    assert _to_task("radarr", raw_task("RssSync", 30, 60), NOW).notable is True
    assert _to_task("radarr", raw_task("MessagingCleanup", 5, 60), NOW).notable is False


def test_label_falls_back_to_task_name():
    task = _to_task("radarr", {"taskName": "RssSync", "interval": 30}, NOW)
    assert task.label == "RssSync"
    named = _to_task("radarr", {"taskName": "RssSync", "name": "RSS Sync"}, NOW)
    assert named.label == "RSS Sync"


def test_duration_parsing():
    assert _parse_duration("00:00:00.9939677") == 0.9939677
    assert _parse_duration("00:01:30") == 90.0
    assert _parse_duration("01:00:00") == 3600.0
    assert _parse_duration(None) is None
    assert _parse_duration("nonsense") is None


def test_naive_timestamps_are_read_as_utc():
    """The arrs are inconsistent about the offset; dropping the field would
    silently mark everything not-overdue."""
    parsed = _parse_time("2026-08-20T09:44:20")
    assert parsed is not None and parsed.tzinfo is UTC
    assert _parse_time("2026-08-20T09:44:20Z") == parsed
    assert _parse_time("") is None
    assert _parse_time("not a date") is None
