"""Display preferences on the server: one shared set, last write wins."""

import time

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    get_settings.cache_clear()
    import app.main as main

    # a LAN Host skips sign-in, as in the other API tests
    with TestClient(main.app, headers={"host": "localhost"}) as c:
        yield c
    get_settings.cache_clear()


def put(client, values, updated_at):
    return client.put("/api/v1/prefs", json={"values": values, "updated_at": updated_at})


def test_nothing_stored_reads_as_empty(client):
    resp = client.get("/api/v1/prefs")
    assert resp.status_code == 200
    assert resp.json() == {"values": {}, "updated_at": 0}


def test_a_write_reads_back(client):
    values = {"palette": "nord", "tabOrder": ["/movies", "/shows"], "layout.movies": "list"}
    resp = put(client, values, 5000)
    assert resp.status_code == 200
    assert resp.json() == {"values": values, "updated_at": 5000}
    assert client.get("/api/v1/prefs").json() == {"values": values, "updated_at": 5000}


def test_a_newer_write_replaces_the_whole_set(client):
    put(client, {"a": 1, "b": 2}, 1000)
    assert put(client, {"a": 3}, 2000).json() == {"values": {"a": 3}, "updated_at": 2000}


def test_a_stale_write_is_ignored_and_the_stored_set_comes_back(client):
    put(client, {"palette": "nord"}, 2000)
    resp = put(client, {"palette": "dracula"}, 1000)
    assert resp.status_code == 200
    assert resp.json() == {"values": {"palette": "nord"}, "updated_at": 2000}
    assert client.get("/api/v1/prefs").json()["values"] == {"palette": "nord"}


def test_a_retry_of_the_same_write_is_accepted(client):
    put(client, {"a": 1}, 2000)
    assert put(client, {"a": 2}, 2000).json()["values"] == {"a": 2}


def test_a_future_timestamp_is_clamped_to_the_server_clock(client):
    before = int(time.time() * 1000)
    stored = put(client, {"a": 1}, before + 10 * 24 * 3600 * 1000).json()["updated_at"]
    assert before <= stored <= int(time.time() * 1000)
    # so a device with a correct clock still gets its turn
    assert put(client, {"a": 2}, stored + 1).json()["values"] == {"a": 2}


def test_unknown_keys_are_kept_as_they_are(client):
    values = {"someFutureThing": True, "ratio": 1.5, "none": None, "name": "x"}
    assert put(client, values, 1000).json()["values"] == values


@pytest.mark.parametrize(
    "values",
    [
        {"nested": {"a": 1}},
        {"list_of_numbers": [1, 2]},
        {"list_of_lists": [["a"]]},
        {"list_of_objects": [{"a": "b"}]},
        {"": "empty key"},
        {"k" * 65: "long key"},
        {f"k{i}": i for i in range(101)},
        {"big": "x" * 17_000},
        {"many": ["x" * 100] * 200},
    ],
)
def test_anything_but_flat_scalars_and_string_arrays_is_rejected(client, values):
    assert put(client, values, 1000).status_code == 422
    assert client.get("/api/v1/prefs").json()["updated_at"] == 0


def test_limits_are_inclusive(client):
    assert put(client, {f"k{i}": i for i in range(100)}, 1000).status_code == 200
    assert put(client, {"k" * 64: "x"}, 2000).status_code == 200


def test_malformed_bodies_are_rejected(client):
    assert client.put("/api/v1/prefs", json={"values": [], "updated_at": 1}).status_code == 422
    assert client.put("/api/v1/prefs", json={"values": {}}).status_code == 422
    assert put(client, {}, -1).status_code == 422


def test_a_corrupt_stored_value_reads_as_empty(client):
    client.app.state.db.kv_set("display_prefs", "{not json")
    assert client.get("/api/v1/prefs").json() == {"values": {}, "updated_at": 0}
    # and does not block the next write
    assert put(client, {"a": 1}, 1000).status_code == 200


def test_it_is_behind_the_normal_sign_in(client):
    # Host: testserver is neither localhost nor a private IP, so it is not the LAN
    resp = client.get("/api/v1/prefs", headers={"host": "testserver"})
    assert resp.status_code == 401
