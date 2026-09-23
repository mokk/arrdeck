"""Readarr's book rows: the author is a separate object, quality lives on it,
and a book "has a file" when its statistics say so."""

import pytest

from app.api.v1.books import (
    DOWNLOAD_FEATURE,
    author_map,
    book_cover,
    book_row,
    content_disposition,
    file_row,
    fork_features,
    year_of,
)
from app.api.v1.dashboard import EVENT_LABELS, _consolidate_history, _queue_items
from app.cache import cache


class FakeReadarr:
    name = "readarr"

    def __init__(self, authors: list[dict]) -> None:
        self._authors = authors
        self.calls = 0

    async def authors(self) -> list[dict]:
        self.calls += 1
        return self._authors


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


AUTHOR = {"id": 3, "authorName": "William Gibson", "qualityProfileId": 1, "metadataProfileId": 3}
BOOK = {
    "id": 133,
    "authorId": 3,
    "title": "Count Zero",
    "seriesTitle": "Sprawl",
    "releaseDate": "1986-03-01T08:00:00Z",
    "pageCount": 278,
    "monitored": True,
    "foreignBookId": "22328",
    "images": [{"coverType": "cover", "remoteUrl": "https://covers.test/cz.jpg"}],
    "statistics": {"bookFileCount": 1, "sizeOnDisk": 968737},
}


def test_book_row_joins_the_author_and_reads_the_statistics():
    row = book_row(BOOK, {3: AUTHOR})
    assert row["author"] == "William Gibson"
    assert row["quality_profile_id"] == 1, "quality is the author's setting"
    assert row["has_file"] is True
    assert row["size_on_disk"] == 968737
    assert row["year"] == 1986
    assert row["series_title"] == "Sprawl"
    assert row["poster"] and "covers.test" in row["poster"]


def test_book_without_files_or_author_degrades():
    row = book_row({"id": 1, "title": "Orphan", "statistics": {}}, {})
    assert row["author"] is None
    assert row["has_file"] is False
    assert row["year"] is None
    assert row["poster"] is None


def test_cover_accepts_readarrs_name_and_the_generic_one():
    assert book_cover([{"coverType": "cover", "url": "/x.jpg"}])
    assert book_cover([{"coverType": "poster", "url": "/x.jpg"}])
    assert book_cover([{"coverType": "fanart", "url": "/x.jpg"}]) is None
    assert year_of("2019-01-01T08:00:00Z") == 2019
    assert year_of(None) is None
    assert year_of("n/a") is None


async def test_author_map_is_cached_across_calls():
    readarr = FakeReadarr([AUTHOR])
    assert (await author_map(readarr))[3]["authorName"] == "William Gibson"
    await author_map(readarr)
    assert readarr.calls == 1


def test_queue_rows_name_the_book_and_author():
    payload = {
        "records": [
            {
                "id": 9,
                "title": "William.Gibson.Count.Zero.ePub-GRP",
                "status": "completed",
                "trackedDownloadState": "importFailed",
                "trackedDownloadStatus": "warning",
                "size": 10.0,
                "sizeleft": 0.0,
                "bookId": 133,
                "authorId": 3,
                "book": {"title": "Count Zero"},
                "author": {"authorName": "William Gibson"},
                "statusMessages": [{"messages": ["Book match is not close enough"]}],
            }
        ]
    }
    [item] = _queue_items("readarr", payload)
    assert item.app == "readarr"
    assert item.title == "William Gibson — Count Zero"
    assert item.book_id == 133
    assert item.errors == ["Book match is not close enough"]


def test_history_events_use_readarrs_names_and_carry_the_book_id():
    assert EVENT_LABELS["bookFileImported"] == "imported"
    assert EVENT_LABELS["bookImportIncomplete"] == "incomplete"
    payload = {
        "records": [
            {
                "id": 1,
                "downloadId": "abc",
                "sourceTitle": "rel",
                "date": "2026-09-22T20:00:00Z",
                "eventType": "grabbed",
                "bookId": 133,
            },
            {
                "id": 2,
                "downloadId": "abc",
                "sourceTitle": "rel",
                "date": "2026-09-22T20:17:00Z",
                "eventType": "bookImportIncomplete",
                "bookId": 133,
            },
        ]
    }
    [row] = _consolidate_history("readarr", payload)
    assert row["book_id"] == 133
    assert [e["type"] for e in row["events"]] == ["fetched", "incomplete"]


def test_file_row_names_the_file_and_reads_the_quality_as_format():
    row = file_row(
        {
            "id": 17,
            "path": "/data/Books/Jussi/Syv m2 med lås.epub",
            "size": 921813,
            "quality": {"quality": {"id": 3, "name": "EPUB"}},
        }
    )
    assert row == {"id": 17, "name": "Syv m2 med lås.epub", "size": 921813, "format": "EPUB"}


def test_content_disposition_keeps_the_real_name_and_an_ascii_fallback():
    header = content_disposition("Syv m² med lås.epub")
    assert header.startswith('attachment; filename="Syv m? med l?s.epub"')
    assert "filename*=UTF-8''Syv%20m%C2%B2%20med%20l%C3%A5s.epub" in header


class StatusReadarr:
    name = "readarr"

    def __init__(self, status: dict | None) -> None:
        self._status = status

    async def fork_features(self) -> list[str]:
        if self._status is None:
            raise RuntimeError("down")
        return list(self._status.get("forkFeatures") or [])


@pytest.mark.asyncio
async def test_fork_features_come_from_status_and_default_to_none():
    assert await fork_features(StatusReadarr({"forkFeatures": [DOWNLOAD_FEATURE]})) == [
        DOWNLOAD_FEATURE
    ]
    cache.clear()
    assert await fork_features(StatusReadarr({"version": "0.4.0"})) == [], "upstream build"
    cache.clear()
    assert await fork_features(StatusReadarr(None)) == [], "unreachable is not an error here"
