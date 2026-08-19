import asyncio
import sqlite3

from app.db import SettingsDB
from app.stats import collect_sample


class FakeArr:
    def __init__(self, roots):
        self._roots = roots

    async def root_folders(self):
        return self._roots

    async def movies(self):
        return []

    async def series(self):
        return []


class FakeRegistry:
    def __init__(self, clients):
        self._clients = clients

    def is_configured(self, name):
        return name in self._clients

    def get(self, name):
        return self._clients[name]


def test_shared_volume_is_not_counted_twice():
    # different paths, byte-identical free space: one disk mounted twice
    registry = FakeRegistry(
        {
            "radarr": FakeArr([{"path": "/data/movies", "freeSpace": 1_635_113_267_2}]),
            "sonarr": FakeArr([{"path": "/data/series", "freeSpace": 1_635_113_267_2}]),
        }
    )
    sample = asyncio.run(collect_sample(registry))
    assert sample["disk_free_bytes"] == 1_635_113_267_2


def test_separate_volumes_are_summed():
    registry = FakeRegistry(
        {
            "radarr": FakeArr([{"path": "/mnt/a", "freeSpace": 100}]),
            "sonarr": FakeArr([{"path": "/mnt/b", "freeSpace": 250}]),
        }
    )
    assert asyncio.run(collect_sample(registry))["disk_free_bytes"] == 350


def test_missing_root_folders_leave_the_field_absent():
    registry = FakeRegistry({"radarr": FakeArr([])})
    assert "disk_free_bytes" not in asyncio.run(collect_sample(registry))


def test_migration_adds_the_column_without_losing_samples(tmp_path):
    path = str(tmp_path / "old.db")
    # a stats_samples table as it existed before disk tracking
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE stats_samples (
            ts INTEGER PRIMARY KEY, movies INTEGER NOT NULL DEFAULT 0,
            series INTEGER NOT NULL DEFAULT 0, episode_files INTEGER NOT NULL DEFAULT 0,
            library_bytes INTEGER NOT NULL DEFAULT 0, torrents_qbit INTEGER NOT NULL DEFAULT 0,
            torrents_tm INTEGER NOT NULL DEFAULT 0, indexer_grabs INTEGER NOT NULL DEFAULT 0,
            indexer_queries INTEGER NOT NULL DEFAULT 0)"""
    )
    conn.execute("INSERT INTO stats_samples (ts, movies) VALUES (1000, 42)")
    conn.commit()
    conn.close()

    db = SettingsDB(path)
    samples = db.samples_since(0)
    assert len(samples) == 1
    assert samples[0]["movies"] == 42
    assert samples[0]["disk_free_bytes"] == 0  # backfilled by the column default

    SettingsDB(path)  # re-opening must not try to add the column again
    db.insert_sample({"ts": 2000, "disk_free_bytes": 999})
    assert db.samples_since(0)[-1]["disk_free_bytes"] == 999
