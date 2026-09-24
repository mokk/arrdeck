"""Trakt lists as addable search results."""

import httpx

from app.api.v1.trakt import lookup_poster, trakt_rows
from app.clients.trakt import TraktClient
from app.registry import is_configured


def test_rows_key_movies_by_tmdb_and_shows_by_tvdb_and_drop_the_rest():
    movies = trakt_rows(
        [
            {"title": "Dune", "year": 2021, "ids": {"tmdb": 438631, "imdb": "tt1160419"}},
            {"title": "No tmdb", "ids": {"imdb": "tt1"}},
        ],
        "movie",
    )
    assert movies == [
        {
            "kind": "movie",
            "title": "Dune",
            "year": 2021,
            "overview": None,
            "remote_id": 438631,
            "tmdb_id": 438631,
            "imdb_id": "tt1160419",
        }
    ]
    shows = trakt_rows([{"title": "Slow Horses", "ids": {"tvdb": 372264, "tmdb": 95480}}], "series")
    assert shows[0]["remote_id"] == 372264 and shows[0]["tmdb_id"] == 95480


def test_poster_comes_from_the_lookup():
    assert lookup_poster([]) is None
    assert "tmdb" in lookup_poster([{"remotePoster": "https://image.tmdb.org/t/p/original/a.jpg"}])


def test_trakt_needs_only_a_client_id():
    assert is_configured("trakt", {"api_key": "abc", "url": ""})
    assert not is_configured("trakt", {"api_key": "", "url": "https://api.trakt.tv"})


async def test_list_unwraps_trending_and_sends_the_client_id():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        seen["headers"] = request.headers
        if request.url.path.endswith("popular"):
            return httpx.Response(200, json=[{"title": "Heat", "ids": {"tmdb": 949}}])
        return httpx.Response(
            200, json=[{"watchers": 9, "show": {"title": "Slow Horses", "ids": {"tvdb": 1}}}]
        )

    client = TraktClient(httpx.AsyncClient(transport=httpx.MockTransport(handler)), "cid")
    assert (await client.list("shows", "trending"))[0]["title"] == "Slow Horses"
    assert seen["url"].host == "api.trakt.tv" and seen["url"].path == "/shows/trending"
    assert seen["headers"]["trakt-api-key"] == "cid" and seen["headers"]["trakt-api-version"] == "2"
    assert (await client.list("movies", "popular"))[0]["title"] == "Heat"
