"""Shaping of the arrs' quality profiles: cutoff resolution, order, format scores."""

import pytest

from app.api.v1.profiles import quality_profiles
from app.cache import cache


def quality(qid: int, name: str, allowed: bool) -> dict:
    return {"quality": {"id": qid, "name": name}, "allowed": allowed}


def group(gid: int, name: str, allowed: bool, members: list[str]) -> dict:
    return {
        "id": gid,
        "name": name,
        "allowed": allowed,
        "items": [{"quality": {"id": 900 + i, "name": m}} for i, m in enumerate(members)],
    }


# Worst first, exactly as the arr returns it.
PROFILE = {
    "id": 4,
    "name": "HD-1080p",
    "upgradeAllowed": True,
    "cutoff": 7,
    "minFormatScore": 0,
    "items": [
        quality(1, "SDTV", False),
        group(1001, "WEB 720p", False, ["WEBDL-720p", "WEBRip-720p"]),
        quality(9, "HDTV-1080p", True),
        group(1002, "WEB 1080p", True, ["WEBDL-1080p", "WEBRip-1080p"]),
        quality(7, "Bluray-1080p", True),
        quality(30, "Remux-1080p", True),
    ],
}


class FakeArr:
    def __init__(
        self,
        profiles: list[dict],
        formats: list[dict] | None = None,
        definitions: list[dict] | None = None,
    ) -> None:
        self._profiles = profiles
        self._formats = formats if formats is not None else []
        self._definitions = definitions if definitions is not None else []
        self.profile_calls = 0

    async def quality_profiles(self) -> list[dict]:
        self.profile_calls += 1
        return self._profiles

    async def custom_formats(self) -> list[dict]:
        return self._formats

    async def quality_definitions(self) -> list[dict]:
        return self._definitions


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


async def call(app: str, arr: FakeArr):
    # Only the named app's client is consulted; the other is never touched.
    return await quality_profiles(
        app,
        radarr=arr if app == "radarr" else None,
        sonarr=arr if app == "sonarr" else None,
    )


async def test_qualities_come_back_best_first():
    """The arr's API returns worst first; its own UI shows best first, and this
    view sits next to that UI."""
    out = await call("radarr", FakeArr([PROFILE]))
    names = [i.name for i in out.profiles[0].items]
    assert names[0] == "Remux-1080p"
    assert names[-1] == "SDTV"


async def test_the_cutoff_id_resolves_to_a_quality_name():
    out = await call("radarr", FakeArr([PROFILE]))
    assert out.profiles[0].cutoff == "Bluray-1080p"
    assert [i.name for i in out.profiles[0].items if i.is_cutoff] == ["Bluray-1080p"]


async def test_a_cutoff_can_be_a_group():
    """Groups and qualities share the cutoff field but not the id space, so a
    group has to be matched as a group rather than by number."""
    profile = {**PROFILE, "cutoff": 1002}
    out = await call("radarr", FakeArr([profile]))
    assert out.profiles[0].cutoff == "WEB 1080p"


async def test_an_unresolvable_cutoff_is_none_rather_than_an_id():
    profile = {**PROFILE, "cutoff": 4242}
    out = await call("radarr", FakeArr([profile]))
    assert out.profiles[0].cutoff is None


async def test_groups_carry_their_members():
    out = await call("radarr", FakeArr([PROFILE]))
    web = next(i for i in out.profiles[0].items if i.name == "WEB 1080p")
    assert web.is_group is True
    assert web.members == ["WEBDL-1080p", "WEBRip-1080p"]


async def test_disallowed_qualities_are_kept_and_flagged():
    """The list is the whole ladder; the UI collapses it, not the API."""
    out = await call("radarr", FakeArr([PROFILE]))
    items = out.profiles[0].items
    assert len(items) == 6
    assert sum(1 for i in items if i.allowed) == 4
    assert next(i for i in items if i.name == "SDTV").allowed is False


async def test_upgrade_allowed_is_carried_through():
    out = await call("radarr", FakeArr([PROFILE]))
    assert out.profiles[0].upgrade_allowed is True
    # Same app, so the same cache key — clear it rather than assert against a
    # cached answer, which is what the endpoint is supposed to return.
    cache.clear()
    off = await call("radarr", FakeArr([{**PROFILE, "upgradeAllowed": False}]))
    assert off.profiles[0].upgrade_allowed is False


async def test_format_scores_are_named_and_sorted_high_first():
    profile = {
        **PROFILE,
        "formatItems": [
            {"format": 1, "score": 50},
            {"format": 2, "score": -100},
            {"format": 3, "score": 200},
        ],
    }
    formats = [
        {"id": 1, "name": "HDR10"},
        {"id": 2, "name": "BR-DISK"},
        {"id": 3, "name": "Dolby Vision"},
    ]
    out = await call("radarr", FakeArr([profile], formats))
    assert [(s.name, s.score) for s in out.profiles[0].format_scores] == [
        ("Dolby Vision", 200),
        ("HDR10", 50),
        ("BR-DISK", -100),
    ]


async def test_zero_scored_formats_are_omitted():
    """Every format scores zero by default, so listing them all would bury the
    handful that actually influence a profile."""
    profile = {**PROFILE, "formatItems": [{"format": 1, "score": 0}]}
    out = await call("radarr", FakeArr([profile], [{"id": 1, "name": "HDR10"}]))
    assert out.profiles[0].format_scores == []


async def test_custom_formats_are_listed_even_when_no_profile_scores_them():
    out = await call("radarr", FakeArr([PROFILE], [{"id": 1, "name": "HDR10"}]))
    assert out.custom_formats == ["HDR10"]


async def test_no_custom_formats_is_an_empty_list_not_an_error():
    out = await call("radarr", FakeArr([PROFILE], []))
    assert out.custom_formats == []


async def test_an_unknown_app_is_a_404():
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        await call("bazarr", FakeArr([PROFILE]))
    assert exc.value.status_code == 404


async def test_results_are_cached_per_app():
    radarr = FakeArr([{**PROFILE, "name": "R"}])
    sonarr = FakeArr([{**PROFILE, "name": "S"}])
    assert (await call("radarr", radarr)).profiles[0].name == "R"
    assert (await call("radarr", radarr)).profiles[0].name == "R"
    assert radarr.profile_calls == 1
    # A cache key shared across apps would serve Radarr's profiles for Sonarr.
    assert (await call("sonarr", sonarr)).profiles[0].name == "S"


async def test_size_bands_come_back_in_quality_order():
    """The arr's `weight` is the quality ladder, so ordering by it makes the
    table read the same way as the profile above it."""
    definitions = [
        {"title": "Bluray-1080p", "weight": 9, "minSize": 4, "preferredSize": 125, "maxSize": 130},
        {"title": "SDTV", "weight": 1, "minSize": 0, "preferredSize": 95, "maxSize": 100},
    ]
    out = await call("sonarr", FakeArr([PROFILE], [], definitions))
    assert [d.name for d in out.quality_definitions] == ["SDTV", "Bluray-1080p"]
    assert out.quality_definitions[1].max_size == 130


async def test_a_definition_with_no_ceiling_is_none_not_zero():
    """Raw-HD has no preferred or max size in Sonarr; zero would read as
    "nothing is allowed" rather than "unbounded"."""
    definitions = [{"title": "Raw-HD", "weight": 1, "minSize": 4}]
    out = await call("sonarr", FakeArr([PROFILE], [], definitions))
    assert out.quality_definitions[0].min_size == 4
    assert out.quality_definitions[0].preferred_size is None
    assert out.quality_definitions[0].max_size is None


async def test_the_name_falls_back_to_the_nested_quality():
    definitions = [{"quality": {"name": "WEBDL-1080p"}, "weight": 5}]
    out = await call("sonarr", FakeArr([PROFILE], [], definitions))
    assert out.quality_definitions[0].name == "WEBDL-1080p"


async def test_a_failing_size_table_does_not_take_down_the_profiles():
    """The bands are context; the profiles are the point of the endpoint."""

    class NoDefinitions(FakeArr):
        async def quality_definitions(self) -> list[dict]:
            raise RuntimeError("endpoint gone")

    out = await call("radarr", NoDefinitions([PROFILE]))
    assert out.profiles[0].name == "HD-1080p"
    assert out.quality_definitions == []
