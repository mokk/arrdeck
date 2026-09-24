"""The calendar subscription: the arrs' events merged under one calendar."""

import httpx
import pytest
from fastapi import HTTPException

from app.clients.radarr import RadarrClient
from app.clients.readarr import ReadarrClient
from app.ical import check_token, events, merge, pick_apps

SONARR = (
    "BEGIN:VCALENDAR\r\nNAME:Sonarr TV Schedule\r\nVERSION:2.0\r\n"
    "BEGIN:VEVENT\r\nDESCRIPTION:A long line that the arr\r\n  folded onto the next\r\n"
    "SUMMARY:Slow Horses - 6x02\r\nUID:NzbDrone_episode_1\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nSUMMARY:Lanterns - 1x06\r\nUID:NzbDrone_episode_2\r\nEND:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


def test_events_keep_each_block_verbatim_with_its_folded_lines():
    blocks = events(SONARR)
    assert len(blocks) == 2
    assert blocks[0].startswith("BEGIN:VEVENT\r\nDESCRIPTION:A long line")
    assert "\r\n  folded onto the next\r\n" in blocks[0]
    assert blocks[1].endswith("END:VEVENT")
    assert events("BEGIN:VCALENDAR\nEND:VCALENDAR") == []


def test_merge_wraps_every_app_in_one_calendar():
    body = merge(events(SONARR) + events(SONARR.replace("episode_", "movie_")))
    assert body.startswith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")
    assert body.endswith("END:VCALENDAR\r\n")
    assert body.count("BEGIN:VEVENT") == 4
    assert "X-WR-CALNAME:arrdeck" in body
    assert "Sonarr TV Schedule" not in body  # the arrs' own headers are dropped


def test_pick_apps_limits_to_configured_and_keeps_a_stable_order():
    configured = {"radarr", "sonarr"}
    assert pick_apps(None, configured) == ["radarr", "sonarr"]
    assert pick_apps("sonarr, readarr", configured) == ["sonarr"]
    assert pick_apps("sonarr,radarr", configured) == ["radarr", "sonarr"]
    assert pick_apps("nzbget", configured) == []


def test_ical_token_is_checked_and_a_disabled_feed_is_a_404():
    class DB(dict):
        def kv_get(self, key):
            return self.get(key)

    class Req:
        class app:
            class state:
                db = DB()

    Req.app.state.db["ical.token"] = "secret"
    check_token(Req, "secret")
    with pytest.raises(HTTPException):
        check_token(Req, "wrong")
    Req.app.state.db["ical.token"] = ""
    with pytest.raises(HTTPException):
        check_token(Req, "")


@pytest.mark.parametrize(
    ("cls", "path"),
    [
        (RadarrClient, "/feed/v3/calendar/radarr.ics"),
        (ReadarrClient, "/feed/v1/calendar/readarr.ics"),
    ],
)
async def test_calendar_feed_sits_beside_the_api_and_sends_the_key_as_a_header(cls, path):
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url
        seen["key"] = request.headers.get("x-api-key")
        return httpx.Response(200, text=SONARR)

    client = cls(httpx.AsyncClient(transport=httpx.MockTransport(handler)), "http://arr:1/", "k")
    assert await client.calendar_feed(14, 90) == SONARR
    assert seen["url"].path == path
    assert seen["url"].params["pastDays"] == "14" and seen["url"].params["futureDays"] == "90"
    assert "apikey" not in str(seen["url"]) and seen["key"] == "k"
