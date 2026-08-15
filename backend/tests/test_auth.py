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
