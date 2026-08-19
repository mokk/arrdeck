import pytest
from fastapi.testclient import TestClient

from app.config import get_settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "test.db"))
    get_settings.cache_clear()
    import app.main as main

    with TestClient(main.app) as c:
        yield c
    get_settings.cache_clear()


def hook_token(client) -> str:
    from app.webhooks import token

    return token(client.app.state.db)


def test_normal_api_is_guarded_from_a_non_lan_host(client):
    # TestClient sends Host: testserver — neither a private IP nor localhost
    assert client.get("/api/v1/services").status_code == 401


def test_hook_accepts_a_valid_token_without_a_session(client):
    resp = client.post(
        f"/api/v1/hooks/{hook_token(client)}/radarr",
        json={"eventType": "Download", "movie": {"id": 1, "title": "Inception", "year": 2010}},
    )
    assert resp.status_code == 204


def test_hook_rejects_a_bad_token(client):
    resp = client.post("/api/v1/hooks/not-the-token/radarr", json={"eventType": "Test"})
    assert resp.status_code == 404


def test_hook_rejects_an_unknown_app(client):
    resp = client.post(f"/api/v1/hooks/{hook_token(client)}/plex", json={"eventType": "Test"})
    assert resp.status_code == 404


def test_hook_rejects_a_non_object_body(client):
    resp = client.post(f"/api/v1/hooks/{hook_token(client)}/sonarr", json=[1, 2, 3])
    assert resp.status_code == 422


def test_hook_records_that_webhooks_are_alive(client):
    from app.push import WEBHOOK_SEEN_KEY

    client.post(f"/api/v1/hooks/{hook_token(client)}/radarr", json={"eventType": "Rename"})
    assert client.app.state.db.kv_get(WEBHOOK_SEEN_KEY) is not None


def test_dedupe_suppresses_the_second_delivery(client):
    db = client.app.state.db
    assert db.notified_add("abc", 1000, 3600) is True
    assert db.notified_add("abc", 1000, 3600) is False
    # once the entry ages past the ttl it stops suppressing
    assert db.notified_add("abc", 1000 + 3601, 3600) is True
