#!/usr/bin/env python3
"""arrdeck host helper: restarts allowlisted docker compose projects on behalf
of arrdeck, so arrdeck itself never needs the docker socket.

arrdeck is reachable from the internet (behind passkeys), and the docker socket
is root on the host; handing it to arrdeck would make any arrdeck bug a host
compromise. This helper is the narrow alternative: it listens on 127.0.0.1 only
(containers reach it at host.docker.internal, the LAN cannot), wants a bearer
token, and can do exactly three things to a fixed list of compose projects —
list their containers, `docker compose restart` and `docker compose up -d`.

With --boot it also repairs the known reboot failure: Docker starts before the
external volume is mounted, the containers exit with "mkdir /Volumes/Data:
permission denied", and nothing brings them back. The helper waits for the
volume, then runs `up -d` in every project that is not fully running.

Stdlib only, Python 3.11+. See README.md next to it for installation.
"""

import argparse
import contextlib
import hmac
import json
import logging
import math
import os
import re
import socketserver
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

VERSION = "1"
DEFAULT_CONFIG = "~/.config/arrdeck-helper/config.json"
DEFAULT_TOKEN = "~/.config/arrdeck-helper/token"
DEFAULT_PORT = 8790
DEFAULT_DOCKER = "/usr/local/bin/docker"
# one action per project per minute: a double tap, or a retry loop somewhere,
# must not turn into a restart storm
ACTION_INTERVAL = 60
PS_TIMEOUT = 30
ACTION_TIMEOUT = 300
BOOT_WAIT = 15 * 60
BOOT_POLL = 5
MAX_BODY = 64 * 1024
ACTIONS = {"restart": ("restart",), "up": ("up", "-d")}
PROJECT_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

log = logging.getLogger("arrdeck-helper")


class ConfigError(Exception):
    pass


class CommandError(Exception):
    pass


def load_config(path: str) -> dict:
    try:
        raw = json.loads(Path(path).expanduser().read_text())
    except (OSError, ValueError) as exc:
        raise ConfigError(f"cannot read config {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError("config must be a JSON object")
    projects = raw.get("projects")
    if not isinstance(projects, dict) or not projects:
        raise ConfigError("config needs a non-empty 'projects' object")
    for name, directory in projects.items():
        if not isinstance(name, str) or not PROJECT_NAME.match(name):
            raise ConfigError(f"bad project name {name!r}")
        if not isinstance(directory, str) or not os.path.isabs(directory):
            raise ConfigError(f"project {name!r} needs an absolute directory")
    port = raw.get("port", DEFAULT_PORT)
    if not isinstance(port, int) or not 1 <= port <= 65535:
        raise ConfigError("port must be an integer 1-65535")
    docker = raw.get("docker", DEFAULT_DOCKER)
    wait_for = raw.get("wait_for", "")
    if not isinstance(docker, str) or not isinstance(wait_for, str):
        raise ConfigError("'docker' and 'wait_for' must be strings")
    return {"port": port, "docker": docker, "projects": dict(projects), "wait_for": wait_for}


def read_token(path: str) -> str:
    """The token, provided only this user can read the file."""
    file = Path(path).expanduser()
    try:
        info = file.stat()
        token = file.read_text().strip()
    except OSError as exc:
        raise ConfigError(f"cannot read token {file}: {exc}") from exc
    if info.st_mode & 0o077:
        raise ConfigError(f"{file} is readable by others; chmod 600 it")
    if info.st_uid != os.getuid():
        raise ConfigError(f"{file} is not owned by this user")
    if len(token) < 16:
        raise ConfigError(f"{file} holds no usable token (openssl rand -hex 32)")
    return token


def check_token(header: str | None, token: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    # bytes, because compare_digest rejects non-ASCII str instead of comparing
    return hmac.compare_digest(header[len("Bearer ") :].strip().encode(), token.encode())


class RateLimiter:
    def __init__(self, interval: float, clock=time.monotonic) -> None:
        self.interval = interval
        self.clock = clock
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, key: str) -> float:
        """0 and records the attempt when allowed, else the seconds left."""
        with self._lock:
            now = self.clock()
            last = self._last.get(key)
            if last is not None and now - last < self.interval:
                return self.interval - (now - last)
            self._last[key] = now
            return 0.0


def parse_ps(stdout: str) -> list[dict]:
    """`docker compose ps --format json`: one object per line on current
    Compose, a single array on older ones."""
    text = stdout.strip()
    if not text:
        return []
    if text.startswith("["):
        rows = json.loads(text)
    else:
        rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    return [
        {
            "name": row.get("Name", ""),
            "service": row.get("Service", ""),
            "state": row.get("State", ""),
            "status": row.get("Status", ""),
            "health": row.get("Health", ""),
        }
        for row in rows
    ]


def _tail(text: str, lines: int = 5) -> str:
    return "\n".join((text or "").strip().splitlines()[-lines:])


class Helper:
    def __init__(self, config: dict, run=subprocess.run, clock=time.monotonic) -> None:
        self.projects: dict[str, str] = config["projects"]
        self.docker: str = config["docker"]
        self.run = run
        self.limiter = RateLimiter(ACTION_INTERVAL, clock)
        self._locks = {name: threading.Lock() for name in self.projects}

    def compose(self, name: str, *args: str, timeout: float) -> subprocess.CompletedProcess:
        # an argument list and a fixed cwd from the config: nothing from the
        # request ever reaches a shell or a path
        return self.run(
            [self.docker, "compose", *args],
            cwd=self.projects[name],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

    def containers(self, name: str) -> list[dict]:
        # --all, or exited containers (the reboot failure) would not be listed
        try:
            proc = self.compose(name, "ps", "--all", "--format", "json", timeout=PS_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise CommandError(str(exc)) from exc
        if proc.returncode != 0:
            raise CommandError(_tail(proc.stderr) or f"exit {proc.returncode}")
        try:
            return parse_ps(proc.stdout)
        except ValueError as exc:
            raise CommandError(f"unreadable compose output: {exc}") from exc

    def listing(self) -> list[dict]:
        out = []
        for name in sorted(self.projects):
            try:
                containers = self.containers(name)
                error = None
            except CommandError as exc:
                containers, error = [], str(exc)
            out.append(
                {
                    "name": name,
                    "running": bool(containers)
                    and all(c["state"] == "running" for c in containers),
                    "containers": containers,
                    "error": error,
                }
            )
        return out

    def act(self, name: str, action: str) -> tuple[int, dict]:
        if name not in self.projects:
            return 404, {"error": f"unknown project {name!r}"}
        if action not in ACTIONS:
            return 404, {"error": f"unknown action {action!r}"}
        wait = self.limiter.wait(name)
        if wait:
            return 429, {"error": "too soon after the last action", "retry_after": math.ceil(wait)}
        log.info("%s %s", action, name)
        with self._locks[name]:
            try:
                proc = self.compose(name, *ACTIONS[action], timeout=ACTION_TIMEOUT)
            except subprocess.TimeoutExpired:
                return 504, {"error": f"{action} took longer than {ACTION_TIMEOUT}s"}
            except OSError as exc:
                return 500, {"error": f"cannot run docker: {exc}"}
        if proc.returncode != 0:
            log.warning("%s %s failed: %s", action, name, _tail(proc.stderr))
            return 502, {"error": _tail(proc.stderr) or f"exit {proc.returncode}"}
        return 200, {"ok": True, "project": name, "action": action}

    def docker_ready(self) -> bool:
        try:
            proc = self.run(
                [self.docker, "info", "--format", "{{.ServerVersion}}"],
                capture_output=True,
                text=True,
                timeout=PS_TIMEOUT,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        return proc.returncode == 0


def is_mounted(path: str, projects: dict[str, str]) -> bool:
    """A mount point, or at least a directory that holds every project under it
    — macOS can leave an empty /Volumes/Data behind that is neither."""
    root = Path(path)
    if not root.is_dir():
        return False
    if os.path.ismount(root):
        return True
    under = [Path(d) for d in projects.values() if Path(d).is_relative_to(root)]
    return bool(under) and all(d.is_dir() for d in under)


def boot(
    helper: Helper,
    wait_for: str,
    mounted=is_mounted,
    sleep=time.sleep,
    clock=time.monotonic,
    deadline: float = BOOT_WAIT,
) -> list[str]:
    """Wait for the volume and the docker daemon, then `up -d` every project
    that is not fully running. Returns the projects it started."""
    end = clock() + deadline
    if wait_for:
        while not mounted(wait_for, helper.projects):
            if clock() >= end:
                log.error("boot: %s never appeared, giving up", wait_for)
                return []
            sleep(BOOT_POLL)
    while not helper.docker_ready():
        if clock() >= end:
            log.error("boot: docker never answered, giving up")
            return []
        sleep(BOOT_POLL)
    started = []
    for name in sorted(helper.projects):
        try:
            containers = helper.containers(name)
        except CommandError as exc:
            log.warning("boot: cannot list %s: %s", name, exc)
            continue
        if containers and all(c["state"] == "running" for c in containers):
            continue
        log.info("boot: %s is not running, bringing it up", name)
        try:
            proc = helper.compose(name, *ACTIONS["up"], timeout=ACTION_TIMEOUT)
        except (OSError, subprocess.TimeoutExpired) as exc:
            log.warning("boot: up %s failed: %s", name, exc)
            continue
        if proc.returncode == 0:
            started.append(name)
        else:
            log.warning("boot: up %s failed: %s", name, _tail(proc.stderr))
    log.info("boot: done, started %s", ", ".join(started) or "nothing")
    return started


class Handler(BaseHTTPRequestHandler):
    server_version = f"arrdeck-helper/{VERSION}"

    def _send(self, status: int, body: dict, headers: dict | None = None) -> None:
        data = json.dumps(body).encode()
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # arrdeck restarting itself: the caller is gone before the answer
            pass

    def _authorised(self) -> bool:
        if check_token(self.headers.get("Authorization"), self.server.token):
            return True
        self._send(401, {"error": "unauthorized"}, {"WWW-Authenticate": "Bearer"})
        return False

    def _segments(self) -> list[str]:
        return [s for s in self.path.split("?", 1)[0].split("/") if s]

    def do_GET(self) -> None:
        if not self._authorised():
            return
        helper: Helper = self.server.helper
        parts = self._segments()
        if parts == ["health"]:
            self._send(200, {"ok": True, "version": VERSION, "projects": len(helper.projects)})
        elif parts == ["projects"]:
            self._send(200, {"projects": helper.listing()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        # nothing is read from a body, but one that was sent is drained so the
        # connection stays in step
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            self._send(413, {"error": "body too large"})
            return
        if length:
            self.rfile.read(length)
        if not self._authorised():
            return
        parts = self._segments()
        if len(parts) != 3 or parts[0] != "projects":
            self._send(404, {"error": "not found"})
            return
        status, body = self.server.helper.act(parts[1], parts[2])
        headers = {"Retry-After": str(body["retry_after"])} if status == 429 else None
        self._send(status, body, headers)

    def log_message(self, format: str, *args) -> None:
        log.info("%s %s", self.address_string(), format % args)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def server_bind(self) -> None:
        # HTTPServer.server_bind does a reverse DNS lookup of the address, which
        # can hang for seconds at boot before the network is up — and the name
        # is never used
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def serve(helper: Helper, token: str, port: int) -> Server:
    # 127.0.0.1 only: containers reach it via host.docker.internal, the LAN cannot
    server = Server(("127.0.0.1", port), Handler)
    server.helper = helper  # type: ignore[attr-defined]
    server.token = token  # type: ignore[attr-defined]
    return server


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--token-file", default=DEFAULT_TOKEN)
    parser.add_argument(
        "--boot", action="store_true", help="bring stopped projects up once the volume is mounted"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(
        stream=sys.stderr, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    try:
        config = load_config(args.config)
        token = read_token(args.token_file)
    except ConfigError as exc:
        log.error("%s", exc)
        return 1
    helper = Helper(config)
    server = serve(helper, token, config["port"])
    log.info("listening on 127.0.0.1:%d for %s", config["port"], ", ".join(sorted(helper.projects)))
    if args.boot:
        threading.Thread(target=boot, args=(helper, config["wait_for"]), daemon=True).start()
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
