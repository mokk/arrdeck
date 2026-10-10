"""Restarting services through the host helper: the client's error mapping and
the two endpoints the PWA calls."""

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.clients.base import ServiceUnavailable
from app.clients.helper import HELPER_URL, HelperClient, HelperError
from app.registry import Registry, is_configured


def client_for(handler) -> HelperClient:
    http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return HelperClient(http, "tok", "")


def test_the_helper_needs_only_a_token_and_defaults_its_address():
    assert is_configured("helper", {"api_key": "tok", "url": ""})
    assert not is_configured("helper", {"api_key": "", "url": HELPER_URL})
    registry = Registry(httpx.AsyncClient(), httpx.AsyncClient(), httpx.AsyncClient())
    registry.rebuild("helper", {"api_key": "tok", "url": ""})
    assert registry.get("helper").base_url == "http://host.docker.internal:8790"


def test_the_client_sends_the_token_and_reads_projects():
    seen = []

    def handler(request):
        seen.append((request.method, request.url.path, request.headers["authorization"]))
        return httpx.Response(200, json={"projects": [{"name": "radarr"}]})

    projects = asyncio.run(client_for(handler).projects())
    assert projects == [{"name": "radarr"}]
    assert seen == [("GET", "/projects", "Bearer tok")]


def test_a_wrong_token_reads_as_unavailable_with_a_hint():
    client = client_for(lambda r: httpx.Response(401, json={"error": "unauthorized"}))
    with pytest.raises(ServiceUnavailable, match="token"):
        asyncio.run(client.health())


def test_a_refusal_keeps_the_helpers_reason():
    client = client_for(
        lambda r: httpx.Response(429, json={"error": "too soon", "retry_after": 42})
    )
    with pytest.raises(HelperError) as exc:
        asyncio.run(client.action("radarr", "restart"))
    assert (exc.value.status, exc.value.message, exc.value.retry_after) == (429, "too soon", 42)


def test_a_failed_compose_command_is_not_flattened_into_http_502():
    client = client_for(lambda r: httpx.Response(502, json={"error": "no such service: radarr"}))
    with pytest.raises(HelperError, match="no such service"):
        asyncio.run(client.action("radarr", "up"))


def test_an_unreachable_helper_is_service_unavailable():
    def handler(request):
        raise httpx.ConnectError("refused")

    with pytest.raises(ServiceUnavailable):
        asyncio.run(client_for(handler).action("radarr", "restart"))


# --- endpoints -------------------------------------------------------------


class FakeHelper:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail

    async def projects(self):
        return [
            {
                "name": "radarr",
                "running": True,
                "containers": [{"state": "running"}],
                "error": None,
            },
            {
                "name": "arrdeck",
                "running": False,
                "containers": [{"state": "running"}, {"state": "exited"}],
                "error": None,
            },
        ]

    async def action(self, project, action):
        self.calls.append((project, action))
        if self.fail:
            raise self.fail
        return {"ok": True}


class FakeRegistry:
    def __init__(self, helper=None):
        self.helper = helper

    def is_configured(self, name):
        return name == "helper" and self.helper is not None

    def get(self, name):
        return self.helper

    def configured(self):
        return []


@pytest.fixture
def api(monkeypatch):
    from app.main import app

    with TestClient(app, headers={"host": "localhost"}) as c:

        def use(helper):
            monkeypatch.setattr(app.state, "registry", FakeRegistry(helper))
            return c

        yield use


def test_restartable_says_when_the_helper_is_missing(api):
    assert api(None).get("/api/v1/system/restartable").json() == {
        "configured": False,
        "error": None,
        "projects": [],
    }


def test_restartable_maps_projects_to_services_and_marks_arrdeck(api):
    body = api(FakeHelper()).get("/api/v1/system/restartable").json()
    rows = {p["name"]: p for p in body["projects"]}
    assert rows["radarr"]["service"] == "radarr" and not rows["radarr"]["is_self"]
    assert rows["arrdeck"]["service"] is None and rows["arrdeck"]["is_self"]
    assert (rows["arrdeck"]["containers"], rows["arrdeck"]["running_containers"]) == (2, 1)


def test_restartable_reports_an_unreachable_helper_without_failing(api):
    class Down(FakeHelper):
        async def projects(self):
            raise ServiceUnavailable("helper", "connection refused")

    body = api(Down()).get("/api/v1/system/restartable").json()
    assert body["configured"] and body["error"] == "connection refused"


def test_restart_goes_through_the_helper(api):
    helper = FakeHelper()
    resp = api(helper).post("/api/v1/system/services/radarr/restart")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "project": "radarr", "action": "restart", "pending": False}
    assert helper.calls == [("radarr", "restart")]


def test_restart_without_a_helper_is_a_clear_409(api):
    resp = api(None).post("/api/v1/system/services/radarr/restart")
    assert resp.status_code == 409 and "not configured" in resp.json()["detail"]


def test_the_helpers_refusal_is_passed_on(api):
    helper = FakeHelper(fail=HelperError(429, "too soon after the last action", 30))
    resp = api(helper).post("/api/v1/system/services/radarr/up")
    assert resp.status_code == 429 and resp.headers["retry-after"] == "30"
    assert resp.json()["detail"] == "too soon after the last action"


def test_odd_names_and_actions_never_reach_the_helper(api):
    helper = FakeHelper()
    c = api(helper)
    assert c.post("/api/v1/system/services/Radarr/restart").status_code == 404
    assert c.post("/api/v1/system/services/radarr/down").status_code == 422
    assert helper.calls == []


def test_restarting_arrdeck_answers_before_the_helper_does(api):
    helper = FakeHelper()
    resp = api(helper).post("/api/v1/system/services/arrdeck/restart")
    assert resp.json()["pending"] is True


def test_self_restart_is_refused_when_the_helper_does_not_list_arrdeck(api):
    class NoSelf(FakeHelper):
        async def projects(self):
            return [{"name": "radarr"}]

    helper = NoSelf()
    resp = api(helper).post("/api/v1/system/services/arrdeck/restart")
    assert resp.status_code == 404 and helper.calls == []


def test_the_openapi_names_the_new_service():
    from app.main import app

    names = app.openapi()["components"]["schemas"]["ServiceStatus"]["properties"]["service"]
    assert "helper" in json.dumps(names)
