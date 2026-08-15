from app.api.v1.dashboard import _consolidate_history


def rec(event, date, download_id="abc", title="Some.Release", movie_id=None):
    return {
        "eventType": event,
        "date": date,
        "downloadId": download_id,
        "sourceTitle": title,
        "movieId": movie_id,
        "quality": {"quality": {"name": "WEBDL-1080p"}},
    }


def test_groups_by_download_id_with_chronological_unique_tags():
    payload = {
        "records": [
            rec("downloadFolderImported", "2026-01-02T00:00:00Z"),
            rec("grabbed", "2026-01-01T00:00:00Z"),
            rec("grabbed", "2026-01-01T01:00:00Z"),  # duplicate type collapses
        ]
    }
    out = _consolidate_history("radarr", payload)
    assert len(out) == 1
    item = out[0]
    assert [e["type"] for e in item["events"]] == ["fetched", "imported"]
    assert item["date"] == "2026-01-02T00:00:00Z"  # newest event wins as sort key


def test_separate_downloads_stay_separate_and_sort_newest_first():
    payload = {
        "records": [
            rec("grabbed", "2026-01-01T00:00:00Z", download_id="a", title="A"),
            rec("grabbed", "2026-01-05T00:00:00Z", download_id="b", title="B"),
        ]
    }
    out = _consolidate_history("radarr", payload)
    assert [i["title"] for i in out] == ["B", "A"]


def test_captures_media_ids_for_drill_through():
    payload = {"records": [rec("grabbed", "2026-01-01T00:00:00Z", movie_id=42)]}
    out = _consolidate_history("radarr", payload)
    assert out[0]["movie_id"] == 42
