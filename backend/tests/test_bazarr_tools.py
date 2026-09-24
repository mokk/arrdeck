"""Bazarr language profiles in bulk and the full missing-subtitles list."""

from urllib.parse import parse_qs

import httpx
import pytest

from app.api.v1.subtitles import profile_row, title_row, wanted_episode, wanted_movie
from app.clients.bazarr import BazarrClient


def test_profile_row_keeps_language_order():
    row = profile_row(
        {"profileId": 2, "name": "Nordic", "items": [{"language": "da"}, {"language": "sv"}, {}]}
    )
    assert row == {"id": 2, "name": "Nordic", "languages": ["da", "sv"]}


def test_title_row_uses_the_arr_id_for_each_kind():
    movie = title_row("movie", {"radarrId": 7, "title": "Heat", "year": "1995", "profileId": 1})
    series = title_row("series", {"sonarrSeriesId": 9, "title": "Slow Horses", "profileId": None})
    assert movie == {"kind": "movie", "id": 7, "title": "Heat", "year": "1995", "profile_id": 1}
    assert series["id"] == 9 and series["profile_id"] is None and series["year"] is None


def test_wanted_rows():
    missing = [{"name": "Danish", "code2": "da"}]
    assert wanted_movie({"radarrId": 3, "title": "Heat", "missing_subtitles": missing})[
        "missing"
    ] == ["Danish"]
    ep = wanted_episode(
        {
            "sonarrEpisodeId": 11,
            "sonarrSeriesId": 4,
            "seriesTitle": "Monster",
            "episode_number": "4x8",
            "episodeTitle": "Carnival",
            "missing_subtitles": missing,
        }
    )
    assert ep["id"] == 11 and ep["series_id"] == 4 and ep["subtitle"] == "4x8 Carnival"


@pytest.mark.parametrize(
    ("kind", "key", "profile", "sent"),
    [("movies", "radarrid", 1, "1"), ("series", "seriesid", None, "")],
)
async def test_set_profile_pairs_every_id_with_the_profile(kind, key, profile, sent):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["form"] = parse_qs(request.content.decode(), keep_blank_values=True)
        return httpx.Response(204)

    client = BazarrClient(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)), "http://b", "k"
    )
    await client.set_profile(kind, [5, 6], profile)
    assert seen["path"] == f"/api/{kind}"
    assert seen["form"] == {key: ["5", "6"], "profileid": [sent, sent]}
