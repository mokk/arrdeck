"""Where the cleanup rules keep their state: JSON values in the settings kv,
so the backup carries them like everything else.

    cleanup_settings     {"enabled": false, "max_deletions": 10}
    cleanup_rules        [rule, ...]
    cleanup_pending      {"movie:12": leaving item, ...}
    cleanup_kept         {"movie:12": {kind, id, title, year, kept_at}, ...}
    cleanup_collections  {plex section key: collection rating key}
    cleanup_log          [run, ...] newest first, at most LOG_SIZE
    cleanup_last_run     unix seconds of the last scheduled run

Read-modify-write goes through one lock: a Keep tapped while a run is applying
its marks must not be overwritten by the run's stale copy.
"""

import json
import threading
import uuid

from .rules import DEFAULT_GRACE_DAYS, MIN_GRACE_DAYS

SETTINGS_KEY = "cleanup_settings"
RULES_KEY = "cleanup_rules"
PENDING_KEY = "cleanup_pending"
KEPT_KEY = "cleanup_kept"
COLLECTIONS_KEY = "cleanup_collections"
LOG_KEY = "cleanup_log"
LAST_RUN_KEY = "cleanup_last_run"

LOG_SIZE = 50
DEFAULT_MAX_DELETIONS = 10

_lock = threading.RLock()


def _load(db, key: str, default):
    try:
        value = json.loads(db.kv_get(key) or "null")
    except ValueError:
        return default
    return value if isinstance(value, type(default)) else default


def _save(db, key: str, value) -> None:
    db.kv_set(key, json.dumps(value))


def load_settings(db) -> dict:
    stored = _load(db, SETTINGS_KEY, {})
    maximum = stored.get("max_deletions")
    return {
        # only a stored true turns it on: a missing or broken value is off
        "enabled": stored.get("enabled") is True,
        "max_deletions": maximum
        if isinstance(maximum, int) and maximum >= 1
        else DEFAULT_MAX_DELETIONS,
    }


def save_settings(db, settings: dict) -> dict:
    _save(
        db,
        SETTINGS_KEY,
        {
            "enabled": bool(settings.get("enabled")),
            "max_deletions": max(1, int(settings.get("max_deletions") or DEFAULT_MAX_DELETIONS)),
        },
    )
    return load_settings(db)


def _number(value) -> float | int | None:
    # a threshold that is not a positive number is no condition at all
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        return None
    return value


def normalise_rule(raw: dict) -> dict:
    """A rule with every field present and in range. Off unless it says on."""
    conditions = raw.get("conditions") or {}
    kind = raw.get("kind")
    grace = raw.get("grace_days")
    return {
        "id": str(raw.get("id") or uuid.uuid4().hex[:12]),
        "name": str(raw.get("name") or ""),
        "kind": kind if kind in ("movie", "series") else "movie",
        "enabled": raw.get("enabled") is True,
        "grace_days": max(MIN_GRACE_DAYS, grace) if isinstance(grace, int) else DEFAULT_GRACE_DAYS,
        "conditions": {
            "watched_days": _number(conditions.get("watched_days")),
            "unwatched_days": _number(conditions.get("unwatched_days")),
            "min_size_gb": _number(conditions.get("min_size_gb")),
            "unmonitored": conditions.get("unmonitored") is True,
            "rating_below": _number(conditions.get("rating_below")),
            "without_tags": [t for t in conditions.get("without_tags") or [] if isinstance(t, int)],
            "with_tags": [t for t in conditions.get("with_tags") or [] if isinstance(t, int)],
        },
    }


def load_rules(db) -> list[dict]:
    return [normalise_rule(r) for r in _load(db, RULES_KEY, []) if isinstance(r, dict)]


def save_rules(db, rules: list[dict]) -> list[dict]:
    _save(db, RULES_KEY, [normalise_rule(r) for r in rules])
    return load_rules(db)


def load_pending(db) -> dict[str, dict]:
    return _load(db, PENDING_KEY, {})


def load_kept(db) -> dict[str, dict]:
    return _load(db, KEPT_KEY, {})


def mark(db, key: str, item: dict) -> bool:
    """Add a leaving title. False when it was kept meanwhile or is already leaving."""
    with _lock:
        pending = load_pending(db)
        if key in pending or key in load_kept(db):
            return False
        pending[key] = item
        _save(db, PENDING_KEY, pending)
        return True


def unmark(db, key: str) -> dict | None:
    with _lock:
        pending = load_pending(db)
        item = pending.pop(key, None)
        if item is not None:
            _save(db, PENDING_KEY, pending)
        return item


def keep(db, key: str, entry: dict) -> dict | None:
    """Allowlist a title and take it off the leaving list, as one step.
    Returns the leaving item it replaced, if there was one."""
    with _lock:
        kept = load_kept(db)
        kept[key] = entry
        _save(db, KEPT_KEY, kept)
        return unmark(db, key)


def unkeep(db, key: str | None = None) -> None:
    """Forget one kept title, or all of them."""
    with _lock:
        kept = load_kept(db) if key else {}
        kept.pop(key or "", None)
        _save(db, KEPT_KEY, kept)


def load_collections(db) -> dict[str, str]:
    return _load(db, COLLECTIONS_KEY, {})


def set_collection(db, section: str, collection_id: str | None) -> None:
    with _lock:
        collections = load_collections(db)
        if collection_id:
            collections[section] = collection_id
        else:
            collections.pop(section, None)
        _save(db, COLLECTIONS_KEY, collections)


def load_log(db) -> list[dict]:
    return _load(db, LOG_KEY, [])


def append_log(db, entry: dict) -> None:
    with _lock:
        _save(db, LOG_KEY, [entry, *load_log(db)][:LOG_SIZE])
