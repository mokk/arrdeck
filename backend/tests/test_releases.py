"""Interactive-search rows: what the arrs' release payloads map to."""

from app.api.v1.releases import _arr_release


def test_arr_release_carries_group_formats_languages_and_protocol():
    row = _arr_release(
        {
            "guid": "abc",
            "indexerId": 4,
            "indexer": "NZBgeek",
            "title": "Movie.2025.2160p.WEB-DL-GRP",
            "quality": {"quality": {"name": "WEBDL-2160p"}},
            "size": 12_000_000_000,
            "ageHours": 48,
            "releaseGroup": "GRP",
            "customFormatScore": 1750,
            "customFormats": [{"id": 1, "name": "HDR"}, {"id": 2, "name": "x265"}],
            "languages": [{"id": 1, "name": "English"}, {"id": 9, "name": "Danish"}],
            "protocol": "usenet",
            "edition": "Director's Cut",
            "infoUrl": "https://indexer.example/details/abc",
            "rejected": False,
        }
    )
    assert row.release_group == "GRP"
    assert row.custom_format_score == 1750
    assert row.custom_formats == ["HDR", "x265"]
    assert row.languages == ["English", "Danish"]
    assert row.protocol == "usenet"
    assert row.edition == "Director's Cut"
    assert row.info_url == "https://indexer.example/details/abc"
    assert row.age_days == 2
    assert row.approved is True


def test_arr_release_keeps_rejection_reasons():
    row = _arr_release(
        {
            "guid": "x",
            "title": "t",
            "rejected": True,
            "rejections": ["Not an upgrade for existing file", "Quality is not wanted"],
            "customFormatScore": -10000,
        }
    )
    assert row.approved is False
    assert row.rejections == ["Not an upgrade for existing file", "Quality is not wanted"]
    assert row.custom_format_score == -10000


def test_arr_release_tolerates_a_bare_payload():
    # Readarr sends none of the new fields; Sonarr has no edition, Radarr no fullSeason
    row = _arr_release({"guid": "g", "title": "t"})
    assert row.release_group is None
    assert row.custom_format_score is None
    assert row.custom_formats == []
    assert row.languages == []
    assert row.protocol is None
    assert row.full_season is None
    assert _arr_release({"guid": "g", "title": "t", "releaseGroup": ""}).release_group is None


def test_arr_release_marks_a_season_pack():
    assert _arr_release({"guid": "g", "title": "t", "fullSeason": True}).full_season is True
