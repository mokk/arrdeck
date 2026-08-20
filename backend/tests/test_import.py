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
        manual_import_assign(app, body, client if app == "radarr" else None,
                             client if app == "sonarr" else None)
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
