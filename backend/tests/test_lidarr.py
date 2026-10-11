"""Lidarr, Readarr's cousin: artists and albums on /api/v1.

The fixtures are trimmed from what Lidarr 3.1 answered for real: a tagged
album folder it matched on its own, and a folder of untagged files it could
not place until an album was picked for them.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.importing import _describe_all, _describe_candidate, _import_file
from app.clients.base import ServiceUnavailable

QUALITY = {
    "quality": {"id": 29, "name": "MP3-32"},
    "revision": {"version": 1, "real": 0, "isRepack": False},
}
FOLDER = "/downloads/Boards of Canada - Music Has the Right to Children (1998) [MP3]"

# as Lidarr returns a file it placed itself
MATCHED = {
    "path": f"{FOLDER}/01 - Wildlife Analysis.mp3",
    "name": "01 - Wildlife Analysis",
    "size": 301691,
    "artist": {"id": 1, "artistName": "Boards of Canada"},
    "album": {"id": 3, "title": "Music Has the Right to Children"},
    "albumReleaseId": 15,
    "tracks": [
        {
            "id": 268,
            "trackNumber": "1",
            "absoluteTrackNumber": 1,
            "title": "Wildlife Analysis",
            "mediumNumber": 1,
        }
    ],
    "quality": QUALITY,
    "indexerFlags": 0,
    "rejections": [],
    "disableReleaseSwitching": False,
    "id": 931058932,
}

# and one it could not place
UNPLACED = {
    "path": "/downloads/unsorted rip/side a 1.mp3",
    "name": "side a 1",
    "size": 234832,
    "artist": None,
    "album": None,
    "albumReleaseId": 0,
    "tracks": [],
    "quality": QUALITY,
    "indexerFlags": 0,
    "rejections": [
        {"reason": "Couldn't find similar album for [/downloads/unsorted rip]", "type": "permanent"}
    ],
    "id": 584212639,
}


# --- the compatibility constraint --------------------------------------------


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings

    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    # a fresh database seeds itself from these; empty keeps every service
    # unconfigured and the test off the network
    for name in (
        "RADARR_URL",
        "SONARR_URL",
        "PROWLARR_URL",
        "QBIT_URL",
        "TRANSMISSION_URL",
        "OVERSEERR_URL",
        "GLUETUN_URL",
        "BAZARR_URL",
        "PLEX_URL",
        "PROMETHEUS_URL",
    ):
        monkeypatch.setenv(name, "")
    get_settings.cache_clear()
    import app.main as main

    with TestClient(main.app, headers={"host": "localhost"}) as c:
        yield c
    get_settings.cache_clear()


PER_APP = ["/api/v1/queue", "/api/v1/calendar", "/api/v1/history"]


def test_an_unconfigured_lidarr_is_in_no_list_a_client_renders(client):
    # installed iOS builds decode these names as a fixed set without lidarr
    assert "lidarr" not in [s["service"] for s in client.get("/api/v1/services").json()]
    assert "lidarr" not in [s["service"] for s in client.get("/api/v1/status").json()]
    for path in PER_APP:
        body = client.get(path).json()
        # absent, not null: the answer is the one it was before Lidarr existed
        assert "lidarr" not in body, path
        assert body["readarr"] is None
    attention = client.get("/api/v1/queue/attention").json()
    assert all(i["app"] != "lidarr" for i in attention["items"])
    assert "lidarr" not in attention["unavailable"]
    assert client.get("/api/v1/ical/settings").json()["apps"] == []


def test_connections_still_offers_an_unconfigured_lidarr(client):
    # keyed by name, not a list of names: safe for every client
    settings = client.get("/api/v1/settings/services").json()
    assert settings["lidarr"]["configured"] is False


def test_a_configured_lidarr_is_listed_everywhere(client):
    saved = client.put(
        "/api/v1/settings/services/lidarr",
        # nothing listens on the discard port: configured, but unreachable
        json={"url": "http://127.0.0.1:9", "api_key": "test"},
    ).json()
    assert saved == {"service": "lidarr", "configured": True}
    services = {s["service"]: s for s in client.get("/api/v1/services").json()}
    assert services["lidarr"]["configured"] is True
    assert services["lidarr"]["web_url"] == "http://127.0.0.1:9"
    status = {s["service"]: s for s in client.get("/api/v1/status").json()}
    assert status["lidarr"]["ok"] is False
    for path in PER_APP:
        assert client.get(path).json()["lidarr"]["ok"] is False, path
    attention = client.get("/api/v1/queue/attention").json()
    assert attention["unavailable"] == ["lidarr"]


def test_the_listing_rule():
    from app.db import INFRASTRUCTURE, LISTED_WHEN_CONFIGURED, SERVICES, listed

    assert "lidarr" in SERVICES and "lidarr" in LISTED_WHEN_CONFIGURED
    assert not listed("lidarr", False) and listed("lidarr", True)
    assert listed("radarr", False) and listed("readarr", False)
    assert all(not listed(name, True) for name in INFRASTRUCTURE)


def test_a_helper_project_named_lidarr_is_only_a_service_once_lidarr_is_configured():
    from app.api.v1.system import restartable

    class Helper:
        async def projects(self):
            return [{"name": "lidarr", "running": True}, {"name": "radarr", "running": True}]

    def request(configured):
        registry = SimpleNamespace(
            is_configured=lambda name: name == "helper" or name in configured,
            get=lambda name: Helper(),
        )
        return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(registry=registry)))

    rows = asyncio.run(restartable(request(set())))["projects"]
    assert [(p["name"], p["service"]) for p in rows] == [("lidarr", None), ("radarr", "radarr")]
    rows = asyncio.run(restartable(request({"lidarr"})))["projects"]
    assert rows[0]["service"] == "lidarr"


# --- manual import ------------------------------------------------------------


def test_a_matched_track_mirrors_lidarrs_manual_import_file():
    assert _import_file("lidarr", MATCHED, "HASH") == {
        "path": MATCHED["path"],
        "quality": QUALITY,
        "indexerFlags": 0,
        "disableReleaseSwitching": False,
        "downloadId": "HASH",
        "artistId": 1,
        "albumId": 3,
        "albumReleaseId": 15,
        "trackIds": [268],
    }


def test_a_file_without_tracks_is_not_placed():
    assert _import_file("lidarr", UNPLACED) is None
    stub = {**MATCHED, "tracks": []}
    assert _import_file("lidarr", stub) is None
    assert _import_file("lidarr", {**MATCHED, "albumReleaseId": 0}) is None


def test_a_track_reads_as_album_artist_and_track():
    described = _describe_candidate("lidarr", MATCHED)
    assert described["title"] == "Music Has the Right to Children"
    assert described["subtitle"] == "Boards of Canada · 1. Wildlife Analysis"
    assert described["importable"] is True and described["language_ids"] == []
    two = {**MATCHED, "tracks": [*MATCHED["tracks"], {"id": 269, "title": "An Eagle"}]}
    assert _describe_candidate("lidarr", two)["subtitle"].endswith("+1")
    lost = _describe_candidate("lidarr", UNPLACED)
    assert (lost["title"], lost["subtitle"], lost["importable"]) == ("", None, False)


def test_an_album_lists_in_track_order():
    second = {**MATCHED, "path": f"{FOLDER}/02 - An Eagle in Your Mind.mp3"}
    paths = [c["path"] for c in _describe_all("lidarr", [second, MATCHED])]
    assert paths == [MATCHED["path"], second["path"]]


class FakeLidarr:
    """Answers the way Lidarr 3.1 did: a re-match puts each file on a track of
    the album's release, by duration when the files carry no tags."""

    def __init__(self, candidates, tracks=None):
        self.candidates = candidates
        self.tracks = tracks if tracks is not None else {UNPLACED["path"]: [{"id": 69}]}
        self.commands = []
        self.reprocessed = []

    async def queue(self):
        return {"records": [{"id": 1, "downloadId": "abc", "albumId": 1}]}

    async def manual_import(self, download_id):
        return self.candidates

    async def manual_import_folder(self, folder):
        return self.candidates

    async def get_album(self, album_id):
        return {
            "id": album_id,
            "title": "Geogaddi",
            "artistId": 1,
            "releases": [{"id": 3, "monitored": False}, {"id": 4, "monitored": True}],
        }

    async def manual_import_reprocess(self, items):
        self.reprocessed.append(items)
        return [
            {
                **item,
                "artist": {"id": item["artistId"]},
                "album": {"id": item["albumId"], "title": "Geogaddi"},
                "tracks": self.tracks.get(item["path"], []),
                "rejections": [{"reason": "Has missing tracks", "type": "permanent"}],
            }
            for item in items
        ]

    async def quality_definitions(self):
        return [{"quality": QUALITY["quality"]}, {"quality": {"id": 30, "name": "MP3-24"}}]

    async def languages(self):
        raise AssertionError("Lidarr's files have no language to set")

    async def command(self, payload):
        self.commands.append(payload)
        return {"id": 40, "name": "ManualImport", "status": "queued"}

    async def delete_queue_item(self, item_id, remove_from_client, blocklist):
        self.deleted = (item_id, remove_from_client, blocklist)


def _assign(files, candidates):
    from app.api.v1.importing import manual_import_assign
    from app.schemas import ManualImportAssignIn

    lidarr = FakeLidarr(candidates)
    out = asyncio.run(
        manual_import_assign(
            "lidarr", ManualImportAssignIn(item_id=1, files=files), None, None, None, lidarr
        )
    )
    return lidarr, out


def test_a_picked_album_is_matched_to_tracks_by_lidarr():
    from app.cache import cache

    cache.clear()
    lidarr, out = _assign([{"path": UNPLACED["path"], "album_id": 1}], [UNPLACED])
    # Lidarr is asked to re-match against the monitored release
    asked = lidarr.reprocessed[0][0]
    assert (asked["artistId"], asked["albumId"], asked["albumReleaseId"]) == (1, 1, 4)
    assert asked["downloadId"] == "abc" and asked["id"] == UNPLACED["id"]
    file = lidarr.commands[0]["files"][0]
    assert (file["artistId"], file["albumId"], file["albumReleaseId"], file["trackIds"]) == (
        1,
        1,
        4,
        [69],
    )
    assert file["downloadId"] == "abc" and file["quality"] == QUALITY
    assert "languages" not in file and "releaseGroup" not in file
    assert lidarr.commands[0]["importMode"] == "auto"
    assert out["app"] == "lidarr"


def test_files_picked_for_one_album_are_matched_together():
    second = {**UNPLACED, "path": "/downloads/unsorted rip/side a 2.mp3", "id": 2}
    lidarr = FakeLidarr(
        [UNPLACED, second], {UNPLACED["path"]: [{"id": 69}], second["path"]: [{"id": 70}]}
    )
    from app.api.v1.importing import manual_import_assign
    from app.schemas import ManualImportAssignIn

    body = ManualImportAssignIn(
        item_id=1,
        files=[
            {"path": UNPLACED["path"], "album_id": 1},
            {"path": second["path"], "album_id": 1},
        ],
    )
    asyncio.run(manual_import_assign("lidarr", body, None, None, None, lidarr))
    assert len(lidarr.reprocessed) == 1 and len(lidarr.reprocessed[0]) == 2
    assert [f["trackIds"] for f in lidarr.commands[0]["files"]] == [[69], [70]]


def test_a_file_lidarr_cannot_fit_on_the_album_is_refused():
    lidarr = FakeLidarr([UNPLACED], tracks={})
    from app.api.v1.importing import manual_import_assign
    from app.schemas import ManualImportAssignIn

    body = ManualImportAssignIn(item_id=1, files=[{"path": UNPLACED["path"], "album_id": 1}])
    with pytest.raises(HTTPException) as exc:
        asyncio.run(manual_import_assign("lidarr", body, None, None, None, lidarr))
    assert exc.value.status_code == 409
    assert lidarr.commands == []


def test_an_unplaced_track_needs_an_album():
    with pytest.raises(HTTPException) as exc:
        _assign([{"path": UNPLACED["path"]}], [UNPLACED])
    assert exc.value.status_code == 422


def test_a_matched_file_keeps_lidarrs_own_match_beside_a_picked_one():
    lidarr, _ = _assign(
        [{"path": MATCHED["path"]}, {"path": UNPLACED["path"], "album_id": 1}],
        [MATCHED, UNPLACED],
    )
    files = lidarr.commands[0]["files"]
    assert (files[0]["albumId"], files[0]["trackIds"]) == (3, [268])
    assert (files[1]["albumId"], files[1]["trackIds"]) == (1, [69])
    # only the picked file went back to Lidarr
    assert [i["path"] for i in lidarr.reprocessed[0]] == [UNPLACED["path"]]


def test_lidarr_offers_qualities_but_no_languages():
    from app.api.v1.importing import manual_import_options
    from app.cache import cache

    cache.clear()
    out = asyncio.run(manual_import_options("lidarr", None, None, None, FakeLidarr([])))
    assert out["languages"] == [] and [q["name"] for q in out["qualities"]] == [
        "MP3-32",
        "MP3-24",
    ]


def test_force_import_works_for_albums():
    from app.api.v1.importing import force_import

    lidarr = FakeLidarr([MATCHED, UNPLACED])
    asyncio.run(force_import("lidarr", 1, None, None, None, lidarr))
    files = lidarr.commands[0]["files"]
    assert [f["trackIds"] for f in files] == [[268]]
    assert files[0]["downloadId"] == "abc"


def test_a_finished_torrent_imports_into_lidarr_as_a_copy():
    from app.api.v1.importing import torrent_import
    from app.schemas import TorrentImportIn

    class Qbit:
        async def torrents(self, hashes=None):
            return [
                {
                    "hash": "a" * 40,
                    "progress": 1,
                    "save_path": "/downloads",
                    "root_path": FOLDER,
                    "name": FOLDER.rsplit("/", 1)[-1],
                }
            ]

    class Idle:
        async def queue(self):
            return {"records": []}

    lidarr = FakeLidarr([MATCHED])
    body = TorrentImportIn(
        client="qbittorrent", torrent_id="a" * 40, files=[{"path": MATCHED["path"]}]
    )
    out = asyncio.run(torrent_import("lidarr", body, Idle(), Idle(), Idle(), Qbit(), None, lidarr))
    command = lidarr.commands[0]
    assert command["importMode"] == "copy"  # auto would move the files off the torrent
    assert "downloadId" not in command["files"][0]
    assert out["app"] == "lidarr"


# --- the queue ------------------------------------------------------------------


def test_a_queue_item_reads_as_artist_and_album():
    from app.api.v1.dashboard import _queue_items

    rec = {
        "id": 5,
        "title": "Boards.of.Canada-Geogaddi-WEB-2002",
        "status": "completed",
        "trackedDownloadState": "importBlocked",
        "trackedDownloadStatus": "warning",
        "albumId": 1,
        "artist": {"artistName": "Boards of Canada"},
        "album": {"title": "Geogaddi"},
        "statusMessages": [{"title": "01.flac", "messages": ["Has missing tracks"]}],
    }
    item = _queue_items("lidarr", {"records": [rec]})[0]
    assert item.app == "lidarr" and item.title == "Boards of Canada — Geogaddi"
    assert item.needs_attention is True and item.errors == ["Has missing tracks"]


def test_needs_attention_includes_lidarr_once_configured():
    from app.api.v1.dashboard import queue_attention

    class Arr:
        def __init__(self, records, down=False):
            self.records, self.down = records, down

        async def queue(self):
            if self.down:
                raise ServiceUnavailable("lidarr", "connection refused")
            return {"records": self.records}

    def request(*configured):
        registry = SimpleNamespace(is_configured=lambda name: name in configured)
        return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(registry=registry)))

    stuck = {"id": 7, "title": "x", "trackedDownloadState": "importBlocked"}
    out = asyncio.run(
        queue_attention(request("radarr", "lidarr"), Arr([]), Arr([]), Arr([]), Arr([stuck]))
    )
    assert [(i.app, i.id) for i in out["items"]] == [("lidarr", 7)]
    out = asyncio.run(queue_attention(request("radarr"), Arr([]), Arr([]), Arr([]), Arr([stuck])))
    assert out["items"] == []


def test_blocklist_and_retry_searches_the_album_again():
    from app.api.v1.arrqueue import blocklist_retry

    lidarr = FakeLidarr([])
    asyncio.run(blocklist_retry("lidarr", 1, None, None, None, lidarr))
    assert lidarr.deleted == (1, True, True)
    assert lidarr.commands == [{"name": "AlbumSearch", "albumIds": [1]}]


def test_wanted_searches_use_lidarrs_album_commands():
    from app.api.v1.library import trigger_search
    from app.api.v1.wanted import wanted_search_all

    lidarr = FakeLidarr([])
    asyncio.run(trigger_search("lidarr", 5, None, None, None, lidarr))
    asyncio.run(wanted_search_all("lidarr", "missing", None, None, None, lidarr))
    asyncio.run(wanted_search_all("lidarr", "cutoff", None, None, None, lidarr))
    assert [c["name"] for c in lidarr.commands] == [
        "AlbumSearch",
        "MissingAlbumSearch",
        "CutoffUnmetAlbumSearch",
    ]
    assert lidarr.commands[0]["albumIds"] == [5]


# --- history, activity and pushes ----------------------------------------------

TRACK_IMPORTS = [
    {
        "eventType": "trackFileImported",
        "albumId": 3,
        "sourceTitle": f"{n:02d} - Track",
        "date": "2026-10-11T06:06:51Z",
        "album": {"title": "Music Has the Right to Children"},
        "artist": {"artistName": "Boards of Canada"},
        "quality": {"quality": {"name": "MP3-32"}},
    }
    for n in range(1, 19)
]


def test_an_album_import_is_one_row_of_history_not_one_per_track():
    from app.api.v1.dashboard import _consolidate_history

    rows = _consolidate_history("lidarr", {"records": TRACK_IMPORTS})
    assert len(rows) == 1
    assert rows[0]["title"] == "Boards of Canada — Music Has the Right to Children"
    assert [e["type"] for e in rows[0]["events"]] == ["imported"]


def test_an_album_import_is_one_new_thing_in_activity():
    from datetime import UTC, datetime

    from app.api.v1.activity import history_events

    since = datetime(2026, 10, 1, tzinfo=UTC)
    out = history_events("lidarr", TRACK_IMPORTS, since)
    assert len(out) == 1 and out[0]["title"].startswith("Boards of Canada")


def test_lidarr_pushes_once_per_download_not_per_track():
    from app.push.sources import history_event

    rec = {**TRACK_IMPORTS[0], "artist": {"artistName": "Boards of Canada", "tags": [2]}}
    assert history_event("lidarr", rec) is None
    for raw, key in (("downloadImported", "imported"), ("grabbed", "grabbed")):
        event = history_event("lidarr", {**rec, "eventType": raw})
        assert event.key == key and event.app == "lidarr"
        assert event.title == "Boards of Canada – Music Has the Right to Children"
        assert event.group == f"lidarr:{key}:3" and event.tags == [2]
    failed = history_event("lidarr", {**rec, "eventType": "downloadFailed"})
    assert failed.key == "failed"


def test_the_digest_counts_albums_and_only_mentions_lidarr_when_it_is_there():
    from app.push.digest import digest_note, summarise

    without = summarise({"radarr": [{"eventType": "downloadFolderImported"}]}, {})
    assert not any(k.startswith("lidarr") for k in without)
    params = summarise({"lidarr": TRACK_IMPORTS}, {"lidarr": [{"title": "Inferno"}]})
    assert params["lidarr_imported"] == 1 and params["lidarr_upcoming"] == 1
    assert params["titles"] == ["Inferno"]
    assert digest_note(params).body == "1 album downloaded · 1 album coming up"


def test_the_calendar_feed_includes_lidarr():
    from app.ical import APPS, pick_apps

    assert "lidarr" in APPS
    assert pick_apps(None, {"radarr"}) == ["radarr"]
    assert pick_apps("lidarr", {"radarr", "lidarr"}) == ["lidarr"]


# --- picking an album -------------------------------------------------------------


def test_artists_and_their_albums_for_the_picker():
    from app.api.v1.music import artist_albums, library_artists
    from app.cache import cache

    class Lidarr:
        async def artists(self):
            return [
                {
                    "id": 1,
                    "artistName": "Boards of Canada",
                    "sortName": "boards canada",
                    "monitored": True,
                    "statistics": {"albumCount": 5, "trackFileCount": 21},
                    # Lidarr reports its own copies as container paths
                    "images": [{"coverType": "poster", "remoteUrl": "/config/MediaCover/1/p.jpg"}],
                },
                {"id": 2, "artistName": "Autechre", "sortName": "autechre"},
            ]

        async def albums(self, artist_id):
            return [
                {
                    "id": 3,
                    "title": "Music Has the Right to Children",
                    "artistId": 1,
                    "releaseDate": "1998-04-20T00:00:00Z",
                    "albumType": "Album",
                    "monitored": True,
                    "statistics": {"totalTrackCount": 18, "trackFileCount": 18},
                    "images": [
                        {
                            "coverType": "cover",
                            "remoteUrl": "https://images.lidarr.audio/cache/x.jpg",
                        }
                    ],
                },
                {"id": 5, "title": "Inferno", "artistId": 1, "releaseDate": "2026-05-28T00:00:00Z"},
            ]

    cache.clear()
    artists = asyncio.run(library_artists(Lidarr()))
    assert [a["name"] for a in artists] == ["Autechre", "Boards of Canada"]
    assert artists[1]["album_count"] == 5
    # Lidarr's own copy, which only arrdeck can fetch: it has the key
    assert artists[1]["poster"] == "/api/v1/library/artists/1/image/poster-250.jpg"
    assert artists[0]["poster"] is None
    albums = asyncio.run(artist_albums(1, Lidarr()))
    assert [a["title"] for a in albums] == ["Inferno", "Music Has the Right to Children"]
    assert albums[1]["year"] == 1998 and albums[1]["track_count"] == 18
    assert albums[1]["poster"].startswith("/api/v1/poster?u=")
    json.dumps(albums)  # plain data, ready for the response model
