"""Adding a service means touching several lists that must agree.

Forgetting one of them doesn't fail at import — it fails at runtime, when a
response model rejects the new name and an endpoint 500s.
"""

from typing import get_args

from app.db import SERVICES
from app.registry import NEEDS_API_KEY, Registry
from app.schemas import ServiceName


def test_the_service_name_literal_covers_every_service():
    assert set(get_args(ServiceName)) == set(SERVICES)


def test_every_service_has_a_registry_branch():
    import httpx

    registry = Registry(httpx.AsyncClient(), httpx.AsyncClient(), httpx.AsyncClient())
    conf = {
        name: {"url": "http://example.test", "api_key": "k", "username": "", "password": ""}
        for name in SERVICES
    }
    registry.rebuild_all(conf)
    assert registry.configured() == SERVICES


def test_api_key_services_are_a_subset_of_all_services():
    assert NEEDS_API_KEY <= set(SERVICES)


def test_every_service_can_be_version_probed():
    from app.registry import probe_version
    import inspect

    source = inspect.getsource(probe_version)
    for name in SERVICES:
        assert f'"{name}"' in source, f"probe_version has no branch for {name}"


# --- plex watched-state join -------------------------------------------


def test_guid_keys_indexes_every_external_id():
    from app.api.v1.dashboard import _guid_keys

    item = {
        "Guid": [
            {"id": "imdb://tt0289043"},
            {"id": "tmdb://170"},
            {"id": "tvdb://871"},
        ]
    }
    assert _guid_keys(item) == ["imdb:tt0289043", "tmdb:170", "tvdb:871"]


def test_guid_keys_tolerates_missing_or_malformed_guids():
    from app.api.v1.dashboard import _guid_keys

    assert _guid_keys({}) == []
    assert _guid_keys({"Guid": [{"id": "plex://movie/abc"}, {"id": "junk"}, {}]}) == [
        "plex:movie/abc"
    ]
