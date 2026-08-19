import json

from app.db import SettingsDB


def populated(path):
    db = SettingsDB(str(path))
    db.upsert("radarr", {"url": "http://arr:7878", "api_key": "KEY", "username": "", "password": ""})
    db.kv_set("vapid_private_pem", "-----BEGIN PRIVATE KEY-----x")
    db.kv_set("push_rules", json.dumps({"quiet_start": "23:00"}))
    db.cred_add("credid", "pubkey", "phone", 1000)
    db.push_add("https://push/1", json.dumps({"endpoint": "https://push/1"}))
    db.push_set_events("https://push/1", ["grabbed"])
    db.insert_sample({"ts": 5000, "movies": 7, "disk_free_bytes": 42})
    db.session_add("sessionhash", 1000)
    return db


def test_a_snapshot_covers_everything_that_cannot_be_rebuilt(tmp_path):
    snap = populated(tmp_path / "a.db").snapshot()
    assert snap["services"]["radarr"]["api_key"] == "KEY"
    # the vapid key matters most: push subscriptions are bound to it
    assert snap["kv"]["vapid_private_pem"].startswith("-----BEGIN")
    assert snap["credentials"][0]["credential_id"] == "credid"
    assert snap["push_subscriptions"][0]["endpoint"] == "https://push/1"
    assert snap["stats_samples"][0]["movies"] == 7


def test_restoring_into_an_empty_database_brings_it_all_back(tmp_path):
    snap = populated(tmp_path / "src.db").snapshot()
    fresh = SettingsDB(str(tmp_path / "dst.db"))
    counts = fresh.restore(snap)

    assert counts["credentials"] == 1 and counts["push_subscriptions"] == 1
    assert fresh.all()["radarr"]["api_key"] == "KEY"
    assert fresh.kv_get("vapid_private_pem").startswith("-----BEGIN")
    assert [c["credential_id"] for c in fresh.cred_list()] == ["credid"]
    # per-device push preferences survive, not just the subscription
    assert fresh.push_get_events("https://push/1") == ["grabbed"]
    assert fresh.samples_since(0)[0]["movies"] == 7


def test_sessions_are_deliberately_not_restored(tmp_path):
    snap = populated(tmp_path / "s.db").snapshot()
    assert "sessions" not in snap
    fresh = SettingsDB(str(tmp_path / "s2.db"))
    fresh.restore(snap)
    # a backup must not resurrect logins on devices you no longer hold
    assert fresh.session_list() == []


def test_restore_is_idempotent(tmp_path):
    snap = populated(tmp_path / "i.db").snapshot()
    fresh = SettingsDB(str(tmp_path / "i2.db"))
    fresh.restore(snap)
    fresh.restore(snap)
    assert len(fresh.cred_list()) == 1
    assert len(fresh.push_all()) == 1
    assert len(fresh.samples_since(0)) == 1


def test_a_partial_snapshot_restores_what_it_has(tmp_path):
    fresh = SettingsDB(str(tmp_path / "p.db"))
    counts = fresh.restore({"version": 1, "services": {"sonarr": {"url": "u", "api_key": "k"}}})
    assert counts["services"] == 1 and counts["credentials"] == 0
    assert fresh.all()["sonarr"]["url"] == "u"


def test_unknown_services_in_a_snapshot_are_ignored(tmp_path):
    fresh = SettingsDB(str(tmp_path / "u.db"))
    counts = fresh.restore({"version": 1, "services": {"notaservice": {"url": "u"}}})
    assert counts["services"] == 0


# --- rolling on-disk copies ---------------------------------------------


def test_a_backup_is_a_readable_database(tmp_path):
    import sqlite3

    from app.posters import backup_database

    path = tmp_path / "arrdeck.db"
    populated(path)
    target = backup_database(str(path))
    assert target is not None
    # sqlite's backup API, so it's consistent even if written to concurrently
    rows = sqlite3.connect(target).execute("SELECT value FROM kv WHERE key='push_rules'").fetchone()
    assert "23:00" in rows[0]


def test_old_backups_are_rotated_out(tmp_path):
    from app.posters import backup_database

    path = tmp_path / "arrdeck.db"
    populated(path)
    backups = tmp_path / "backups"
    backups.mkdir()
    # names sort chronologically, so oldest-first pruning is a plain sort
    for stamp in ("20200101-000000", "20200102-000000", "20200103-000000"):
        (backups / f"arrdeck-{stamp}.db").write_bytes(b"old")

    backup_database(str(path), keep=2)
    remaining = sorted(p.name for p in backups.glob("*.db"))
    assert len(remaining) == 2
    assert "arrdeck-20200101-000000.db" not in remaining  # oldest went first


def test_a_missing_database_is_not_an_error(tmp_path):
    from app.posters import backup_database

    assert backup_database(str(tmp_path / "nothing.db")) is None
