"""Watch statistics from Plex history."""

from datetime import datetime
from zoneinfo import ZoneInfo

from app.api.v1.watchstats import build_stats

CPH = ZoneInfo("Europe/Copenhagen")


def at(*args) -> int:
    return int(datetime(*args, tzinfo=CPH).timestamp())


HISTORY = [
    # two episodes of one show by the owner, a Monday evening
    {
        "type": "episode",
        "grandparentKey": "/library/metadata/10",
        "grandparentTitle": "Slow Horses",
        "accountID": 1,
        "viewedAt": at(2026, 9, 21, 21, 0),
    },
    {
        "type": "episode",
        "grandparentKey": "/library/metadata/10",
        "grandparentTitle": "Slow Horses",
        "accountID": 1,
        "viewedAt": at(2026, 9, 21, 22, 0),
    },
    # a movie by someone else, Saturday afternoon
    {
        "type": "movie",
        "key": "/library/metadata/20",
        "title": "Heat",
        "accountID": 7,
        "viewedAt": at(2026, 9, 19, 15, 30),
    },
    # a track, which is not TV or film
    {
        "type": "track",
        "key": "/library/metadata/30",
        "title": "Song",
        "accountID": 1,
        "viewedAt": at(2026, 9, 19, 9, 0),
    },
]
TITLES = {
    "10": {"duration": 45 * 60_000, "guids": ["tvdb:111", "imdb:tt1"]},
    "20": {"duration": 170 * 60_000, "guids": ["tmdb:949"]},
}


def stats(**over):
    args = {
        "history": HISTORY,
        "titles": TITLES,
        "accounts": {1: "owner", 7: ""},
        "movies": {"tmdb:949": {"id": 5, "images": []}},
        "series": {"tvdb:111": {"id": 9, "images": []}},
        "days": 30,
        "tz": "Europe/Copenhagen",
    }
    return build_stats(**{**args, **over})


def test_totals_count_only_film_and_tv_and_estimate_hours_from_runtimes():
    out = stats()
    assert (out["plays"], out["movies"], out["episodes"]) == (3, 1, 2)
    assert out["hours"] == round((2 * 45 + 170) / 60, 1)


def test_users_ranked_by_plays_with_a_fallback_name():
    users = stats()["users"]
    assert [u["name"] for u in users] == ["owner", "#7"]
    assert users[0]["plays"] == 2 and users[0]["hours"] == 1.5


def test_top_titles_link_to_the_arrs_through_their_guids():
    out = stats()
    assert out["top_shows"] == [
        {"title": "Slow Horses", "plays": 2, "hours": 1.5, "poster": None, "series_id": 9}
    ]
    assert out["top_movies"][0]["movie_id"] == 5
    unlinked = stats(movies={})["top_movies"][0]
    assert unlinked["movie_id"] is None and unlinked["title"] == "Heat"


def test_when_is_bucketed_in_the_asked_zone():
    out = stats()
    assert out["by_weekday"][0] == 2  # Monday
    assert out["by_weekday"][5] == 1  # Saturday
    assert out["by_hour"][21] == 1 and out["by_hour"][22] == 1 and out["by_hour"][15] == 1
    utc = stats(tz="UTC")
    assert utc["by_hour"][19] == 1  # 21:00 in Copenhagen is 19:00 UTC in September
    assert stats(tz="Not/AZone")["by_hour"] == utc["by_hour"]


def test_watchlist_marks_what_the_arrs_have_and_skips_what_they_cannot_add():
    from app.api.v1.watchstats import watchlist_rows

    items = [
        {
            "type": "movie",
            "title": "Heat",
            "year": 1995,
            "Guid": [{"id": "tmdb://949"}, {"id": "imdb://tt0113277"}],
            "thumb": "https://image.tmdb.org/t/p/original/x.jpg",
        },
        {"type": "show", "title": "Slow Horses", "Guid": [{"id": "tvdb://111"}]},
        {"type": "show", "title": "No ids", "Guid": []},
        {"type": "movie", "title": "Dune", "Guid": [{"id": "tmdb://438631"}]},
    ]
    rows = watchlist_rows(
        items,
        movies=[{"id": 5, "tmdbId": 949, "hasFile": True, "monitored": True}],
        series=[
            {"id": 9, "tvdbId": 111, "monitored": True, "statistics": {"percentOfEpisodes": 50}}
        ],
    )
    assert [r["title"] for r in rows] == ["Heat", "Slow Horses", "Dune"]
    heat, horses, dune = rows
    assert heat["kind"] == "movie" and heat["remote_id"] == 949 and heat["imdb_id"] == "tt0113277"
    assert heat["in_library"] and heat["library_id"] == 5 and heat["has_file"] is True
    assert heat["poster"] and "tmdb" in heat["poster"]
    assert horses["kind"] == "series" and horses["remote_id"] == 111 and horses["has_file"] is False
    assert not dune["in_library"] and dune["library_id"] is None and dune["has_file"] is None
