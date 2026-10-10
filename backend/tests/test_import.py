import pytest
from fastapi import HTTPException

from app.api.v1.importing import _describe_candidate, _import_file


def test_a_matched_movie_becomes_an_import_payload():
    candidate = {
        "path": "/downloads/Dune.2021.mkv",
        "quality": {"quality": {"name": "Bluray-1080p"}},
        "movie": {"id": 7, "title": "Dune"},
        "languages": [{"name": "English"}],
        "releaseGroup": "GRP",
    }
    assert _import_file("radarr", candidate) == {
        "path": "/downloads/Dune.2021.mkv",
        "quality": {"quality": {"name": "Bluray-1080p"}},
        "languages": [{"name": "English"}],
        "releaseGroup": "GRP",
        "movieId": 7,
    }


def test_a_matched_episode_carries_every_episode_id():
    candidate = {
        "path": "/downloads/bear.mkv",
        "quality": {"quality": {"name": "WEBDL-1080p"}},
        "series": {"id": 12, "title": "The Bear"},
        "episodes": [{"id": 1, "seasonNumber": 3, "episodeNumber": 4}, {"id": 2}],
    }
    assert _import_file("sonarr", candidate)["episodeIds"] == [1, 2]


def test_an_unmatched_file_is_not_importable():
    # no movie/series match, or no quality -> the arr can't place it
    assert _import_file("radarr", {"path": "x", "quality": {}, "movie": None}) is None
    assert _import_file("radarr", {"path": "x", "movie": {"id": 1}}) is None
    assert _import_file("sonarr", {"path": "x", "quality": {"q": 1}, "series": {"id": 1}}) is None


def test_describe_surfaces_the_arr_reasons_for_balking():
    described = _describe_candidate(
        "radarr",
        {
            "path": "/downloads/sample.mkv",
            "size": 1024,
            "quality": {"quality": {"name": "HDTV-720p"}},
            "movie": {"title": "Dune"},
            "rejections": [{"reason": "Sample"}, "Unknown movie"],
        },
    )
    assert described["rejections"] == ["Sample", "Unknown movie"]
    assert described["quality"] == "HDTV-720p"
    assert described["name"] == "sample.mkv"
    # no movie id, so it stays un-importable even though it was described
    assert described["importable"] is False


def test_describe_labels_an_episode_span():
    described = _describe_candidate(
        "sonarr",
        {
            "path": "/downloads/bear.mkv",
            "quality": {"quality": {"name": "WEBDL-1080p"}},
            "series": {"id": 12, "title": "The Bear"},
            "episodes": [
                {"id": 1, "seasonNumber": 3, "episodeNumber": 4},
                {"id": 2, "seasonNumber": 3, "episodeNumber": 5},
            ],
        },
    )
    assert described["title"] == "The Bear"
    assert described["subtitle"] == "S03E04 +1"
    assert described["importable"] is True


# --- hand-assigned targets ----------------------------------------------


class FakeArr:
    def __init__(self, candidates, download_id="abc"):
        self._candidates = candidates
        self._download_id = download_id
        self.commands = []

    async def queue(self):
        return {"records": [{"id": 1, "downloadId": self._download_id}]}

    async def manual_import(self, download_id):
        return self._candidates

    async def command(self, payload):
        self.commands.append(payload)
        return {"id": 77, "name": "ManualImport", "status": "queued"}

    async def quality_definitions(self):
        return [
            {"id": 1, "quality": {"id": 0, "name": "Unknown"}},
            {"id": 9, "quality": {"id": 7, "name": "Bluray-1080p", "source": "bluray"}},
        ]

    async def languages(self):
        return [
            {"id": -1, "name": "Any"},
            {"id": -2, "name": "Original"},
            {"id": 1, "name": "English"},
            {"id": 11, "name": "Danish"},
        ]

    async def get_book(self, book_id):
        return {"id": book_id, "title": "Atomic Habits", "authorId": 3}

    async def editions(self, book_id):
        return [
            {"id": 1, "foreignEditionId": "111", "monitored": False},
            {"id": 2, "foreignEditionId": "222", "monitored": True},
        ]

    async def get_command(self, command_id):
        return {
            "id": command_id,
            "name": "ManualImport",
            "status": "completed",
            "result": "successful",
            "message": "Manually imported 2 files",
        }


CANDIDATE = {
    "path": "/downloads/mystery.mkv",
    "quality": {"quality": {"name": "WEBDL-1080p"}},
    "languages": [{"name": "English"}],
    "releaseGroup": "GRP",
    # deliberately no movie/series: this is the case the arr couldn't place
}


def _assign(app, files, candidates=None):
    import asyncio

    from app.api.v1.importing import manual_import_assign
    from app.schemas import ManualImportAssignIn

    client = FakeArr(candidates if candidates is not None else [CANDIDATE])
    body = ManualImportAssignIn(item_id=1, files=files)
    asyncio.run(
        manual_import_assign(
            app,
            body,
            client if app == "radarr" else None,
            client if app == "sonarr" else None,
            client if app == "readarr" else None,
        )
    )
    return client.commands


def test_a_hand_picked_movie_is_imported_with_the_arrs_own_quality():
    commands = _assign("radarr", [{"path": CANDIDATE["path"], "movie_id": 42}])
    assert len(commands) == 1
    file = commands[0]["files"][0]
    assert file["movieId"] == 42
    # quality/languages come from the arr's parse, not from the client
    assert file["quality"] == CANDIDATE["quality"]
    assert file["languages"] == CANDIDATE["languages"]
    assert file["releaseGroup"] == "GRP"


def test_a_hand_picked_episode_carries_series_and_episodes():
    commands = _assign(
        "sonarr", [{"path": CANDIDATE["path"], "series_id": 12, "episode_ids": [5, 6]}]
    )
    file = commands[0]["files"][0]
    assert file["seriesId"] == 12 and file["episodeIds"] == [5, 6]


def test_a_missing_target_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _assign("radarr", [{"path": CANDIDATE["path"]}])
    assert exc.value.status_code == 422


def test_an_episode_without_episode_ids_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _assign("sonarr", [{"path": CANDIDATE["path"], "series_id": 12}])
    assert exc.value.status_code == 422


def test_a_path_that_is_not_a_candidate_is_rejected():
    with pytest.raises(HTTPException) as exc:
        _assign("radarr", [{"path": "/downloads/elsewhere.mkv", "movie_id": 1}])
    assert exc.value.status_code == 404


def test_a_candidate_with_no_detected_quality_cannot_be_forced():
    # without a quality the arr has nothing to import against, and guessing
    # one here would be worse than refusing
    stripped = {**CANDIDATE, "quality": None}
    with pytest.raises(HTTPException) as exc:
        _assign("radarr", [{"path": CANDIDATE["path"], "movie_id": 1}], [stripped])
    assert exc.value.status_code == 409


# --- staying tied to the tracked download --------------------------------


def test_queue_imports_name_the_download_so_auto_does_not_move_a_seeding_torrent():
    # without downloadId the arr has no download client item and "auto" moves
    # the files out from under the torrent
    commands = _assign("radarr", [{"path": CANDIDATE["path"], "movie_id": 42}])
    assert commands[0]["files"][0]["downloadId"] == "abc"
    assert commands[0]["importMode"] == "auto"


def test_force_import_names_the_download_too():
    import asyncio

    from app.api.v1.importing import force_import

    client = FakeArr([{**CANDIDATE, "movie": {"id": 7}}])
    asyncio.run(force_import("radarr", 1, client, None))
    assert client.commands[0]["files"][0]["downloadId"] == "abc"


def test_a_file_without_a_download_carries_no_download_id():
    assert "downloadId" not in _import_file("radarr", {**CANDIDATE, "movie": {"id": 7}})


# --- how the import went ---------------------------------------------------


def test_an_import_returns_the_arrs_command_so_it_can_be_followed():
    import asyncio

    from app.api.v1.importing import manual_import_assign
    from app.schemas import ManualImportAssignIn

    client = FakeArr([CANDIDATE])
    body = ManualImportAssignIn(item_id=1, files=[{"path": CANDIDATE["path"], "movie_id": 4}])
    out = asyncio.run(manual_import_assign("radarr", body, client, None))
    assert out["id"] == 77 and out["status"] == "queued"
    assert out["done"] is False and out["ok"] is None


def test_a_finished_command_reports_the_count_in_the_arrs_words():
    import asyncio

    from app.api.v1.importing import manual_import_command

    out = asyncio.run(manual_import_command("radarr", 77, FakeArr([]), None))
    assert out["done"] is True and out["ok"] is True
    assert out["imported"] == 2
    assert out["message"] == "Manually imported 2 files"


def test_a_crashed_import_shows_the_first_line_of_the_arrs_error():
    from app.api.v1.importing import command_out

    out = command_out(
        "sonarr",
        {
            "id": 5,
            "status": "failed",
            "result": "unsuccessful",
            "message": "Failed",
            "exception": "System.IO.IOException: Disk full\n   at NzbDrone.Common.Disk.Transfer()",
        },
    )
    assert out["done"] is True and out["ok"] is False
    assert out["message"] == "System.IO.IOException: Disk full"
    assert out["imported"] is None


def test_a_running_command_is_not_done_and_its_progress_line_is_no_count():
    from app.api.v1.importing import command_out

    out = command_out(
        "radarr",
        {"id": 5, "status": "started", "message": "Manually importing 3 files using mode Auto"},
    )
    assert out["done"] is False and out["ok"] is None and out["imported"] is None


def test_an_unknown_app_has_no_commands():
    import asyncio

    with pytest.raises(HTTPException) as exc:
        from app.api.v1.importing import manual_import_command

        asyncio.run(manual_import_command("lidarr", 1, None, None))
    assert exc.value.status_code == 404


def test_a_file_sent_without_a_target_keeps_the_arrs_own_match():
    matched = {**CANDIDATE, "path": "/downloads/known.mkv", "movie": {"id": 9}}
    commands = _assign(
        "radarr",
        [{"path": matched["path"]}, {"path": CANDIDATE["path"], "movie_id": 42}],
        [matched, CANDIDATE],
    )
    assert [f["movieId"] for f in commands[0]["files"]] == [9, 42]
    assert len(commands) == 1


# --- quality and language overrides ---------------------------------------


@pytest.fixture(autouse=True)
def _fresh_cache():
    from app.cache import cache

    cache.clear()
    yield
    cache.clear()


def test_without_overrides_the_arrs_detection_goes_through_untouched():
    commands = _assign("radarr", [{"path": CANDIDATE["path"], "movie_id": 4}])
    file = commands[0]["files"][0]
    assert file["quality"] == CANDIDATE["quality"]
    assert file["languages"] == CANDIDATE["languages"]


def test_a_chosen_quality_replaces_only_the_quality_and_keeps_the_revision():
    detected = {
        **CANDIDATE,
        "quality": {
            "quality": {"id": 3, "name": "WEBDL-1080p"},
            "revision": {"version": 2, "real": 0, "isRepack": True},
        },
    }
    commands = _assign(
        "radarr", [{"path": CANDIDATE["path"], "movie_id": 4, "quality_id": 7}], [detected]
    )
    assert commands[0]["files"][0]["quality"] == {
        "quality": {"id": 7, "name": "Bluray-1080p", "source": "bluray"},
        "revision": {"version": 2, "real": 0, "isRepack": True},
    }


def test_chosen_languages_replace_the_detected_ones():
    commands = _assign(
        "radarr", [{"path": CANDIDATE["path"], "movie_id": 4, "language_ids": [11, 1]}]
    )
    assert commands[0]["files"][0]["languages"] == [
        {"id": 11, "name": "Danish"},
        {"id": 1, "name": "English"},
    ]


def test_a_quality_can_rescue_a_file_the_arr_could_not_grade():
    stripped = {**CANDIDATE, "quality": None}
    commands = _assign(
        "radarr", [{"path": CANDIDATE["path"], "movie_id": 4, "quality_id": 7}], [stripped]
    )
    assert commands[0]["files"][0]["quality"]["quality"]["id"] == 7
    assert commands[0]["files"][0]["quality"]["revision"] == {
        "version": 1,
        "real": 0,
        "isRepack": False,
    }


def test_unknown_ids_and_wildcard_languages_are_refused():
    for override in ({"quality_id": 99}, {"language_ids": [-1]}, {"language_ids": [1, 500]}):
        with pytest.raises(HTTPException) as exc:
            _assign("radarr", [{"path": CANDIDATE["path"], "movie_id": 4, **override}])
        assert exc.value.status_code == 422


def test_options_list_qualities_in_order_and_real_languages_by_name():
    import asyncio

    from app.api.v1.importing import manual_import_options

    out = asyncio.run(manual_import_options("radarr", FakeArr([]), None))
    assert out["qualities"] == [{"id": 0, "name": "Unknown"}, {"id": 7, "name": "Bluray-1080p"}]
    assert [x["name"] for x in out["languages"]] == ["Danish", "English"]


def test_options_is_not_swallowed_by_the_candidates_route():
    from app.api.v1.importing import router

    paths = [r.path for r in router.routes]
    assert paths.index("/manual-import/{app}/options") < paths.index(
        "/manual-import/{app}/{item_id}"
    )


def test_candidates_carry_the_detected_ids_for_the_override_defaults():
    described = _describe_candidate(
        "radarr",
        {
            "path": "/x.mkv",
            "quality": {"quality": {"id": 3, "name": "WEBDL-1080p"}},
            "languages": [{"id": 1, "name": "English"}],
        },
    )
    assert described["quality_id"] == 3
    assert described["language_ids"] == [1]


# --- Readarr ----------------------------------------------------------------

BOOK = {
    "path": "/data/books/Atomvaner/atomvaner.epub",
    "name": "atomvaner",
    "size": 2684929,
    "quality": {"quality": {"id": 3, "name": "EPUB"}, "revision": {"version": 1}},
    "indexerFlags": 0,
    "rejections": [{"reason": "Couldn't find similar book", "type": "permanent"}],
    # as Readarr returns it when it could not place the file: no author/book
}


def test_a_matched_book_mirrors_readarrs_manual_import_file():
    matched = {
        **BOOK,
        "author": {"id": 3, "authorName": "James Clear"},
        "book": {"id": 8, "title": "Atomvaner"},
        "foreignEditionId": "222",
    }
    assert _import_file("readarr", matched, "HASH") == {
        "path": BOOK["path"],
        "quality": BOOK["quality"],
        "indexerFlags": 0,
        "downloadId": "HASH",
        "authorId": 3,
        "bookId": 8,
        "foreignEditionId": "222",
    }
    described = _describe_candidate("readarr", matched)
    assert (described["title"], described["subtitle"]) == ("Atomvaner", "James Clear")
    assert described["importable"] is True and described["language_ids"] == []


def test_a_book_without_an_edition_is_not_importable():
    stub = {**BOOK, "author": {"id": 3}, "book": {"id": 8}}
    assert _import_file("readarr", stub) is None


def test_a_hand_picked_book_imports_into_its_monitored_edition():
    commands = _assign("readarr", [{"path": BOOK["path"], "book_id": 8}], [BOOK])
    file = commands[0]["files"][0]
    assert (file["authorId"], file["bookId"], file["foreignEditionId"]) == (3, 8, "222")
    assert file["downloadId"] == "abc"
    # Readarr's ManualImportFile has neither
    assert "languages" not in file and "releaseGroup" not in file


def test_an_unplaced_book_needs_a_pick():
    with pytest.raises(HTTPException) as exc:
        _assign("readarr", [{"path": BOOK["path"]}], [BOOK])
    assert exc.value.status_code == 422


def test_readarr_offers_qualities_but_no_languages():
    import asyncio

    from app.api.v1.importing import manual_import_options

    class NoLanguages(FakeArr):
        async def languages(self):
            raise AssertionError("Readarr files have no language to set")

    out = asyncio.run(manual_import_options("readarr", None, None, NoLanguages([])))
    assert out["languages"] == [] and out["qualities"]


def test_force_import_works_for_books_too():
    import asyncio

    from app.api.v1.importing import force_import

    matched = {**BOOK, "author": {"id": 3}, "book": {"id": 8}, "foreignEditionId": "222"}
    client = FakeArr([matched])
    asyncio.run(force_import("readarr", 1, None, None, client))
    assert client.commands[0]["files"][0]["bookId"] == 8
