"""Importing a finished torrent no arr is tracking: the folder comes from the
torrent client, never from the request, and an arr that can't see the folder
is a clear error rather than a guessed path."""

import asyncio

import pytest
from fastapi import HTTPException

from app.api.v1.importing import torrent_import, torrent_import_candidates
from app.schemas import TorrentImportIn

HASH = "c0956546eb34911d8f06d63ce384df95447872bf"
FOLDER = "/data/Movies/Countdown.2026.1080p.WEB.h264-EDITH"
MKV = f"{FOLDER}/Countdown.2026.1080p.WEB.h264-EDITH.mkv"


class FakeQbit:
    def __init__(self, **over):
        self.torrent = {
            "hash": HASH,
            "name": "Countdown.2026.1080p.WEB.h264-EDITH",
            "save_path": "/data/Movies",
            "content_path": FOLDER,
            "root_path": FOLDER,
            "progress": 1,
            **over,
        }
        self.asked = []

    async def torrents(self, hashes=None):
        self.asked.append(hashes)
        return [self.torrent]


class FakeTransmission:
    def __init__(self, **over):
        self.t = {
            "id": 12,
            "hashString": "ab" * 20,
            "name": "Some.Book.ePub",
            "downloadDir": "/downloads/",
            "percentDone": 1,
            **over,
        }
        self.asked = []

    async def torrent(self, id_or_hash):
        self.asked.append(id_or_hash)
        return self.t


class FakeArr:
    def __init__(self, candidates=None, queue=None, listing=None):
        self.candidates = candidates if candidates is not None else []
        self.queue_records = queue or []
        self.listing = listing or {"directories": [], "files": []}
        self.scanned = []
        self.listed = []
        self.commands = []

    async def queue(self):
        return {"records": self.queue_records}

    async def manual_import_folder(self, folder):
        self.scanned.append(folder)
        return self.candidates

    async def filesystem(self, path):
        self.listed.append(path)
        return self.listing

    async def command(self, payload):
        self.commands.append(payload)
        return {"id": 5, "status": "queued"}


MATCHED = {
    "path": MKV,
    "name": "Countdown",
    "size": 1,
    "quality": {"quality": {"id": 3, "name": "WEBDL-1080p"}},
    "languages": [{"id": 1, "name": "English"}],
    "releaseGroup": "EDITH",
    "movie": {"id": 40, "title": "Countdown"},
}


def candidates(radarr, qbit=None, tm=None, client="qbittorrent", torrent_id=HASH, sonarr=None):
    return asyncio.run(
        torrent_import_candidates(
            "radarr",
            client,
            torrent_id,
            radarr,
            sonarr or FakeArr(),
            FakeArr(),
            qbit or FakeQbit(),
            tm or FakeTransmission(),
        )
    )


def run_import(radarr, body, qbit=None, tm=None):
    return asyncio.run(
        torrent_import(
            "radarr",
            body,
            radarr,
            FakeArr(),
            FakeArr(),
            qbit or FakeQbit(),
            tm or FakeTransmission(),
        )
    )


def test_the_arr_scans_the_folder_the_torrent_client_reports():
    radarr = FakeArr([MATCHED])
    out = candidates(radarr)
    assert radarr.scanned == [FOLDER]
    assert out[0]["title"] == "Countdown" and out[0]["importable"] is True


def test_a_single_file_torrent_scans_the_file():
    file = "/data/Shows/Show.S01E10.mkv"
    radarr = FakeArr([MATCHED])
    candidates(radarr, FakeQbit(root_path="", content_path=file, save_path="/data/Shows"))
    assert radarr.scanned == [file]


def test_a_name_that_climbs_out_of_the_save_path_is_refused():
    radarr = FakeArr([MATCHED])
    with pytest.raises(HTTPException) as exc:
        candidates(radarr, FakeQbit(root_path="/data/Movies/../../etc", content_path=""))
    assert exc.value.status_code == 409
    assert radarr.scanned == []


def test_an_unfinished_torrent_is_not_offered():
    with pytest.raises(HTTPException) as exc:
        candidates(FakeArr([MATCHED]), FakeQbit(progress=0.4))
    assert exc.value.status_code == 409


def test_anything_but_a_hash_never_reaches_the_torrent_client():
    qbit = FakeQbit()
    with pytest.raises(HTTPException) as exc:
        candidates(FakeArr(), qbit, torrent_id="/data/Movies")
    assert exc.value.status_code == 404
    assert qbit.asked == []


def test_a_download_an_arr_is_tracking_goes_to_its_queue_item_instead():
    sonarr = FakeArr(queue=[{"id": 3, "downloadId": HASH.upper()}])
    radarr = FakeArr([MATCHED])
    with pytest.raises(HTTPException) as exc:
        candidates(radarr, sonarr=sonarr)
    assert exc.value.status_code == 409
    assert "Sonarr is already tracking" in exc.value.detail
    assert radarr.scanned == []


def test_a_folder_the_arr_cannot_see_is_a_clear_error_not_a_guess():
    # Transmission saves to /downloads/, which no arr mounts on this server
    radarr = FakeArr([], listing={"directories": [], "files": []})
    with pytest.raises(HTTPException) as exc:
        candidates(radarr, client="transmission", torrent_id="12")
    assert exc.value.status_code == 409
    assert "Radarr can't see /downloads/Some.Book.ePub" in exc.value.detail
    assert "Transmission" in exc.value.detail
    assert radarr.listed == ["/downloads/"]


def test_a_visible_folder_with_nothing_importable_is_just_empty():
    listing = {"directories": [{"name": "Countdown.2026.1080p.WEB.h264-EDITH"}], "files": []}
    assert candidates(FakeArr([], listing=listing)) == []


def test_transmission_is_looked_up_by_id_or_hash():
    tm = FakeTransmission(downloadDir="/data/Movies", name="Countdown.2026.1080p.WEB.h264-EDITH")
    candidates(FakeArr([MATCHED]), tm=tm, client="transmission", torrent_id="12")
    candidates(FakeArr([MATCHED]), tm=tm, client="transmission", torrent_id="ab" * 20)
    assert tm.asked == [12, "ab" * 20]


def test_auto_is_sent_as_copy_so_the_torrent_keeps_its_files():
    radarr = FakeArr([MATCHED])
    body = TorrentImportIn(client="qbittorrent", torrent_id=HASH, files=[{"path": MKV}])
    out = run_import(radarr, body)
    command = radarr.commands[0]
    assert command["importMode"] == "copy"
    # no arr tracks it, so there is no download id to tie it to
    assert "downloadId" not in command["files"][0]
    assert command["files"][0]["movieId"] == 40
    assert out["id"] == 5


def test_move_happens_only_when_chosen():
    radarr = FakeArr([MATCHED])
    body = TorrentImportIn(
        client="qbittorrent", torrent_id=HASH, files=[{"path": MKV}], mode="move"
    )
    run_import(radarr, body)
    assert radarr.commands[0]["importMode"] == "move"


def test_a_path_the_arr_did_not_find_in_the_folder_is_refused():
    radarr = FakeArr([MATCHED])
    body = TorrentImportIn(
        client="qbittorrent", torrent_id=HASH, files=[{"path": "/etc/passwd", "movie_id": 1}]
    )
    with pytest.raises(HTTPException) as exc:
        run_import(radarr, body)
    assert exc.value.status_code == 404
    assert radarr.commands == []


def test_a_hand_picked_target_works_for_a_torrent_too():
    unmatched = {**MATCHED, "movie": None}
    radarr = FakeArr([unmatched])
    body = TorrentImportIn(
        client="qbittorrent", torrent_id=HASH, files=[{"path": MKV, "movie_id": 41}]
    )
    run_import(radarr, body)
    assert radarr.commands[0]["files"][0]["movieId"] == 41
