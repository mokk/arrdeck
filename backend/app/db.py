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

    def is_empty(self) -> bool:
        with self._lock:
            return (
                self._conn.execute("SELECT COUNT(*) FROM service_settings").fetchone()[0]
                == 0
            )
