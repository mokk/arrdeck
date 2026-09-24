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
    assert (
        title_subtitles({"profileId": None, "subtitles": [], "missing_subtitles": []})["tracked"]
        is False
    )
    assert (
        title_subtitles({"profileId": 1, "subtitles": [], "missing_subtitles": []})["tracked"]
        is True
    )


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


def test_series_payload_picked_seasons_preset_and_default():
    from app.api.v1.discover import series_payload
    from app.schemas import AddSeriesIn

    base = {"tvdb_id": 1, "title": "Reacher", "quality_profile_id": 4, "root_folder_path": "/tv"}
    picked = series_payload(AddSeriesIn(**base, seasons=[3, 4], search_now=False), [0, 1, 2, 3, 4])
    assert picked["seasons"] == [
        {"seasonNumber": 0, "monitored": False},
        {"seasonNumber": 1, "monitored": False},
        {"seasonNumber": 2, "monitored": False},
        {"seasonNumber": 3, "monitored": True},
        {"seasonNumber": 4, "monitored": True},
    ]
    assert picked["addOptions"] == {"searchForMissingEpisodes": False, "monitor": "skip"}

    preset = series_payload(AddSeriesIn(**base, monitor="lastSeason"), [])
    assert preset["addOptions"]["monitor"] == "lastSeason" and "seasons" not in preset
    # picked seasons win over a preset sent alongside
    both = series_payload(AddSeriesIn(**base, monitor="all", seasons=[1]), [1, 2])
    assert both["addOptions"]["monitor"] == "skip"

    default = series_payload(AddSeriesIn(**base), [])
    assert default["addOptions"] == {"searchForMissingEpisodes": True} and "seasons" not in default


def test_cleanup_lists_the_seasons_with_files():
    from app.api.v1.cleanup import cleanup_row

    series = {
        "id": 62,
        "title": "Reacher",
        "statistics": {"sizeOnDisk": 30},
        "seasons": [
            {
                "seasonNumber": 4,
                "monitored": True,
                "statistics": {"sizeOnDisk": 25, "episodeFileCount": 8},
            },
            {
                "seasonNumber": 1,
                "monitored": False,
                "statistics": {"sizeOnDisk": 5, "episodeFileCount": 8},
            },
            {"seasonNumber": 2, "monitored": False, "statistics": {"sizeOnDisk": 0}},
        ],
    }
    row = cleanup_row("series", series, None)
    assert [s["number"] for s in row["seasons"]] == [1, 4]
    assert row["seasons"][1] == {"number": 4, "size": 25, "files": 8, "monitored": True}
    assert cleanup_row("movie", {"id": 1, "sizeOnDisk": 3}, None)["seasons"] == []


async def test_removing_seasons_unmonitors_before_deleting_only_their_files():
    import httpx

    from app.api.v1.cleanup import remove_seasons
    from app.clients.sonarr import SonarrClient
    from app.schemas import SeasonRemoveIn

    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.path, body))
        if request.method == "GET" and request.url.path.endswith("/series/62"):
            return httpx.Response(
                200,
                json={
                    "id": 62,
                    "seasons": [
                        {"seasonNumber": 1, "monitored": True},
                        {"seasonNumber": 2, "monitored": True},
                    ],
                },
            )
        if request.method == "GET" and request.url.path.endswith("/episodefile"):
            return httpx.Response(
                200,
                json=[
                    {"id": 10, "seasonNumber": 1},
                    {"id": 11, "seasonNumber": 1},
                    {"id": 20, "seasonNumber": 2},
                ],
            )
        return httpx.Response(200, json={})

    sonarr = SonarrClient(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)), "http://s", "k"
    )
    out = await remove_seasons(62, SeasonRemoveIn(seasons=[1]), sonarr)
    assert out == {"deleted_files": 2}
    methods = [(m, p.rsplit("/", 1)[-1]) for m, p, _ in calls]
    assert methods.index(("PUT", "62")) < methods.index(("DELETE", "bulk")), "unmonitor first"
    put = next(b for m, p, b in calls if m == "PUT")
    assert put["seasons"] == [
        {"seasonNumber": 1, "monitored": False},
        {"seasonNumber": 2, "monitored": True},
    ]
    delete = next(b for m, p, b in calls if m == "DELETE")
    assert delete == {"episodeFileIds": [10, 11]}
