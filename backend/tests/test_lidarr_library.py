"""Lidarr's library: the Music tab, the artist and album pages, adding music,
and the places a Lidarr row now leads somewhere.

Shapes are trimmed from what Lidarr 3.1 answered for real.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.cache import cache
from app.schemas import (
    ActivityEventOut,
    AddAlbumIn,
    AddArtistIn,
    ArtistUpdateIn,
    HistoryItemOut,
    LibraryUpdateIn,
    QueueItemOut,
    SearchResultOut,
)

ARTIST = {
    "id": 1,
    "artistName": "Boards of Canada",
    "sortName": "boards canada",
    "foreignArtistId": "69158f97-4c07-4c4e-baf8-4e4ab1ed666e",
    "monitored": True,
    "monitorNewItems": "all",
    "qualityProfileId": 1,
    "metadataProfileId": 1,
    "path": "/music/Boards of Canada",
    "rootFolderPath": "/music",
    "added": "2026-10-11T05:48:00Z",
    "genres": ["Idm", "Ambient"],
    "tags": [],
    "ratings": {"votes": 16, "value": 9.6},
    "statistics": {
        "albumCount": 5,
        "trackFileCount": 21,
        "totalTrackCount": 94,
        "sizeOnDisk": 18652867,
    },
    # Lidarr's own copies: container paths, versioned by lastWrite
    "images": [
        {
            "url": "/MediaCover/1/poster.jpg?lastWrite=639272944815209895",
            "coverType": "poster",
            "remoteUrl": "/config/MediaCover/1/poster.jpg",
        },
        {
            "url": "/MediaCover/1/fanart.jpg?lastWrite=639272944817131323",
            "coverType": "fanart",
            "remoteUrl": "/config/MediaCover/1/fanart.jpg",
        },
    ],
    "links": [
        {"url": "https://music.apple.com/us/artist/2989314", "name": "apple"},
        {"url": "https://music.apple.com/gb/artist/2989314", "name": "apple"},
        {"url": "https://www.discogs.com/artist/307", "name": "discogs"},
    ],
}

COVER = "https://images.lidarr.audio/cache/https://coverartarchive.org/release/x/1-1200.jpg"

ALBUM = {
    "id": 1,
    "title": "Geogaddi",
    "artistId": 1,
    "foreignAlbumId": "8183834a-6c8a-39ef-a7bc-a82f79b929e9",
    "monitored": True,
    "albumType": "Album",
    "secondaryTypes": [],
    "releaseDate": "2002-02-13T00:00:00Z",
    "duration": 4091592,
    "ratings": {"votes": 25, "value": 9.2},
    "genres": ["Idm"],
    "images": [{"coverType": "cover", "remoteUrl": COVER}],
    "statistics": {"trackFileCount": 2, "totalTrackCount": 3, "sizeOnDisk": 1664416},
    "artist": {**ARTIST, "images": []},
    "releases": [
        {"id": 1, "format": '3x12" Vinyl', "label": ["Warp"], "monitored": False, "media": []},
        {
            "id": 4,
            "format": "CD",
            "label": ["Warp", "Music70"],
            "monitored": True,
            "media": [{"mediumNumber": 1, "mediumName": "", "mediumFormat": "CD"}],
        },
    ],
}

TRACKS = [
    {"id": 71, "absoluteTrackNumber": 3, "trackNumber": "3", "mediumNumber": 1,
     "title": "Beware the Friendly Stranger", "duration": 38000, "hasFile": False,
     "trackFileId": 0},
    {"id": 69, "absoluteTrackNumber": 1, "trackNumber": "1", "mediumNumber": 1,
     "title": "Ready Lets Go", "duration": 59000, "hasFile": True, "trackFileId": 1},
    {"id": 70, "absoluteTrackNumber": 2, "trackNumber": "2", "mediumNumber": 1,
     "title": "Music Is Math", "duration": 321000, "hasFile": True, "trackFileId": 2},
]  # fmt: skip

FILES = [
    {"id": 1, "albumId": 1, "size": 234832, "quality": {"quality": {"name": "MP3-320"}}},
    {"id": 2, "albumId": 1, "size": 1279824, "quality": {"quality": {"name": "FLAC"}}},
]

# what Lidarr records when an album is imported by hand: a row per track
HISTORY = [
    {"eventType": "trackFileImported", "date": "2026-10-11T06:06:31Z", "albumId": 1},
    {"eventType": "trackFileImported", "date": "2026-10-11T06:06:31Z", "albumId": 1},
    {"eventType": "trackFileImported", "date": "2026-10-11T06:06:32Z", "albumId": 1},
    {"eventType": "grabbed", "date": "2026-10-10T20:00:00Z", "downloadId": "ABC"},
]


class FakeLidarr:
    base_url = "http://lidarr"

    def __init__(self):
        self.updated = None
        self.monitored = []
        self.deleted_files = []
        self.commands = []
        self.added = None
        self.search_results = []
        self.lookup = []

    async def artists(self):
        return [ARTIST]

    async def get_artist(self, artist_id):
        return json.loads(json.dumps(ARTIST))

    async def albums(self, artist_id=None):
        return [ALBUM]

    async def get_album(self, album_id):
        return json.loads(json.dumps(ALBUM))

    async def tracks(self, album_id):
        return TRACKS

    async def track_files(self, album_id):
        return FILES

    async def history_album(self, album_id):
        return HISTORY

    async def update_artist(self, artist_id, payload, move_files=False):
        self.updated = (payload, move_files)
        return payload

    async def monitor_albums(self, ids, monitored):
        self.monitored.append((ids, monitored))

    async def delete_track_files(self, ids):
        self.deleted_files.append(ids)

    async def command(self, payload):
        self.commands.append(payload)

    async def search(self, term):
        return self.search_results

    async def lookup_album(self, term):
        return self.lookup

    async def lookup_artist(self, term):
        return self.lookup

    async def metadata_profiles(self):
        return [{"id": 1, "name": "Standard"}, {"id": 2, "name": "None"}]

    async def add_album(self, payload):
        self.added = payload
        return {"id": 9, "title": payload["title"]}

    async def add_artist(self, payload):
        self.added = payload
        return {"id": 3, "artistName": payload["artistName"]}


@pytest.fixture(autouse=True)
def fresh_cache():
    cache.clear()
    yield
    cache.clear()


# --- compatibility -----------------------------------------------------------


def test_the_new_ids_never_appear_on_another_arrs_rows():
    # installed iOS builds see exactly the rows they saw before
    radarr = HistoryItemOut(app="radarr", title="x", date="d", movie_id=1).model_dump()
    assert "album_id" not in radarr
    assert "album_id" in HistoryItemOut(app="lidarr", title="x", date="d", album_id=3).model_dump()
    event = ActivityEventOut(kind="imported", app="sonarr", title="x", date="d").model_dump()
    assert "album_id" not in event
    queued = QueueItemOut(app="radarr", id=1, title="x", status="s", size=0, size_left=0)
    assert not {"album_id", "artist_id"} & set(queued.model_dump())
    movie = SearchResultOut(kind="movie", title="x", remote_id=1).model_dump()
    assert not {"artist", "album_type"} & set(movie)


@pytest.fixture
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.config import get_settings

    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
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


def test_merged_lists_answer_as_before_without_lidarr(client):
    # nothing is configured, so every list is as empty as it always was
    assert client.get("/api/v1/blocklist").json() == {"items": [], "total": 0}
    assert client.get("/api/v1/import-lists").json() == []
    assert client.get("/api/v1/exclusions").json() == []
    assert client.get("/api/v1/dashboard/recent").json() == []
    assert client.get("/api/v1/prefs").json() == {"values": {}, "updated_at": 0}


def _request(*configured):
    registry = SimpleNamespace(is_configured=lambda name: name in configured)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(registry=registry)))


class Listing:
    def __init__(self, name):
        self.name = name

    async def blocklist(self, page):
        return {
            "totalRecords": 1,
            "records": [{"id": 1, "date": "2026-10-0" + str(len(self.name))}],
        }

    async def import_lists(self):
        return [{"id": 2, "name": f"{self.name} list", "enabled": True}]


def test_blocklist_and_import_lists_ask_lidarr_only_once_configured():
    from app.api.v1.arrmeta import blocklist, import_lists

    arrs = Listing("radarr"), Listing("sonarr"), Listing("lidarr")
    out = asyncio.run(blocklist(_request(), 1, *arrs))
    assert sorted(i["app"] for i in out["items"]) == ["radarr", "sonarr"]
    out = asyncio.run(blocklist(_request("lidarr"), 1, *arrs))
    assert sorted(i["app"] for i in out["items"]) == ["lidarr", "radarr", "sonarr"]
    assert out["total"] == 3
    assert [i["app"] for i in asyncio.run(import_lists(_request(), *arrs))] == ["radarr", "sonarr"]
    assert "lidarr" in [i["app"] for i in asyncio.run(import_lists(_request("lidarr"), *arrs))]


def test_recently_added_includes_albums_once_lidarr_is_configured():
    from app.api.v1.dashboard import recent

    class Down:
        async def movies(self):
            raise RuntimeError

        series = books = movies

    class Lidarr:
        async def history(self, page_size):
            rec = {
                "eventType": "trackFileImported",
                "date": "2026-10-11T06:06:51Z",
                "album": {"id": 3, "title": "Music Has the Right to Children",
                          "images": [{"coverType": "cover", "remoteUrl": COVER}]},
                "artist": {"artistName": "Boards of Canada"},
            }  # fmt: skip
            return {"records": [rec, {**rec, "date": "2026-10-11T06:06:50Z"}]}

    assert asyncio.run(recent(_request(), Down(), Down(), Down(), Lidarr())) == []
    rows = asyncio.run(recent(_request("lidarr"), Down(), Down(), Down(), Lidarr()))
    assert len(rows) == 1  # one album, not one row per track
    assert rows[0]["app"] == "lidarr" and rows[0]["library_id"] == 3
    assert rows[0]["subtitle"] == "Boards of Canada"
    assert rows[0]["poster"].startswith("/api/v1/poster?u=")


# --- the Music tab and the artist page ---------------------------------------


def test_an_artist_card_carries_what_the_tab_sorts_and_filters_on():
    from app.api.v1.music import library_artists

    (row,) = asyncio.run(library_artists(FakeLidarr()))
    assert row["poster"] == "/api/v1/library/artists/1/image/poster-250.jpg?v=639272944815209895"
    assert (row["size_on_disk"], row["track_count"], row["track_file_count"]) == (18652867, 94, 21)
    assert row["added"] == "2026-10-11T05:48:00Z" and row["rating"] == 9.6
    assert row["slug"] == ARTIST["foreignArtistId"]


def test_a_score_without_votes_is_no_score():
    from app.api.v1.music import rating_of, ratings_of

    assert rating_of({"ratings": {"votes": 0, "value": 0}}) is None
    assert ratings_of({"ratings": {"votes": 25, "value": 9.2}})[0].source == "musicbrainz"


def test_the_artist_page_has_every_album_and_one_link_per_site():
    from app.api.v1.music import artist_detail

    out = asyncio.run(artist_detail(1, FakeLidarr()))
    assert out["poster"].startswith("/api/v1/library/artists/1/image/poster-500.jpg")
    assert out["fanart"] == "/api/v1/library/artists/1/image/fanart.jpg?v=639272944817131323"
    assert [link["name"] for link in out["links"]] == ["apple", "discogs"]
    assert out["albums"][0]["title"] == "Geogaddi" and out["albums"][0]["album_type"] == "Album"
    assert out["albums"][0]["artist"] == "Boards of Canada"


def test_editing_an_artist_sends_the_whole_artist_back():
    from app.api.v1.music import update_artist

    lidarr = FakeLidarr()
    body = ArtistUpdateIn(
        monitored=False, quality_profile_id=3, tags=[2], path="/music/BoC", move_files=True
    )
    asyncio.run(update_artist(1, body, lidarr))
    payload, move = lidarr.updated
    assert payload["monitored"] is False and payload["qualityProfileId"] == 3
    assert payload["tags"] == [2] and payload["path"] == "/music/BoC" and move is True
    # untouched fields go back as they were
    assert payload["metadataProfileId"] == 1 and payload["artistName"] == "Boards of Canada"
    with pytest.raises(HTTPException):
        asyncio.run(update_artist(1, ArtistUpdateIn(path="relative"), lidarr))


def test_artwork_names_are_lidarrs_own_and_nothing_else():
    from app.api.v1.music import IMAGE_NAME

    assert IMAGE_NAME.match("poster-250.jpg") and IMAGE_NAME.match("fanart.jpg")
    assert not IMAGE_NAME.match("../config.xml") and not IMAGE_NAME.match("poster.png")


# --- the album page ----------------------------------------------------------


def test_an_album_lists_its_tracks_in_order_with_their_files():
    from app.api.v1.music import album_detail

    out = asyncio.run(album_detail(1, FakeLidarr()))
    assert [t["title"] for t in out["tracks"]] == [
        "Ready Lets Go",
        "Music Is Math",
        "Beware the Friendly Stranger",
    ]
    first, _, last = out["tracks"]
    assert (first["file_id"], first["quality"], first["size"], first["duration"]) == (
        1,
        "MP3-320",
        234832,
        59,
    )
    assert last["has_file"] is False and last["file_id"] is None
    # the release Lidarr matches against, not the first one listed
    assert out["release"] == "CD · Warp, Music70" and out["media"][0]["format"] == "CD"
    assert out["quality_profile_id"] == 1 and out["duration"] == 4092
    # a row per track collapses to one import
    assert [h.type for h in out["history"]] == ["imported", "fetched"]


def test_an_albums_monitoring_is_its_own_and_its_profile_is_the_artists():
    from app.api.v1.music import update_album

    lidarr = FakeLidarr()
    asyncio.run(update_album(1, LibraryUpdateIn(monitored=False), lidarr))
    assert lidarr.monitored == [([1], False)]
    with pytest.raises(HTTPException):
        asyncio.run(update_album(1, LibraryUpdateIn(quality_profile_id=2), lidarr))


def test_only_a_file_of_the_album_is_deleted():
    from app.api.v1.music import delete_album_files, delete_track_file

    lidarr = FakeLidarr()
    asyncio.run(delete_track_file(1, 2, lidarr))
    with pytest.raises(HTTPException):
        asyncio.run(delete_track_file(1, 99, lidarr))
    asyncio.run(delete_album_files(1, lidarr))
    assert lidarr.deleted_files == [[2], [1, 2]]


def test_album_releases_and_grabs_go_to_lidarr():
    from app.api.v1.releases import album_releases, grab_arr_release
    from app.schemas import GrabIn

    class Lidarr:
        grabbed = None

        async def releases(self, **params):
            assert params == {"albumId": 1}
            return [
                {"guid": "a", "indexerId": 1, "title": "BoC - Geogaddi [FLAC]", "rejected": True,
                 "rejections": ["Not wanted in profile"], "seeders": 3, "customFormatScore": 10,
                 "releaseGroup": "GRP", "quality": {"quality": {"name": "FLAC"}}},
                {"guid": "b", "indexerId": 1, "title": "BoC - Geogaddi [MP3]", "seeders": 1,
                 "rejections": None},
            ]  # fmt: skip

        async def grab_release(self, guid, indexer_id):
            Lidarr.grabbed = (guid, indexer_id)

    rows = asyncio.run(album_releases(1, Lidarr()))
    assert [r.guid for r in rows] == ["b", "a"]  # approved first
    assert rows[1].release_group == "GRP" and rows[1].custom_format_score == 10
    asyncio.run(
        grab_arr_release("lidarr", GrabIn(guid="b", indexer_id=1), None, None, None, Lidarr())
    )
    assert Lidarr.grabbed == ("b", 1)


def test_why_hasnt_this_album_arrived():
    from app.api.v1.diagnose import _blocklist_findings, diagnose

    hit = _blocklist_findings([{"albumIds": [4, 1], "sourceTitle": "x"}], 1, "lidarr")
    assert [f.code for f in hit] == ["blocklisted"]

    class Lidarr(FakeLidarr):
        async def queue(self):
            return {"records": [{"id": 3, "albumId": 1, "title": "t", "sizeleft": 5, "size": 9}]}

        async def blocklist(self, page_size):
            return {"records": []}

        async def tasks(self):
            return []

        async def delay_profiles(self):
            return []

    class Prowlarr:
        async def indexers(self):
            return [{"id": 1, "enable": True}]

        async def indexer_stats(self):
            return {}

        async def health(self):
            return []

    out = asyncio.run(diagnose("lidarr", 1, None, None, Prowlarr(), Lidarr()))
    codes = [f.code for f in out.findings]
    assert "queue_downloading" in codes and "never_searched" in codes


# --- adding music --------------------------------------------------------------


def test_search_finds_artists_and_albums_and_knows_what_is_in_the_library():
    from app.api.v1.musicsearch import search_music

    lidarr = FakeLidarr()
    lidarr.search_results = [
        # Lidarr hands back a library artist without its artwork
        {"foreignId": ARTIST["foreignArtistId"], "artist": {**ARTIST, "images": []}},
        {"foreignId": "f229", "artist": {"artistName": "Aphex Twin", "foreignArtistId": "f229",
                                          "remotePoster": COVER}},
        {"foreignId": "55d0", "album": {"title": "Remixes", "foreignAlbumId": "55d0",
                                         "albumType": "EP", "releaseDate": "2005-06-01T00:00:00Z",
                                         "artist": {"artistName": "Aphex Twin"},
                                         "remoteCover": COVER}},
        {"foreignId": ALBUM["foreignAlbumId"], "album": ALBUM},
    ]  # fmt: skip
    rows = asyncio.run(search_music("boards", lidarr))
    boc, aphex, remixes, geogaddi = rows
    assert (boc.kind, boc.in_library, boc.library_id) == ("artist", True, 1)
    assert boc.poster.startswith("/api/v1/library/artists/1/image/poster-250.jpg")
    assert (aphex.in_library, aphex.foreign_id, aphex.remote_id) == (False, "f229", 0)
    assert aphex.poster.startswith("/api/v1/poster?u=")
    assert (remixes.kind, remixes.artist, remixes.album_type, remixes.year) == (
        "album",
        "Aphex Twin",
        "EP",
        2005,
    )
    assert geogaddi.in_library and geogaddi.library_id == 1 and geogaddi.has_file


def test_adding_an_album_adds_its_artist_with_only_that_album_monitored():
    from app.api.v1.musicsearch import add_album

    lidarr = FakeLidarr()
    lidarr.lookup = [
        {"title": "Remixes", "foreignAlbumId": "55d0",
         "artist": {"artistName": "Aphex Twin", "foreignArtistId": "f229"}}
    ]  # fmt: skip
    body = AddAlbumIn(
        foreign_album_id="55d0", title="Remixes", quality_profile_id=3, root_folder_path="/music"
    )
    assert asyncio.run(add_album(body, lidarr)) == {"id": 9, "title": "Remixes"}
    payload = lidarr.added
    artist = payload["artist"]
    assert (artist["qualityProfileId"], artist["metadataProfileId"]) == (3, 1)
    assert artist["rootFolderPath"] == "/music" and artist["monitorNewItems"] == "none"
    assert artist["addOptions"] == {
        "monitor": "all",
        "albumsToMonitor": ["55d0"],
        "monitored": True,
        "searchForMissingAlbums": False,
    }
    assert payload["monitored"] is True and payload["addOptions"] == {"searchForNewAlbum": True}


def test_an_album_by_a_library_artist_keeps_the_artists_settings():
    from app.api.v1.musicsearch import add_album

    lidarr = FakeLidarr()
    known = {"id": 1, "artistName": "Boards of Canada", "qualityProfileId": 1}
    lidarr.lookup = [{"title": "Tomorrow's Harvest", "foreignAlbumId": "t1", "artist": known}]
    body = AddAlbumIn(
        foreign_album_id="t1", title="x", quality_profile_id=3, root_folder_path="/elsewhere"
    )
    asyncio.run(add_album(body, lidarr))
    assert lidarr.added["artist"] == known


def test_adding_an_artist_monitors_what_was_asked():
    from app.api.v1.musicsearch import add_artist

    lidarr = FakeLidarr()
    lidarr.lookup = [{"artistName": "Autechre", "foreignArtistId": "410c"}]
    body = AddArtistIn(
        foreign_artist_id="410c",
        title="Autechre",
        quality_profile_id=3,
        metadata_profile_id=2,
        root_folder_path="/music",
        monitor="latest",
        search_now=False,
    )
    assert asyncio.run(add_artist(body, lidarr)) == {"id": 3, "title": "Autechre"}
    payload = lidarr.added
    assert payload["metadataProfileId"] == 2 and payload["monitorNewItems"] == "all"
    assert payload["addOptions"] == {
        "monitor": "latest",
        "monitored": True,
        "searchForMissingAlbums": False,
    }
    lidarr.lookup = []
    with pytest.raises(HTTPException):
        asyncio.run(add_artist(body, lidarr))


def test_bulk_actions_address_artists():
    from app.api.v1.library import library_bulk_edit, library_bulk_search
    from app.schemas import BulkDeleteIn, BulkEditIn

    class Lidarr(FakeLidarr):
        async def bulk_edit(self, payload):
            self.edited = payload

    lidarr = Lidarr()
    asyncio.run(
        library_bulk_edit(
            "artists", BulkEditIn(ids=[1, 3], monitored=False), None, None, None, lidarr
        )
    )
    assert lidarr.edited == {"artistIds": [1, 3], "monitored": False}
    asyncio.run(library_bulk_search("artists", BulkDeleteIn(ids=[1, 3]), None, None, None, lidarr))
    assert lidarr.commands == [
        {"name": "ArtistSearch", "artistId": 1},
        {"name": "ArtistSearch", "artistId": 3},
    ]
