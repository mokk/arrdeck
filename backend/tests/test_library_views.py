"""The fields behind the library views: "Up next", the bookshelf, request
badges, ratings and backdrops."""

import asyncio

import pytest

from app.api.v1.books import shelf_rows
from app.api.v1.discover import _fanart, _rating
from app.api.v1.movies import movie_quality
from app.api.v1.requests import request_keys
from app.api.v1.series import current_season, next_episodes
from app.cache import cache


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
        1: {"season": 3, "episode": 4, "title": "Four", "air_date": "2026-10-01T01:00:00Z"}
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
