"""The capability endpoint an out-of-tree client depends on.

A client shipped with this backend never needed it. One that talks to any arrdeck
does: without it, discovering a missing endpoint means calling it and reading a
404, which is indistinguishable from a typo or a proxy problem.
"""

import pytest
from fastapi.testclient import TestClient

from app.api.v1.about import FEATURE_ROUTES, available_features
from app.main import app
from app.version import VERSION


@pytest.fixture
def client():
    # is_lan() decides by the Host header rather than the source IP — Docker NATs
    # every inbound connection, so the source is useless. TestClient sends
    # "testserver", which is neither an IP literal nor localhost, so without this
    # every request is treated as remote and 401s.
    with TestClient(app, headers={"host": "localhost"}) as c:
        yield c


def test_every_declared_feature_maps_to_a_real_route():
    """The guard that keeps the endpoint honest. Claiming a feature the backend
    does not serve is worse than omitting it: a client would enable UI for
    something that 404s."""
    mounted = set(app.openapi()["paths"])
    missing = {name: path for name, path in FEATURE_ROUTES.items() if path not in mounted}
    assert not missing, f"declared features with no route: {missing}"


class FakeApp:
    """Stands in for the real app. `available_features` reads the OpenAPI schema
    rather than `app.routes`, because sub-routers are not flattened into the
    latter."""

    def __init__(self, paths: list[str]) -> None:
        self._paths = paths

    def openapi(self) -> dict:
        return {"paths": {path: {} for path in self._paths}}


def test_a_backend_serving_nothing_claims_nothing():
    """Deleting an endpoint must withdraw its feature automatically, or the list
    rots the first time someone removes a route."""
    assert available_features(FakeApp([])) == []


def test_only_paths_actually_served_become_features():
    served = FakeApp(["/api/v1/tasks", "/api/v1/nonsense"])
    assert available_features(served) == ["scheduled_tasks"]


def test_an_older_backend_reports_a_smaller_feature_set():
    """The whole point: a client talking to a backend from before the last two
    rounds must be able to tell that diagnose and credits are absent."""
    old = FakeApp(["/api/v1/calendar", "/api/v1/subtitles", "/api/v1/vpn"])
    features = available_features(old)
    assert features == ["calendar", "subtitles", "vpn"]
    assert "diagnose" not in features
    assert "credits" not in features


def test_about_reports_the_version_from_the_single_source(client):
    body = client.get("/api/v1/about").json()
    assert body["version"] == VERSION
    assert body["name"] == "arrdeck"


def test_the_openapi_version_matches_too(client):
    """main.py and package.json each carried an independent 0.1.0 that was never
    bumped; the point of this phase is that there is now one."""
    assert client.get("/openapi.json").json()["info"]["version"] == VERSION


def test_about_lists_the_features_this_build_actually_has(client):
    features = client.get("/api/v1/about").json()["features"]
    # Shipped in the last two rounds; a client keys its UI off exactly these.
    for expected in ("diagnose", "credits", "quality_profiles", "scheduled_tasks"):
        assert expected in features, expected
    assert features == sorted(features), "sorted so a client can diff two backends"


def test_about_carries_nothing_beyond_capability(client):
    """Kept deliberately small: it is the first thing a new client reads, and
    there is no reason for it to describe the deployment."""
    body = client.get("/api/v1/about").json()
    assert set(body) == {"name", "version", "features"}


def test_about_needs_auth_from_outside_the_lan():
    """Deliberate: exempting it would hand an unauthenticated caller a version
    and a capability list, and this backend is reachable from the internet. The
    401 is the signal a client pairs on."""
    with TestClient(app, headers={"host": "deck.example.com"}) as remote:
        assert remote.get("/api/v1/about").status_code == 401
