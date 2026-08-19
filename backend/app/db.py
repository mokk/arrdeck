import sqlite3
import threading
from pathlib import Path

SERVICES = ["radarr", "sonarr", "prowlarr", "qbittorrent", "transmission", "overseerr"]
EMPTY = {"url": "", "api_key": "", "username": "", "password": ""}


class SettingsDB:
    """Tiny sqlite-backed store for per-service connection settings."""

    def __init__(self, path: str) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS service_settings (
                    service TEXT PRIMARY KEY,
                    url TEXT NOT NULL DEFAULT '',
                    api_key TEXT NOT NULL DEFAULT '',
                    username TEXT NOT NULL DEFAULT '',
                    password TEXT NOT NULL DEFAULT ''
                )"""
            )
            self._conn.execute(
                "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS credentials (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    credential_id TEXT UNIQUE NOT NULL,
                    public_key TEXT NOT NULL,
                    sign_count INTEGER NOT NULL DEFAULT 0,
                    name TEXT NOT NULL DEFAULT '',
                    created INTEGER NOT NULL
                )"""
            )
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    created INTEGER NOT NULL,
                    last_used INTEGER NOT NULL
                )"""
            )
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS push_subscriptions (
                    endpoint TEXT PRIMARY KEY,
                    data TEXT NOT NULL
                )"""
            )
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS notified (
                    key TEXT PRIMARY KEY,
                    ts INTEGER NOT NULL
                )"""
            )
            self._conn.execute(
                """CREATE TABLE IF NOT EXISTS stats_samples (
                    ts INTEGER PRIMARY KEY,
                    movies INTEGER NOT NULL DEFAULT 0,
                    series INTEGER NOT NULL DEFAULT 0,
                    episode_files INTEGER NOT NULL DEFAULT 0,
                    library_bytes INTEGER NOT NULL DEFAULT 0,
                    torrents_qbit INTEGER NOT NULL DEFAULT 0,
                    torrents_tm INTEGER NOT NULL DEFAULT 0,
                    indexer_grabs INTEGER NOT NULL DEFAULT 0,
                    indexer_queries INTEGER NOT NULL DEFAULT 0
                )"""
            )
            self._conn.commit()

    def all(self) -> dict[str, dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT service, url, api_key, username, password FROM service_settings"
            ).fetchall()
        conf = {s: dict(EMPTY) for s in SERVICES}
        for service, url, api_key, username, password in rows:
            if service in conf:
                conf[service] = {
                    "url": url,
                    "api_key": api_key,
                    "username": username,
                    "password": password,
                }
        return conf

    def upsert(self, service: str, values: dict) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO service_settings (service, url, api_key, username, password)"
                " VALUES (?, ?, ?, ?, ?)"
                " ON CONFLICT(service) DO UPDATE SET url=excluded.url,"
                " api_key=excluded.api_key, username=excluded.username,"
                " password=excluded.password",
                (
                    service,
                    values.get("url", ""),
                    values.get("api_key", ""),
                    values.get("username", ""),
                    values.get("password", ""),
                ),
            )
            self._conn.commit()

    STATS_COLUMNS = [
        "ts", "movies", "series", "episode_files", "library_bytes",
        "torrents_qbit", "torrents_tm", "indexer_grabs", "indexer_queries",
    ]

    def insert_sample(self, sample: dict) -> None:
        cols = ", ".join(self.STATS_COLUMNS)
        placeholders = ", ".join("?" for _ in self.STATS_COLUMNS)
        with self._lock:
            self._conn.execute(
                f"INSERT OR REPLACE INTO stats_samples ({cols}) VALUES ({placeholders})",
                tuple(sample.get(c, 0) for c in self.STATS_COLUMNS),
            )
            # keep a year of samples
            self._conn.execute(
                "DELETE FROM stats_samples WHERE ts < ?",
                (sample["ts"] - 365 * 86400,),
            )
            self._conn.commit()

    def last_sample_ts(self) -> int:
        with self._lock:
            row = self._conn.execute("SELECT MAX(ts) FROM stats_samples").fetchone()
        return row[0] or 0

    def samples_since(self, since_ts: int) -> list[dict]:
        cols = ", ".join(self.STATS_COLUMNS)
        with self._lock:
            rows = self._conn.execute(
                f"SELECT {cols} FROM stats_samples WHERE ts >= ? ORDER BY ts",
                (since_ts,),
            ).fetchall()
        return [dict(zip(self.STATS_COLUMNS, r)) for r in rows]

    def kv_get(self, key: str) -> str | None:
        with self._lock:
            row = self._conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    def kv_set(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO kv (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )
            self._conn.commit()

    def push_add(self, endpoint: str, data: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO push_subscriptions (endpoint, data) VALUES (?, ?)",
                (endpoint, data),
            )
            self._conn.commit()

    def push_remove(self, endpoint: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
            self._conn.commit()

    def notified_add(self, key: str, now: int, ttl: int) -> bool:
        """Record a delivered notification. False when it was already recorded —
        the webhook and the history poller both see the same import."""
        with self._lock:
            self._conn.execute("DELETE FROM notified WHERE ts < ?", (now - ttl,))
            cur = self._conn.execute(
                "INSERT OR IGNORE INTO notified (key, ts) VALUES (?, ?)", (key, now)
            )
            self._conn.commit()
            return cur.rowcount > 0

    def push_all(self) -> list[str]:
        with self._lock:
            rows = self._conn.execute("SELECT data FROM push_subscriptions").fetchall()
        return [r[0] for r in rows]

    def cred_add(self, credential_id: str, public_key: str, name: str, created: int) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO credentials (credential_id, public_key, sign_count, name, created)"
                " VALUES (?, ?, 0, ?, ?)",
                (credential_id, public_key, name, created),
            )
            self._conn.commit()

    def cred_list(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, credential_id, public_key, sign_count, name, created FROM credentials"
            ).fetchall()
        keys = ["id", "credential_id", "public_key", "sign_count", "name", "created"]
        return [dict(zip(keys, r)) for r in rows]

    def cred_delete(self, cred_id: int) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM credentials WHERE id = ?", (cred_id,))
            self._conn.commit()

    def cred_update_count(self, credential_id: str, sign_count: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE credentials SET sign_count = ? WHERE credential_id = ?",
                (sign_count, credential_id),
            )
            self._conn.commit()

    def session_add(self, token_hash: str, now: int) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO sessions (token_hash, created, last_used) VALUES (?, ?, ?)",
                (token_hash, now, now),
            )
            # sessions older than a year get pruned
            self._conn.execute("DELETE FROM sessions WHERE last_used < ?", (now - 365 * 86400,))
            self._conn.commit()

    def session_valid(self, token_hash: str, now: int, max_age: int) -> bool:
        with self._lock:
            row = self._conn.execute(
                "SELECT last_used FROM sessions WHERE token_hash = ?", (token_hash,)
            ).fetchone()
            if row is None or now - row[0] > max_age:
                return False
            self._conn.execute(
                "UPDATE sessions SET last_used = ? WHERE token_hash = ?", (now, token_hash)
            )
            self._conn.commit()
        return True

    def session_delete(self, token_hash: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            self._conn.commit()

    def is_empty(self) -> bool:
        with self._lock:
            return (
                self._conn.execute("SELECT COUNT(*) FROM service_settings").fetchone()[0]
                == 0
            )
