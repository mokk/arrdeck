"""A passkey only works on the hostname it was created on.

The login challenge used to offer every credential on every host, so a key
registered on the LAN address was offered over the domain, the browser found
nothing that matched, and the error said only "no passkeys registered yet". These
pin the filtering — and, more importantly, pin that it cannot lock anyone out.
"""

import time

import pytest
from fastapi.testclient import TestClient

from app.db import SettingsDB
from app.main import app


@pytest.fixture
def db(tmp_path):
    return SettingsDB(str(tmp_path / "settings.db"))


def add(db, name: str, rp_id: str | None) -> None:
    db.cred_add(f"cred-{name}", "pubkey", name, int(time.time()), rp_id)


def test_a_credential_is_offered_on_the_host_it_was_made_on(db):
    add(db, "domain-key", "deck.example.com")
    assert [c["name"] for c in db.cred_list("deck.example.com")] == ["domain-key"]


def test_a_credential_is_withheld_from_other_hosts(db):
    add(db, "lan-key", "10.0.0.154")
    assert db.cred_list("deck.example.com") == []


def test_a_legacy_credential_with_no_recorded_host_is_offered_everywhere(db):
    """The lock-out guard. Anyone whose only passkey predates the rp_id column
    would be unable to sign in anywhere if these were filtered out."""
    add(db, "legacy", None)
    assert [c["name"] for c in db.cred_list("deck.example.com")] == ["legacy"]
    assert [c["name"] for c in db.cred_list("10.0.0.154")] == ["legacy"]


def test_the_unfiltered_list_still_returns_everything(db):
    """The Manage screen lists every passkey, including ones for other hosts, so
    they can be seen and deleted."""
    add(db, "lan-key", "10.0.0.154")
    add(db, "domain-key", "deck.example.com")
    add(db, "legacy", None)
    assert len(db.cred_list()) == 3


def test_hosts_do_not_bleed_into_each_other(db):
    add(db, "lan-key", "10.0.0.154")
    add(db, "domain-key", "deck.example.com")
    assert [c["name"] for c in db.cred_list("10.0.0.154")] == ["lan-key"]
    assert [c["name"] for c in db.cred_list("deck.example.com")] == ["domain-key"]


def login_options_against(tmp_path, creds: list[tuple[str, str | None]]) -> dict:
    """Call the real endpoint with a throwaway store.

    The store is swapped *after* entering the client: the app's lifespan builds
    its own db on startup, so patching beforehand is overwritten.
    """
    store = SettingsDB(str(tmp_path / "s.db"))
    for name, rp in creds:
        add(store, name, rp)
    with TestClient(app, headers={"host": "deck.example.com"}) as client:
        # Restored afterwards: `app` is module-level, so leaving a throwaway
        # store attached leaks into every later test in the session — which hung
        # the suite when it was left in place.
        original = getattr(app.state, "db", None)
        app.state.db = store
        try:
            resp = client.post("/api/v1/auth/login/options")
        finally:
            app.state.db = original
    return {"status": resp.status_code, "body": resp.json()}


def test_the_challenge_names_the_host_when_nothing_matches(tmp_path):
    """ "No passkeys registered yet" was the message even when several were — it
    just could not use any of them here. Naming the host makes it diagnosable."""
    out = login_options_against(tmp_path, [("lan-key", "10.0.0.154")])
    assert out["status"] == 400
    assert "deck.example.com" in out["body"]["detail"]


def test_an_empty_store_still_says_nothing_is_registered(tmp_path):
    """Distinct from the case above: there is nothing to fix by switching host."""
    out = login_options_against(tmp_path, [])
    assert out["status"] == 400
    assert out["body"]["detail"] == "no passkeys registered yet"


def test_a_matching_credential_produces_a_challenge_for_this_host(tmp_path):
    out = login_options_against(tmp_path, [("domain-key", "deck.example.com")])
    assert out["status"] == 200
    assert out["body"]["rpId"] == "deck.example.com"
    assert len(out["body"]["allowCredentials"]) == 1


def test_a_legacy_credential_still_produces_a_challenge(tmp_path):
    """The lock-out guard again, this time through the endpoint."""
    out = login_options_against(tmp_path, [("legacy", None)])
    assert out["status"] == 200
    assert len(out["body"]["allowCredentials"]) == 1


def test_registration_records_the_host_it_happened_on(db):
    """Without this the filtering has nothing to filter on, and every new
    credential would behave like a legacy one."""
    add(db, "made-on-domain", "deck.example.com")
    stored = db.cred_list()[0]
    assert stored["rp_id"] == "deck.example.com"
