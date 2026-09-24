"""The fields behind the library views: "Up next", the bookshelf, request
badges, ratings and backdrops."""

import asyncio
import xml.etree.ElementTree as ET

import pytest
from fastapi import HTTPException

from app.api.v1.books import shelf_rows
from app.api.v1.cleanup import build_cleanup
from app.api.v1.discover import _fanart, _rating
from app.api.v1.movies import movie_quality
from app.api.v1.people import elsewhere_rows, index_credits, metadata_map
from app.api.v1.reading import apply as apply_reading
from app.api.v1.requests import request_keys
from app.api.v1.series import current_season, next_episodes
from app.cache import cache
from app.opds import book_entry, check_token


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


class FakeSonarr:
    name = "sonarr"

    def __init__(self, episodes: list[dict]) -> None:
        self._episodes = episodes

    async def calendar(self, start: str, end: str) -> list[dict]:
        return self._episodes


def test_next_episodes_keep_the_earliest_per_series():
    sonarr = FakeSonarr(
        [
            {
                "seriesId": 1,
                "seasonNumber": 3,
                "episodeNumber": 5,
                "airDateUtc": "2026-10-08T01:00:00Z",
            },
            {
                "seriesId": 1,
                "seasonNumber": 3,
                "episodeNumber": 4,
                "title": "Four",
                "airDateUtc": "2026-10-01T01:00:00Z",
            },
            {"seriesId": 2, "seasonNumber": 1, "episodeNumber": 1, "airDateUtc": None},
        ]
    )
    out = asyncio.run(next_episodes(sonarr))
    assert out == {
        1: {
            "season": 3,
            "episode": 4,
            "title": "Four",
            "air_date": "2026-10-01T01:00:00Z",
            "finale_type": None,
        }
    }, "the calendar is sorted first and undated episodes are skipped"


def test_next_episodes_degrade_to_nothing_when_sonarr_fails():
    class Broken:
        async def calendar(self, start: str, end: str) -> list[dict]:
            raise RuntimeError("down")

    assert asyncio.run(next_episodes(Broken())) == {}


SERIES = {
    "seasons": [
        {"seasonNumber": 0, "statistics": {"episodeFileCount": 1, "totalEpisodeCount": 4}},
        {"seasonNumber": 1, "statistics": {"episodeFileCount": 8, "totalEpisodeCount": 8}},
        {"seasonNumber": 2, "statistics": {"episodeFileCount": 3, "totalEpisodeCount": 10}},
    ]
}


def test_current_season_follows_the_next_episode_else_the_latest():
    assert current_season(SERIES, {"season": 1}) == {"number": 1, "have": 8, "total": 8}
    assert current_season(SERIES, None) == {"number": 2, "have": 3, "total": 10}
    assert current_season({"seasons": []}, None) is None


def test_rating_prefers_imdb_and_reads_sonarrs_single_value():
    assert _rating({"imdb": {"value": 6.8}, "tmdb": {"value": 6.9}}) == 6.8
    assert _rating({"tmdb": {"value": 7.1}}) == 7.1
    assert _rating({"votes": 12, "value": 7.9}) == 7.9
    assert _rating({"value": 0}) is None
    assert _rating(None) is None


def test_fanart_is_proxied_at_backdrop_width():
    url = _fanart(
        [{"coverType": "fanart", "remoteUrl": "https://image.tmdb.org/t/p/original/x.jpg"}]
    )
    assert url is not None and "w1280" in url
    assert (
        _fanart([{"coverType": "poster", "remoteUrl": "https://image.tmdb.org/t/p/original/x.jpg"}])
        is None
    )


def test_movie_quality_reads_the_file():
    assert (
        movie_quality({"movieFile": {"quality": {"quality": {"name": "WEBDL-2160p"}}}})
        == "WEBDL-2160p"
    )
    assert movie_quality({}) is None


def book(book_id: int, monitored: bool = False, files: int = 0) -> dict:
    return {
        "id": book_id,
        "authorId": 3,
        "title": f"Book {book_id}",
        "monitored": monitored,
        "statistics": {"bookFileCount": files},
    }


def test_shelf_keeps_series_with_a_library_book_and_all_their_gaps():
    books = [book(1, files=1), book(2), book(3), book(4)]
    series = {
        3: [
            {
                "id": 10,
                "title": "Sprawl",
                "links": [
                    {"bookId": 2, "position": "2", "seriesPosition": 2},
                    {"bookId": 1, "position": "1", "seriesPosition": 1},
                ],
            },
            {
                "id": 11,
                "title": "Unowned",
                "links": [{"bookId": 3, "position": "1", "seriesPosition": 1}],
            },
        ]
    }
    rows = shelf_rows(series, books, {3: {"authorName": "William Gibson"}})
    assert [r["title"] for r in rows] == ["Sprawl"], (
        "a series with nothing in the library stays off the shelf"
    )
    assert rows[0]["author"] == "William Gibson"
    assert [b["book_id"] for b in rows[0]["books"]] == [1, 2], "in series order, gap included"
    assert rows[0]["books"][1]["has_file"] is False


def test_request_keys_separate_films_from_shows():
    assert request_keys({"type": "movie", "media": {"tmdbId": 5}}) == ["movie:tmdb:5"]
    assert request_keys({"type": "tv", "media": {"tmdbId": 5, "tvdbId": 9}}) == [
        "tv:tmdb:5",
        "tv:tvdb:9",
    ]
    assert request_keys({"type": "tv", "media": {}}) == []


class FakeDB:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}

    def kv_get(self, key: str) -> str | None:
        return self.kv.get(key)

    def kv_set(self, key: str, value: str) -> None:
        self.kv[key] = value


class FakeRadarr:
    name = "radarr"

    def __init__(self) -> None:
        self.asked: list[int] = []

    async def credits(self, movie_id: int) -> list[dict]:
        self.asked.append(movie_id)
        return [{"movieMetadataId": movie_id * 10}]


def test_metadata_map_asks_only_about_unmapped_films_and_keeps_the_answer():
    radarr, db = FakeRadarr(), FakeDB()
    first = asyncio.run(metadata_map(radarr, db, [{"id": 1}, {"id": 2}]))
    assert first == {10: 1, 20: 2}
    again = asyncio.run(metadata_map(radarr, db, [{"id": 1}, {"id": 2}, {"id": 3}]))
    assert again == {10: 1, 20: 2, 30: 3}
    assert radarr.asked == [1, 2, 3], "films already mapped are not asked about again"


def test_index_credits_joins_people_to_movies_once_each():
    credits = [
        {
            "personTmdbId": 7,
            "personName": "Greta",
            "movieMetadataId": 10,
            "type": "crew",
            "job": "Director",
        },
        {
            "personTmdbId": 7,
            "personName": "Greta",
            "movieMetadataId": 10,
            "type": "crew",
            "job": "Writer",
        },
        {
            "personTmdbId": 7,
            "personName": "Greta",
            "movieMetadataId": 20,
            "type": "cast",
            "character": "Herself",
        },
        {"personTmdbId": 8, "movieMetadataId": 99, "type": "cast"},
    ]
    people = index_credits(credits, {10: 1, 20: 2})
    assert people == {7: {"name": "Greta", "movies": {1: "Director", 2: "Herself"}}}


def test_elsewhere_keeps_released_films_not_in_the_library_most_popular_first():
    credits = {
        "cast": [
            {
                "id": 1,
                "mediaType": "movie",
                "title": "Owned",
                "releaseDate": "2020-01-01",
                "popularity": 9,
            },
            {
                "id": 2,
                "mediaType": "movie",
                "title": "Less known",
                "releaseDate": "2019-01-01",
                "popularity": 1,
            },
            {"id": 3, "mediaType": "tv", "name": "A show", "popularity": 50},
            {"id": 4, "mediaType": "movie", "title": "Announced", "popularity": 30},
            {
                "id": 6,
                "mediaType": "movie",
                "title": "Next year",
                "releaseDate": "2027-01-01",
                "popularity": 40,
            },
        ],
        "crew": [
            {
                "id": 5,
                "mediaType": "movie",
                "title": "Famous",
                "releaseDate": "2021-05-01",
                "popularity": 20,
            },
            {
                "id": 5,
                "mediaType": "movie",
                "title": "Famous",
                "releaseDate": "2021-05-01",
                "popularity": 20,
            },
        ],
    }
    rows = elsewhere_rows(credits, in_library={1}, today="2026-09-23")
    assert [r["title"] for r in rows] == ["Famous", "Less known"]
    assert rows[0]["kind"] == "movie" and rows[0]["remote_id"] == 5 and rows[0]["year"] == 2021


NOW = 1_790_139_600  # 2026-09-23
OLD = "2025-01-01T00:00:00Z"
RECENT = "2026-09-01T00:00:00Z"


def movie(i: int, tmdb: int, size: int, added: str = OLD, monitored: bool = True) -> dict:
    return {
        "id": i,
        "title": f"M{i}",
        "tmdbId": tmdb,
        "sizeOnDisk": size,
        "added": added,
        "monitored": monitored,
    }


def test_cleanup_sorts_titles_into_the_four_lists():
    movies = [
        movie(1, 11, 5, monitored=False),  # watched long ago, unmonitored
        movie(2, 12, 9),  # in Plex, never played, added long ago
        movie(3, 13, 7, added=RECENT),  # never played but new: not yet a candidate
        movie(4, 14, 0),  # nothing on disk: never listed
        movie(5, 15, 3),  # Plex has never heard of it
    ]
    series = [
        {
            "id": 9,
            "title": "S",
            "tvdbId": 99,
            "added": OLD,
            "monitored": True,
            "statistics": {"sizeOnDisk": 20},
        }
    ]
    watched = {
        "tmdb:11": {"watched": True, "progress": 1.0, "last_viewed_at": NOW - 90 * 86_400},
        "tmdb:12": {"watched": False, "progress": 0.0},
        "tmdb:13": {"watched": False, "progress": 0.0},
        "tvdb:99": {"watched": True, "progress": 1.0, "last_viewed_at": NOW - 86_400},
    }
    out = build_cleanup(movies, series, watched, watched_days=30, never_days=365, now=NOW)
    assert out["plex"] is True
    assert [r["id"] for r in out["watched"]] == [1], "the show was watched yesterday"
    assert [r["id"] for r in out["never_watched"]] == [2]
    assert [r["id"] for r in out["largest"]] == [9, 2, 3, 1, 5]
    assert [r["id"] for r in out["unmonitored"]] == [1]


def test_cleanup_without_plex_keeps_the_watch_lists_empty():
    out = build_cleanup([movie(1, 11, 5)], [], None, 30, 365, NOW)
    assert out["plex"] is False and out["watched"] == [] and out["never_watched"] == []
    assert [r["id"] for r in out["largest"]] == [1]


def test_reading_status_stamps_and_forgets_the_finish_date():
    s = apply_reading({}, 5, "reading", now=100)
    assert s["5"] == {"status": "reading", "finished_at": None, "updated_at": 100}
    s = apply_reading(s, 5, "read", now=200)
    assert s["5"]["finished_at"] == 200
    s = apply_reading(s, 5, "read", now=300)
    assert s["5"]["finished_at"] == 200, "marking read again keeps the first date"
    s = apply_reading(s, 5, "to_read", now=400)
    assert s["5"]["finished_at"] is None
    assert apply_reading(s, 5, None, now=500) == {}


def test_opds_entry_escapes_and_links_each_file():
    book = {
        "id": 3,
        "authorId": 1,
        "title": 'Tom & "Jerry" <1>',
        "added": "2026-01-01T00:00:00Z",
        "images": [{"coverType": "cover", "remoteUrl": "https://covers.test/x.jpg"}],
    }
    files = [
        {"id": 8, "path": "/books/Tom/Tom & Jerry.epub"},
        {"id": 9, "path": "/books/Tom/t.azw3"},
    ]
    xml = book_entry("http://h/opds/T", book, files, {1: {"authorName": "A & B"}})
    ET.fromstring(
        f'<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">{xml}</feed>'
    )
    assert "Tom &amp; &quot;Jerry&quot; &lt;1&gt;" in xml or 'Tom &amp; "Jerry" &lt;1&gt;' in xml
    assert 'href="http://h/opds/T/download/3/8" type="application/epub+zip"' in xml
    assert 'type="application/vnd.amazon.ebook"' in xml
    assert "http://h/opds/T/cover/3" in xml


def test_opds_token_is_checked_and_a_disabled_feed_is_a_404():
    class Req:
        class app:
            class state:
                db = FakeDB()

    Req.app.state.db.kv_set("opds.token", "secret")
    check_token(Req, "secret")
    with pytest.raises(HTTPException):
        check_token(Req, "wrong")
    Req.app.state.db.kv_set("opds.token", "")
    with pytest.raises(HTTPException):
        check_token(Req, "")
