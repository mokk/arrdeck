"""Service down/up alerts: one "down" after the threshold, one "back up" after
it, nothing for a blip, and quiet hours defer rather than drop."""

import asyncio

from app.push import Outage, ServiceWatch, get_rules, outage_note, step

MIN = 60
N = 10 * MIN


def run(probes, quiet=None, threshold=N):
    """Drive one service through (minute, ok) probes; returns the alerts."""
    state, alerts = Outage(), []
    for i, (minute, ok) in enumerate(probes):
        is_quiet = bool(quiet and quiet[i])
        state, alert = step(state, ok, minute * MIN, threshold, is_quiet)
        if alert:
            alerts.append((minute, alert[0], round(alert[1] / MIN)))
    return state, alerts


def test_down_is_announced_once_the_threshold_has_passed():
    _, alerts = run([(0, False), (5, False), (9, False), (10, False)])
    assert alerts == [(10, "down", 10)]


def test_a_long_outage_is_announced_only_once():
    _, alerts = run([(m, False) for m in range(0, 120)])
    assert alerts == [(10, "down", 10)]


def test_back_up_follows_a_down_and_says_how_long():
    state, alerts = run([(0, False), (10, False), (11, False), (25, True), (26, True)])
    assert alerts == [(10, "down", 10), (25, "up", 25)]
    assert state == Outage()


def test_flapping_under_the_threshold_sends_nothing():
    probes = []
    for start in range(0, 120, 10):  # down 9 minutes, up 1, forever
        probes += [(start + m, False) for m in range(9)] + [(start + 9, True)]
    state, alerts = run(probes)
    assert alerts == []
    assert state == Outage()


def test_a_new_outage_after_recovery_is_announced_again():
    _, alerts = run([(0, False), (10, False), (12, True), (30, False), (40, False)])
    assert [a[1] for a in alerts] == ["down", "up", "down"]


def test_quiet_hours_defer_the_down_until_they_end():
    probes = [(0, False), (10, False), (20, False), (30, False)]
    _, alerts = run(probes, quiet=[True, True, True, False])
    assert alerts == [(30, "down", 30)]


def test_an_outage_over_before_quiet_hours_end_is_never_announced():
    probes = [(0, False), (15, False), (20, True), (30, True)]
    _, alerts = run(probes, quiet=[True, True, True, False])
    assert alerts == []


def test_a_recovery_during_quiet_hours_is_sent_when_they_end():
    probes = [(0, False), (10, False), (20, True), (30, True), (31, True)]
    state, alerts = run(probes, quiet=[False, False, True, False, False])
    # the duration is the outage's, not the wait for the window to end
    assert alerts == [(10, "down", 10), (30, "up", 20)]
    assert state == Outage()


def test_down_since_is_the_first_failure_and_clears_on_recovery():
    watch = ServiceWatch()
    watch.advance({"radarr": False, "sonarr": True}, 100.0, N, False)
    watch.advance({"radarr": False, "sonarr": True}, 160.0, N, False)
    assert watch.down_since("radarr") == 100.0
    assert watch.down_since("sonarr") is None
    watch.advance({"radarr": True, "sonarr": True}, 220.0, N, False)
    assert watch.down_since("radarr") is None


def test_a_service_no_longer_configured_is_forgotten():
    watch = ServiceWatch()
    watch.advance({"radarr": False}, 0.0, N, False)
    assert watch.advance({}, N + 1, N, False) == []
    assert watch.states == {}


def test_an_announced_outage_survives_a_restart(tmp_path):
    from app.db import SettingsDB

    db = SettingsDB(str(tmp_path / "watch.db"))
    watch = ServiceWatch()
    watch.advance({"radarr": False, "sonarr": False}, 0.0, N, False)
    assert watch.advance({"radarr": False, "sonarr": False}, N, N, False) == [
        ("radarr", "down", N),
        ("sonarr", "down", N),
    ]
    watch.advance({"radarr": False, "sonarr": False, "plex": False}, N + 60, N, False)
    watch.save(db)

    again = ServiceWatch.load(db)
    # no second "down" for what was already announced; plex's clock restarts
    assert set(again.states) == {"radarr", "sonarr"}
    assert again.advance({"radarr": False, "sonarr": True}, 2 * N, N, False) == [
        ("sonarr", "up", 2 * N)
    ]


def test_a_corrupt_saved_state_starts_clean():
    class DB:
        def kv_get(self, key):
            return '{"radarr": {"bogus": 1}}'

    assert ServiceWatch.load(DB()).states == {}


def test_the_note_names_the_service_and_the_minutes():
    down = outage_note("radarr", "down", 12 * MIN + 10)
    assert (down.code, down.title, down.body) == (
        "service_down",
        "Radarr is down",
        "No answer for 12 min",
    )
    assert down.heading == "Radarr" and down.params == {"minutes": 12}
    up = outage_note("qbittorrent", "up", 20)
    assert (up.code, up.title, up.params) == (
        "service_up",
        "qBittorrent is back up",
        {"minutes": 1},
    )


def test_threshold_rule_defaults_and_rejects_out_of_range():
    class DB(dict):
        def kv_get(self, key):
            return self.get(key)

    db = DB()
    assert get_rules(db)["service_down_minutes"] == 10
    db["push_rules"] = '{"service_down_minutes": 3}'
    assert get_rules(db)["service_down_minutes"] == 3
    for junk in ("0", "121", '"5"'):
        db["push_rules"] = f'{{"service_down_minutes": {junk}}}'
        assert get_rules(db)["service_down_minutes"] == 10


def test_one_tick_probes_saves_and_sends(tmp_path, monkeypatch):
    from app import push
    from app.db import SettingsDB

    db = SettingsDB(str(tmp_path / "tick.db"))
    db.kv_set("push_rules", '{"service_down_minutes": 1}')

    class Registry:
        def configured(self):
            return ["radarr", "sonarr"]

        def get(self, name):
            return name

    async def probe(name, client):
        if name == "radarr":
            raise RuntimeError("connection refused")
        return "1.0"

    sent = []
    monkeypatch.setattr(push.watch, "probe_version", probe)
    monkeypatch.setattr(
        push.watch, "_send_all", lambda _db, note, url, tag, key: sent.append((key, url, tag)) or 1
    )
    clock = iter([1000.0, 1100.0])
    monkeypatch.setattr(push.watch.time, "time", lambda: next(clock))

    watch = ServiceWatch()
    asyncio.run(push.watch_once(db, Registry(), watch))
    assert sent == [] and watch.down_since("radarr") == 1000.0
    asyncio.run(push.watch_once(db, Registry(), watch))
    assert sent == [("service_down", "/settings/system", "arrdeck:service:radarr")]
    assert set(ServiceWatch.load(db).states) == {"radarr"}


def test_the_status_endpoint_reports_down_since(monkeypatch):
    from fastapi.testclient import TestClient

    import app.api.v1.system as system
    from app.main import app

    async def probe(name, client):
        raise system.ServiceUnavailable(name, "refused")

    class Registry:
        def configured(self):
            return ["radarr"]

        def get(self, name):
            return name

    with TestClient(app, headers={"host": "localhost"}) as c:
        monkeypatch.setattr(system, "probe_version", probe)
        monkeypatch.setattr(app.state, "registry", Registry())
        monkeypatch.setattr(app.state, "watch", ServiceWatch({"radarr": Outage(since=0.0)}))
        row = c.get("/api/v1/status").json()[0]
    assert row["ok"] is False
    assert row["down_since"].startswith("1970-01-01T00:00:00")


def test_the_helper_stays_out_of_the_service_lists_clients_render():
    # installed iOS builds decode service names as a fixed set
    from app.db import INFRASTRUCTURE, LISTED_SERVICES, SERVICES

    assert "helper" in SERVICES and "helper" in INFRASTRUCTURE
    assert "helper" not in LISTED_SERVICES
    assert [s for s in SERVICES if s != "helper"] == LISTED_SERVICES
