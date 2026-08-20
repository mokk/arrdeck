"""Retry policy in BaseClient: GETs get one more chance, writes never do."""

import httpx
import pytest

from app.clients.base import (
    BaseClient,
    ServiceUnavailable,
    reset_retries,
    retry_count,
)


@pytest.fixture(autouse=True)
def _clean_counters():
    reset_retries()
    yield
    reset_retries()


def client_for(handler) -> BaseClient:
    transport = httpx.MockTransport(handler)
    base = BaseClient(httpx.AsyncClient(transport=transport))
    base.name = "radarr"
    return base


def flaky(fail_times: int, exc=httpx.ConnectError("refused")):
    """Fails the first `fail_times` calls, then succeeds. Counts attempts."""
    state = {"calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        if state["calls"] <= fail_times:
            raise exc
        return httpx.Response(200, json={"ok": True})

    return handler, state


async def test_get_retries_once_and_succeeds():
    handler, state = flaky(1)
    resp = await client_for(handler)._request("GET", "http://x/api")
    assert resp.status_code == 200
    assert state["calls"] == 2
    assert retry_count("radarr") == 1


async def test_get_gives_up_after_one_retry():
    handler, state = flaky(5)
    with pytest.raises(ServiceUnavailable):
        await client_for(handler)._request("GET", "http://x/api")
    # Two attempts total, not a retry loop.
    assert state["calls"] == 2


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE"])
async def test_writes_are_never_retried(method):
    handler, state = flaky(1)
    with pytest.raises(ServiceUnavailable):
        await client_for(handler)._request(method, "http://x/api")
    assert state["calls"] == 1
    assert retry_count("radarr") == 0


async def test_server_error_is_retried():
    state = {"calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        if state["calls"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={})

    resp = await client_for(handler)._request("GET", "http://x/api")
    assert resp.status_code == 200
    assert state["calls"] == 2


async def test_read_timeout_is_not_retried():
    """The server got the request; a second one only doubles the wait."""
    handler, state = flaky(1, httpx.ReadTimeout("too slow"))
    with pytest.raises(ServiceUnavailable):
        await client_for(handler)._request("GET", "http://x/api")
    assert state["calls"] == 1
    assert retry_count("radarr") == 0


async def test_client_error_is_not_retried():
    """404/401 are answers, not failures — retrying cannot change them."""
    state = {"calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        return httpx.Response(404)

    resp = await client_for(handler)._request("GET", "http://x/api")
    assert resp.status_code == 404
    assert state["calls"] == 1


async def test_retries_are_counted_per_service():
    handler, _ = flaky(1)
    a = client_for(handler)
    b = client_for(flaky(1)[0])
    b.name = "sonarr"
    await a._request("GET", "http://x/api")
    await b._request("GET", "http://y/api")
    assert retry_count("radarr") == 1
    assert retry_count("sonarr") == 1
    assert retry_count("bazarr") == 0


async def test_retries_fall_out_of_the_window(monkeypatch):
    import app.clients.base as base

    handler, _ = flaky(1)
    await client_for(handler)._request("GET", "http://x/api")
    assert retry_count("radarr") == 1

    later = base.time.monotonic() + base.RETRY_WINDOW_SECONDS + 1
    monkeypatch.setattr(base.time, "monotonic", lambda: later)
    assert retry_count("radarr") == 0
