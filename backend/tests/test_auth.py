from types import SimpleNamespace

from app.api.v1.auth import _code_ok, _setup_code, is_lan


class FakeDB:
    def __init__(self):
        self.store = {}

    def kv_get(self, key):
        return self.store.get(key)

    def kv_set(self, key, value):
        self.store[key] = value


def req(host: str, db=None):
    app = SimpleNamespace(state=SimpleNamespace(db=db))
    return SimpleNamespace(headers={"host": host}, app=app)


def test_private_ip_hosts_are_trusted():
    assert is_lan(req("10.0.0.154:3500"))
    assert is_lan(req("192.168.1.20:3500"))
    assert is_lan(req("127.0.0.1:3500"))
    assert is_lan(req("localhost:3500"))


def test_domain_hosts_require_auth():
    assert not is_lan(req("deck.thrawn.dk"))
    assert not is_lan(req("deck.thrawn.dk:443"))
    assert not is_lan(req(""))


def test_public_ip_hosts_require_auth():
    assert not is_lan(req("87.104.249.203:3500"))


def test_setup_code_is_stable_and_matches():
    db = FakeDB()
    code = _setup_code(db)
    assert _setup_code(db) == code
    request = req("deck.thrawn.dk", db)
    assert _code_ok(request, code)
    assert _code_ok(request, code.lower())
    assert not _code_ok(request, "WRONGCODE")
    assert not _code_ok(request, "")


# --- brute-force throttling ----------------------------------------------


def test_failures_below_the_free_allowance_cost_nothing():
    from app.api.v1.auth import FREE_ATTEMPTS, _lockout_remaining, _record_failure

    db = FakeDB()
    for _ in range(FREE_ATTEMPTS):
        _record_failure(db)
    assert _lockout_remaining(db) == 0.0


def test_lockout_grows_with_each_further_failure():
    from app.api.v1.auth import FREE_ATTEMPTS, _lockout_remaining, _record_failure

    db = FakeDB()
    for _ in range(FREE_ATTEMPTS + 1):
        _record_failure(db)
    first = _lockout_remaining(db)
    assert 0 < first <= 2
    _record_failure(db)
    assert _lockout_remaining(db) > first


def test_lockout_is_capped():
    import json

    from app.api.v1.auth import FAILURES_KEY, MAX_LOCKOUT, _lockout_remaining

    db = FakeDB()
    db.kv_set(FAILURES_KEY, json.dumps([500, __import__("time").time()]))
    assert _lockout_remaining(db) <= MAX_LOCKOUT


def test_a_quiet_period_forgets_past_failures():
    import json
    import time

    from app.api.v1.auth import FAILURE_WINDOW, FAILURES_KEY, _lockout_remaining

    db = FakeDB()
    db.kv_set(FAILURES_KEY, json.dumps([50, time.time() - FAILURE_WINDOW - 1]))
    assert _lockout_remaining(db) == 0.0


def test_success_clears_the_counter():
    from app.api.v1.auth import _clear_failures, _lockout_remaining, _record_failure

    db = FakeDB()
    for _ in range(20):
        _record_failure(db)
    assert _lockout_remaining(db) > 0
    _clear_failures(db)
    assert _lockout_remaining(db) == 0.0


def test_lan_requests_are_never_throttled():
    import json
    import time

    from app.api.v1.auth import FAILURES_KEY, _check_throttle

    db = FakeDB()
    db.kv_set(FAILURES_KEY, json.dumps([500, time.time()]))
    _check_throttle(req("10.0.0.154:3500", db))  # must not raise
    import pytest

    with pytest.raises(Exception):
        _check_throttle(req("deck.thrawn.dk", db))


# --- sessions ------------------------------------------------------------


def test_sessions_can_be_listed_and_revoked(tmp_path):
    from app.db import SettingsDB

    db = SettingsDB(str(tmp_path / "s.db"))
    db.session_add("a" * 64, 1000)
    db.session_add("b" * 64, 1001)
    db.session_add("c" * 64, 1002)
    assert len(db.session_list()) == 3
    assert db.session_delete_others("b" * 64) == 2
    remaining = db.session_list()
    assert len(remaining) == 1 and remaining[0]["token_hash"] == "b" * 64


def test_a_session_can_be_revoked_by_hash_prefix(tmp_path):
    from app.db import SettingsDB

    db = SettingsDB(str(tmp_path / "s2.db"))
    db.session_add("a" * 64, 1000)
    db.session_add("b" * 64, 1001)
    assert db.session_delete_by_prefix("a" * 16) == 1
    assert [s["token_hash"] for s in db.session_list()] == ["b" * 64]
