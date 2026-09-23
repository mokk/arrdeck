"""Per-title subtitles, episode files, the since-last-look feed, and the book
author/series/edition pieces — the pure mapping behind each route."""

from datetime import UTC, datetime

from app.api.v1.activity import completed_torrents, history_events
from app.api.v1.books import author_row, series_containing, series_rows
from app.api.v1.discover import edition_choice, new_book_payload
from app.api.v1.series import episode_row
from app.api.v1.subtitles import title_subtitles
from app.schemas import AddBookIn


def test_title_subtitles_split_present_and_missing_and_flag_untracked():
    row = {
        "subtitles": [
            {"name": "Danish", "code2": "da", "path": "/x.da.srt", "forced": False, "hi": False}
        ],
        "missing_subtitles": [{"name": "English", "code2": "en", "forced": False, "hi": True}],
    }
    out = title_subtitles(row)
    assert (
        out["tracked"]
        and out["present"][0]["code"] == "da"
        and out["present"][0]["path"] == "/x.da.srt"
    )
    assert out["missing"] == [
        {"language": "English", "code": "en", "forced": False, "hi": True, "path": None}
    ]
    assert title_subtitles(None) == {"tracked": False, "present": [], "missing": []}


def test_episode_row_reads_the_file_readarr_style():
    e = {
        "id": 9,
        "seasonNumber": 2,
        "episodeNumber": 3,
        "title": "Ep",
        "hasFile": True,
        "monitored": True,
        "episodeFile": {"id": 77, "size": 1234, "quality": {"quality": {"name": "WEBDL-1080p"}}},
    }
    row = episode_row(e)
    assert (row.file_id, row.quality, row.size) == (77, "WEBDL-1080p", 1234)
    assert episode_row({"id": 1, "seasonNumber": 1, "episodeNumber": 1}).file_id is None


SINCE = datetime(2026, 9, 23, 12, 0, tzinfo=UTC)


def test_history_events_keep_notable_events_after_the_cutoff_only():
    records = [
        {
            "eventType": "downloadFolderImported",
            "date": "2026-09-23T13:00:00Z",
            "sourceTitle": "A",
            "movieId": 1,
        },
        {"eventType": "downloadFailed", "date": "2026-09-23T11:00:00Z", "sourceTitle": "old"},
        {"eventType": "movieFileRenamed", "date": "2026-09-23T14:00:00Z", "sourceTitle": "noise"},
        {
            "eventType": "bookFileImported",
            "date": "2026-09-23T15:00:00Z",
            "sourceTitle": "B",
            "bookId": 4,
        },
    ]
    out = history_events("radarr", records, SINCE)
    assert [(e["kind"], e["title"]) for e in out] == [("imported", "A"), ("imported", "B")]
    assert out[0]["movie_id"] == 1 and out[1]["book_id"] == 4


def test_completed_torrents_use_the_done_timestamp():
    torrents = [
        {"name": "done", "completion_on": int(SINCE.timestamp()) + 60},
        {"name": "earlier", "completion_on": int(SINCE.timestamp()) - 60},
        {"name": "running", "completion_on": 0},
    ]
    out = completed_torrents("qbittorrent", torrents, SINCE, "completion_on", "name")
    assert [e["title"] for e in out] == ["done"] and out[0]["kind"] == "completed"


AUTHOR = {
    "id": 3,
    "authorName": "William Gibson",
    "monitored": True,
    "monitorNewItems": "none",
    "qualityProfileId": 1,
    "metadataProfileId": 3,
    "images": [{"coverType": "poster", "remoteUrl": "https://covers.test/wg.jpg"}],
    "statistics": {"bookCount": 3, "availableBookCount": 2, "sizeOnDisk": 100},
}
BOOKS = {
    146: {
        "id": 146,
        "title": "Archangel #1",
        "monitored": True,
        "statistics": {"bookFileCount": 1},
    },
    147: {"id": 147, "title": "Archangel #2", "monitored": False, "statistics": {}},
}
SERIES = [
    {
        "id": 6,
        "title": "Archangel",
        "links": [
            {"bookId": 147, "position": "2", "seriesPosition": 2},
            {"bookId": 146, "position": "1", "seriesPosition": 1},
            {"bookId": 999, "position": "3", "seriesPosition": 3},
        ],
    }
]


def test_author_row_reads_statistics_and_poster():
    row = author_row(AUTHOR)
    assert (row["name"], row["monitor_new_items"], row["book_count"], row["available_count"]) == (
        "William Gibson",
        "none",
        3,
        2,
    )
    assert row["poster"]


def test_series_rows_join_books_in_position_order_and_skip_unknown_ids():
    rows = series_rows(SERIES, BOOKS)
    assert rows[0]["title"] == "Archangel"
    assert [
        (b["book_id"], b["position"], b["has_file"], b["monitored"]) for b in rows[0]["books"]
    ] == [
        (146, "1", True, True),
        (147, "2", False, False),
    ]
    assert series_containing(147, rows) == rows and series_containing(5, rows) == []


def test_edition_choice_and_the_picked_edition_becomes_the_monitored_one():
    editions = [
        {
            "foreignEditionId": "1",
            "title": "Hardcover",
            "format": "Hardcover",
            "language": "eng",
            "monitored": True,
        },
        {
            "foreignEditionId": "2",
            "title": "Dansk",
            "format": "Paperback",
            "language": "dan",
            "releaseDate": "2012-05-01",
        },
    ]
    choice = edition_choice(editions[1])
    assert (
        choice["foreign_edition_id"],
        choice["language"],
        choice["year"],
        choice["monitored"],
    ) == ("2", "dan", 2012, False)

    body = AddBookIn(
        foreign_book_id="b",
        foreign_edition_id="2",
        title="T",
        quality_profile_id=1,
        root_folder_path="/data/Books",
    )
    payload = new_book_payload(
        {"foreignBookId": "b", "author": {"id": 3}, "editions": editions}, body, None
    )
    assert [e["monitored"] for e in payload["editions"]] == [False, True]
    assert payload["foreignEditionId"] == "2"
