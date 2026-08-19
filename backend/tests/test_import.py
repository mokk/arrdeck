from app.api.v1.downloads import _describe_candidate, _import_file


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
