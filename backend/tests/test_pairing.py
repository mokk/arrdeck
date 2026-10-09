"""Pairing hands the iOS app a session of its own: a signed-in browser mints a
one-time code bound to the app's PKCE challenge, and the app trades the code
plus its verifier for a cookie. These pin the parts that keep it from being a
way in: minting needs a session, and a code is single-use, short-lived and
worthless without the verifier.
"""

import base64
import hashlib
import secrets
import time

import pytest
from fastapi.testclient import TestClient

from app.api.v1 import auth
from app.db import SettingsDB
from app.main import app

HOST = {"host": "deck.example.com"}


def challenge_for(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")


@pytest.fixture
def client(tmp_path):
    store = SettingsDB(str(tmp_path / "s.db"))
    with TestClient(app, headers=HOST) as c:
        # swapped after startup (the lifespan builds its own) and restored after:
        # `app` is module-level, see test_passkey_hosts
        original = getattr(app.state, "db", None)
        app.state.db = store
        auth._pair_codes.clear()
        try:
            yield c
        finally:
            app.state.db = original
            auth._pair_codes.clear()


def signed_in(client) -> None:
    token = secrets.token_urlsafe(32)
    app.state.db.session_add(auth._token_hash(token), int(time.time()))
    client.cookies.set(auth.SESSION_COOKIE, token)


def mint(client, verifier="v" * 43) -> str:
    resp = client.post("/api/v1/auth/pair/code", json={"challenge": challenge_for(verifier)})
    assert resp.status_code == 200, resp.text
    return resp.json()["code"]


def test_minting_needs_a_session(client):
    resp = client.post("/api/v1/auth/pair/code", json={"challenge": challenge_for("x")})
    assert resp.status_code == 401


def test_a_malformed_challenge_is_refused(client):
    signed_in(client)
    resp = client.post("/api/v1/auth/pair/code", json={"challenge": "not-a-hash"})
    assert resp.status_code == 400
    # the right length, but letters str.isalnum() would have let through
    resp = client.post("/api/v1/auth/pair/code", json={"challenge": "é" * 43})
    assert resp.status_code == 400


def test_code_and_verifier_buy_a_session(client):
    signed_in(client)
    code = mint(client, "verifier-" * 5)
    client.cookies.clear()
    resp = client.post(
        "/api/v1/auth/pair/exchange", json={"code": code, "verifier": "verifier-" * 5}
    )
    assert resp.status_code == 200
    assert resp.cookies.get(auth.SESSION_COOKIE)
    assert client.get("/api/v1/auth/state").json()["authenticated"] is True


def test_a_code_works_once(client):
    signed_in(client)
    code = mint(client)
    body = {"code": code, "verifier": "v" * 43}
    assert client.post("/api/v1/auth/pair/exchange", json=body).status_code == 200
    assert client.post("/api/v1/auth/pair/exchange", json=body).status_code == 401


def test_a_code_is_useless_without_the_verifier(client):
    signed_in(client)
    code = mint(client)
    wrong = {"code": code, "verifier": "w" * 43}
    assert client.post("/api/v1/auth/pair/exchange", json=wrong).status_code == 401
    # and the failed attempt spent it
    right = {"code": code, "verifier": "v" * 43}
    assert client.post("/api/v1/auth/pair/exchange", json=right).status_code == 401


def test_an_expired_code_fails(client, monkeypatch):
    signed_in(client)
    code = mint(client)
    monkeypatch.setattr(auth.time, "time", lambda: 10**12)
    resp = client.post("/api/v1/auth/pair/exchange", json={"code": code, "verifier": "v" * 43})
    assert resp.status_code == 401


def test_wrong_codes_count_toward_the_lockout(client):
    for _ in range(auth.FREE_ATTEMPTS + 1):
        client.post("/api/v1/auth/pair/exchange", json={"code": "guess", "verifier": "v"})
    resp = client.post("/api/v1/auth/pair/exchange", json={"code": "guess", "verifier": "v"})
    assert resp.status_code == 429
