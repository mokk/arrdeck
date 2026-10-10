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


class DownArr:
    async def root_folders(self):
        raise ConnectionError("down")

    async def movies(self):
        raise ConnectionError("down")

    async def series(self):
        raise ConnectionError("down")


class FakeTorrents:
    async def torrents(self):
        return [{}, {}, {}]


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
    # samples from before disk tracking never measured it: unknown, not 0
    assert samples[0]["disk_free_bytes"] is None

    SettingsDB(path)  # re-opening must not try to add the column again
    db.insert_sample({"ts": 2000, "disk_free_bytes": 999})
    assert db.samples_since(0)[-1]["disk_free_bytes"] == 999


def test_a_down_arr_is_a_gap_not_an_empty_library():
    registry = FakeRegistry(
        {
            "radarr": DownArr(),
            "sonarr": FakeArr([{"path": "/data", "freeSpace": 500}]),
            "qbittorrent": FakeTorrents(),
        }
    )
    sample = asyncio.run(collect_sample(registry))
    assert "movies" not in sample
    # the shows answered, but without the films the library size is not known
    assert sample["series"] == 0 and "library_bytes" not in sample
    # nor is free space: Radarr's disk may be one Sonarr does not see
    assert "disk_free_bytes" not in sample
    # and services that did answer still count
    assert sample["torrents_qbit"] == 3


def test_every_arr_answering_gives_the_whole_library():
    class Arr(FakeArr):
        async def movies(self):
            return [{"sizeOnDisk": 10}, {"sizeOnDisk": 5}]

        async def series(self):
            return [{"statistics": {"sizeOnDisk": 100, "episodeFileCount": 4}}]

    registry = FakeRegistry({"radarr": Arr([]), "sonarr": Arr([])})
    sample = asyncio.run(collect_sample(registry))
    assert sample["library_bytes"] == 115
    assert (sample["movies"], sample["series"], sample["episode_files"]) == (2, 1, 4)


def test_unknown_values_are_stored_as_null(tmp_path):
    db = SettingsDB(str(tmp_path / "s.db"))
    db.insert_sample({"ts": 3000, "torrents_qbit": 7})
    row = db.samples_since(0)[-1]
    assert row["torrents_qbit"] == 7
    assert row["movies"] is None and row["library_bytes"] is None


def test_old_not_null_table_is_rebuilt_once_keeping_its_values(tmp_path):
    path = str(tmp_path / "old.db")
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE stats_samples (
            ts INTEGER PRIMARY KEY, movies INTEGER NOT NULL DEFAULT 0,
            series INTEGER NOT NULL DEFAULT 0, episode_files INTEGER NOT NULL DEFAULT 0,
            library_bytes INTEGER NOT NULL DEFAULT 0, torrents_qbit INTEGER NOT NULL DEFAULT 0,
            torrents_tm INTEGER NOT NULL DEFAULT 0, indexer_grabs INTEGER NOT NULL DEFAULT 0,
            indexer_queries INTEGER NOT NULL DEFAULT 0,
            disk_free_bytes INTEGER NOT NULL DEFAULT 0)"""
    )
    conn.execute("INSERT INTO stats_samples (ts, movies, disk_free_bytes) VALUES (1000, 42, 77)")
    conn.commit()
    conn.close()

    db = SettingsDB(path)
    assert db.samples_since(0)[0]["movies"] == 42
    assert db.samples_since(0)[0]["disk_free_bytes"] == 77
    db.insert_sample({"ts": 2000})
    assert db.samples_since(0)[-1]["movies"] is None
    SettingsDB(path)  # reopening leaves the rebuilt table alone
    assert len(SettingsDB(path).samples_since(0)) == 2
