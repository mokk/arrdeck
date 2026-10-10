"""The host helper (host-helper/arrdeck_helper.py): it holds the docker socket's
power on arrdeck's behalf, so the token, the allowlist and the rate limit are
the security boundary and are pinned here. Docker itself is never run."""

import importlib.util
import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "host-helper" / "arrdeck_helper.py"
_spec = importlib.util.spec_from_file_location("arrdeck_helper", SCRIPT)
helper_mod = importlib.util.module_from_spec(_spec)
sys.modules["arrdeck_helper"] = helper_mod
_spec.loader.exec_module(helper_mod)

TOKEN = "a" * 64
PROJECTS = {"radarr": "/Volumes/Data/docker/radarr", "sonarr": "/Volumes/Data/docker/sonarr"}


def ps_line(name, state="running"):
    return json.dumps({"Name": name, "Service": name, "State": state, "Status": "Up", "Health": ""})


class FakeRun:
    """Stands in for subprocess.run and records every command."""

    def __init__(self, ps=None, returncode=0):
        self.calls = []
        self.ps = ps or {}
        self.returncode = returncode

    def __call__(self, cmd, **kwargs):
        self.calls.append((cmd, kwargs))
        assert "shell" not in kwargs
        stdout = ""
        if cmd[1:3] == ["compose", "ps"]:
            stdout = self.ps.get(kwargs["cwd"], "")
        return subprocess.CompletedProcess(cmd, self.returncode, stdout, "boom\n")


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def make(run=None, clock=None):
    config = {"port": 0, "docker": "/usr/local/bin/docker", "projects": dict(PROJECTS)}
    return helper_mod.Helper(config, run=run or FakeRun(), clock=clock or Clock())


# --- token --------------------------------------------------------------


def test_only_the_exact_bearer_token_passes():
    assert helper_mod.check_token(f"Bearer {TOKEN}", TOKEN)
    assert not helper_mod.check_token(f"Bearer {TOKEN[:-1]}b", TOKEN)
    assert not helper_mod.check_token(TOKEN, TOKEN)  # no scheme
    assert not helper_mod.check_token(f"Basic {TOKEN}", TOKEN)
    assert not helper_mod.check_token(None, TOKEN)
    assert not helper_mod.check_token("Bearer ", TOKEN)
    assert not helper_mod.check_token("Bearer ø", TOKEN)  # non-ASCII must not raise


def test_a_token_file_readable_by_others_is_refused(tmp_path):
    token = tmp_path / "token"
    token.write_text(TOKEN + "\n")
    token.chmod(0o644)
    with pytest.raises(helper_mod.ConfigError, match="chmod 600"):
        helper_mod.read_token(str(token))
    token.chmod(0o600)
    assert helper_mod.read_token(str(token)) == TOKEN


def test_a_short_token_is_refused(tmp_path):
    token = tmp_path / "token"
    token.write_text("secret")
    token.chmod(0o600)
    with pytest.raises(helper_mod.ConfigError):
        helper_mod.read_token(str(token))


def test_config_rejects_odd_names_and_relative_dirs(tmp_path):
    path = tmp_path / "config.json"
    for projects in ({"../etc": "/x"}, {"radarr": "relative/dir"}, {}):
        path.write_text(json.dumps({"projects": projects}))
        with pytest.raises(helper_mod.ConfigError):
            helper_mod.load_config(str(path))
    path.write_text(json.dumps({"projects": PROJECTS}))
    config = helper_mod.load_config(str(path))
    assert config["port"] == 8790 and config["docker"] == "/usr/local/bin/docker"


# --- allowlist and commands ----------------------------------------------


def test_only_allowlisted_projects_and_actions_run():
    run = FakeRun()
    helper = make(run)
    assert helper.act("plex", "restart")[0] == 404
    assert helper.act("radarr", "down")[0] == 404
    assert helper.act("radarr/../x", "restart")[0] == 404
    assert run.calls == []


def test_restart_and_up_build_an_argument_list_in_the_project_dir():
    run = FakeRun()
    clock = Clock()
    helper = make(run, clock)
    assert helper.act("radarr", "restart") == (
        200,
        {"ok": True, "project": "radarr", "action": "restart"},
    )
    clock.now += 61
    assert helper.act("radarr", "up")[0] == 200
    (restart, kw1), (up, kw2) = run.calls
    assert restart == ["/usr/local/bin/docker", "compose", "restart"]
    assert up == ["/usr/local/bin/docker", "compose", "up", "-d"]
    assert kw1["cwd"] == kw2["cwd"] == "/Volumes/Data/docker/radarr"
    assert kw1["timeout"] > 0


def test_a_failing_command_reports_its_error():
    helper = make(FakeRun(returncode=1))
    status, body = helper.act("sonarr", "restart")
    assert status == 502 and body["error"] == "boom"


def test_a_timeout_is_a_504():
    def slow(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    assert make(slow).act("radarr", "restart")[0] == 504


# --- rate limit ----------------------------------------------------------


def test_one_action_per_project_per_minute():
    clock = Clock()
    helper = make(FakeRun(), clock)
    assert helper.act("radarr", "restart")[0] == 200
    clock.now += 10
    status, body = helper.act("radarr", "up")
    assert status == 429 and body["retry_after"] == 50
    assert helper.act("sonarr", "restart")[0] == 200  # per project
    clock.now += 50
    assert helper.act("radarr", "restart")[0] == 200


# --- listing -------------------------------------------------------------


def test_listing_reads_ndjson_and_flags_stopped_projects():
    run = FakeRun(
        ps={
            PROJECTS["radarr"]: ps_line("radarr") + "\n",
            PROJECTS["sonarr"]: ps_line("sonarr", "exited") + "\n" + ps_line("sidecar") + "\n",
        }
    )
    rows = {r["name"]: r for r in make(run).listing()}
    assert rows["radarr"]["running"] and rows["radarr"]["containers"][0]["state"] == "running"
    assert not rows["sonarr"]["running"] and len(rows["sonarr"]["containers"]) == 2
    cmd, _kwargs = run.calls[0]
    assert cmd[1:] == ["compose", "ps", "--all", "--format", "json"]


def test_an_older_compose_array_is_understood_too():
    rows = helper_mod.parse_ps("[" + ps_line("a") + "," + ps_line("b", "exited") + "]")
    assert [r["state"] for r in rows] == ["running", "exited"]


# --- boot ----------------------------------------------------------------


def test_boot_waits_for_the_volume_then_starts_what_is_down():
    run = FakeRun(
        ps={PROJECTS["radarr"]: ps_line("radarr", "exited"), PROJECTS["sonarr"]: ps_line("sonarr")}
    )
    helper = make(run)
    mounts = iter([False, False, True])
    sleeps = []
    started = helper_mod.boot(
        helper,
        "/Volumes/Data",
        mounted=lambda path, projects: next(mounts),
        sleep=sleeps.append,
    )
    assert started == ["radarr"]
    assert len(sleeps) == 2
    ups = [(c, kw["cwd"]) for c, kw in run.calls if c[2:] == ["up", "-d"]]
    assert ups == [(["/usr/local/bin/docker", "compose", "up", "-d"], PROJECTS["radarr"])]


def test_boot_gives_up_when_the_volume_never_comes():
    run = FakeRun()
    clock = Clock()

    def sleep(seconds):
        clock.now += seconds

    started = helper_mod.boot(
        make(run, clock),
        "/Volumes/Data",
        mounted=lambda path, projects: False,
        sleep=sleep,
        clock=clock,
        deadline=60,
    )
    assert started == [] and run.calls == []


def test_a_project_with_no_containers_at_all_is_brought_up():
    run = FakeRun()  # ps prints nothing
    started = helper_mod.boot(make(run), "", mounted=lambda *a: True, sleep=lambda s: None)
    assert started == ["radarr", "sonarr"]


def test_the_mount_check_wants_a_mount_or_the_project_dirs(tmp_path):
    projects = {"radarr": str(tmp_path / "radarr")}
    assert not helper_mod.is_mounted(str(tmp_path / "missing"), projects)
    assert not helper_mod.is_mounted(str(tmp_path), projects)  # empty placeholder dir
    os.mkdir(tmp_path / "radarr")
    assert helper_mod.is_mounted(str(tmp_path), projects)


# --- over HTTP -------------------------------------------------------------


def test_the_server_requires_the_token_and_routes_actions():
    run = FakeRun(ps={PROJECTS["radarr"]: ps_line("radarr")})
    server = helper_mod.serve(make(run), TOKEN, 0)
    port = server.server_address[1]
    assert server.server_address[0] == "127.0.0.1"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def call(method, path, token=TOKEN):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status, json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    try:
        assert call("GET", "/health", token=None)[0] == 401
        assert call("GET", "/projects", token="wrong-token-wrong-token")[0] == 401
        assert call("POST", "/projects/radarr/restart", token=None)[0] == 401
        assert call("GET", "/health") == (200, {"ok": True, "version": "1", "projects": 2})
        status, body = call("GET", "/projects")
        assert status == 200 and body["projects"][0]["name"] == "radarr"
        assert call("POST", "/projects/radarr/restart")[0] == 200
        assert call("POST", "/projects/radarr/restart")[0] == 429
        assert call("POST", "/projects/plex/restart")[0] == 404
        assert call("POST", "/projects/radarr")[0] == 404
    finally:
        server.shutdown()
        server.server_close()
    restarts = [c for c, _ in run.calls if c[2:] == ["restart"]]
    assert len(restarts) == 1  # the 401s and the 429 ran nothing
