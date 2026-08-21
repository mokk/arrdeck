import json
import sqlite3
import threading
from pathlib import Path
from typing import ClassVar

SERVICES = [
    "radarr", "sonarr", "prowlarr", "qbittorrent", "transmission", "overseerr", "gluetun",
    "bazarr", "plex", "prometheus",
]
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
            # CREATE TABLE IF NOT EXISTS leaves an existing table alone, so
            # columns added after a release need an explicit ALTER.
            self._migrate_columns(
                "stats_samples", {"disk_free_bytes": "INTEGER NOT NULL DEFAULT 0"}
            )
            # NULL events = this device follows the global default
            self._migrate_columns("push_subscriptions", {"events": "TEXT"})
            # NULL language = render in English. Notification text is built by
            # the client from a code, but the payload has to say which language
            # the device is in — a service worker cannot read localStorage.
            self._migrate_columns("push_subscriptions", {"language": "TEXT"})
            self._conn.commit()

    def _migrate_columns(self, table: str, columns: dict[str, str]) -> None:
        existing = {row[1] for row in self._conn.execute(f"PRAGMA table_info({table})")}
        for name, ddl in columns.items():
            if name not in existing:
                self._conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")

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

    STATS_COLUMNS: ClassVar[list[str]] = [
        "ts", "movies", "series", "episode_files", "library_bytes",
        "torrents_qbit", "torrents_tm", "indexer_grabs", "indexer_queries",
        "disk_free_bytes",
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
        return [dict(zip(self.STATS_COLUMNS, r, strict=False)) for r in rows]

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

    # --- whole-database snapshot (backup/restore) ---

    def kv_all(self) -> dict[str, str]:
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM kv").fetchall()
        return dict(rows)

    def snapshot(self) -> dict:
        """Everything worth restoring. Credentials and the VAPID keypair are
        included deliberately: without them a restore leaves you unable to sign
        in and silences every push subscription."""
        with self._lock:
            creds = self._conn.execute(
                "SELECT credential_id, public_key, sign_count, name, created FROM credentials"
            ).fetchall()
            subs = self._conn.execute(
                "SELECT endpoint, data, events FROM push_subscriptions"
            ).fetchall()
        return {
            "version": 1,
            "services": self.all(),
            "kv": self.kv_all(),
            "credentials": [
                dict(zip(("credential_id", "public_key", "sign_count", "name", "created"), r, strict=False))
                for r in creds
            ],
            "push_subscriptions": [
                dict(zip(("endpoint", "data", "events"), r, strict=False)) for r in subs
            ],
            "stats_samples": self.samples_since(0),
        }

    def restore(self, snap: dict) -> dict:
        """Merge a snapshot in. Sessions are deliberately not restored — a
        backup shouldn't resurrect logins on devices you no longer hold."""
        counts = {"services": 0, "kv": 0, "credentials": 0, "push_subscriptions": 0, "stats": 0}
        for name, values in (snap.get("services") or {}).items():
            if name in SERVICES:
                self.upsert(name, values)
                counts["services"] += 1
        for key, value in (snap.get("kv") or {}).items():
            self.kv_set(str(key), str(value))
            counts["kv"] += 1
        with self._lock:
            for cred in snap.get("credentials") or []:
                self._conn.execute(
                    "INSERT OR REPLACE INTO credentials"
                    " (credential_id, public_key, sign_count, name, created)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (
                        cred.get("credential_id"),
                        cred.get("public_key"),
                        cred.get("sign_count", 0),
                        cred.get("name", ""),
                        cred.get("created", 0),
                    ),
                )
                counts["credentials"] += 1
            for sub in snap.get("push_subscriptions") or []:
                self._conn.execute(
                    "INSERT OR REPLACE INTO push_subscriptions (endpoint, data, events)"
                    " VALUES (?, ?, ?)",
                    (sub.get("endpoint"), sub.get("data"), sub.get("events")),
                )
                counts["push_subscriptions"] += 1
            self._conn.commit()
        for sample in snap.get("stats_samples") or []:
            if sample.get("ts"):
                self.insert_sample(sample)
                counts["stats"] += 1
        return counts

    def push_add(self, endpoint: str, data: str, language: str | None = None) -> None:
        """Upsert, not REPLACE.

        INSERT OR REPLACE deletes the row and inserts a new one, so every column
        not named here reverted to NULL — a device that had chosen its own event
        set lost that choice whenever the browser rotated its subscription, which
        it does on its own schedule.
        """
        with self._lock:
            self._conn.execute(
                """INSERT INTO push_subscriptions (endpoint, data, language)
                   VALUES (?, ?, ?)
                   ON CONFLICT(endpoint) DO UPDATE SET
                     data = excluded.data,
                     -- Only overwrite the language when the client sent one, so
                     -- a subscribe call that omits it does not blank it.
                     language = COALESCE(excluded.language, push_subscriptions.language)""",
                (endpoint, data, language),
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
        return [data for data, _, _ in self.push_targets()]

    def push_targets(self) -> list[tuple[str, list[str] | None, str | None]]:
        """(subscription json, event keys, language). None events means the device
        hasn't chosen its own set and follows the global default; None language
        means render in English."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT data, events, language FROM push_subscriptions"
            ).fetchall()
        out: list[tuple[str, list[str] | None, str | None]] = []
        for data, events, language in rows:
            try:
                parsed = json.loads(events) if events else None
            except ValueError:
                parsed = None
            out.append((data, parsed if isinstance(parsed, list) else None, language))
        return out

    def push_get_events(self, endpoint: str) -> list[str] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT events FROM push_subscriptions WHERE endpoint = ?", (endpoint,)
            ).fetchone()
        if not row or not row[0]:
            return None
        try:
            parsed = json.loads(row[0])
        except ValueError:
            return None
        return parsed if isinstance(parsed, list) else None

    def push_set_events(self, endpoint: str, events: list[str] | None) -> bool:
        """False when the endpoint isn't subscribed (nothing to attach prefs to)."""
        with self._lock:
            cur = self._conn.execute(
                "UPDATE push_subscriptions SET events = ? WHERE endpoint = ?",
                (json.dumps(events) if events is not None else None, endpoint),
            )
            self._conn.commit()
            return cur.rowcount > 0

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
        return [dict(zip(keys, r, strict=False)) for r in rows]

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

    def session_list(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT token_hash, created, last_used FROM sessions ORDER BY last_used DESC"
            ).fetchall()
        return [dict(zip(("token_hash", "created", "last_used"), r, strict=False)) for r in rows]

    def session_delete_others(self, keep_hash: str) -> int:
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM sessions WHERE token_hash != ?", (keep_hash,)
            )
            self._conn.commit()
            return cur.rowcount

    def session_delete_by_prefix(self, prefix: str) -> int:
        """Sessions are addressed by a prefix of their hash — the full token
        never leaves the browser, and the hash itself is not worth exposing."""
        with self._lock:
            cur = self._conn.execute(
                "DELETE FROM sessions WHERE substr(token_hash, 1, ?) = ?", (len(prefix), prefix)
            )
            self._conn.commit()
            return cur.rowcount

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
