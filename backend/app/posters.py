"""On-disk poster cache.

The proxy wrote and never deleted, so the directory grew without limit (71 MB
across 283 files by the time anyone looked). Eviction is least-recently-used by
mtime, with a size cap and an age cap.
"""

import contextlib
import logging
import time
from pathlib import Path

from .config import get_settings

logger = logging.getLogger("arrdeck.posters")

BACKUP_KEEP = 7

POSTER_DIR = Path(get_settings().db_path).parent / "posters"
MAX_BYTES = 256 * 1024 * 1024
MAX_AGE = 90 * 86400
# a cache hit only refreshes mtime once a day, so "recently used" survives
# eviction without paying a write on every request
TOUCH_INTERVAL = 86400


def touch(path: Path) -> None:
    try:
        if time.time() - path.stat().st_mtime > TOUCH_INTERVAL:
            path.touch()
    except OSError:  # the file may have just been evicted
        pass


def prune(max_bytes: int = MAX_BYTES, max_age: int = MAX_AGE) -> dict:
    """Drop expired posters, then the oldest until under the size cap."""
    if not POSTER_DIR.exists():
        return {"removed": 0, "freed": 0, "kept": 0, "bytes": 0}

    entries = []
    for path in POSTER_DIR.glob("*.img"):
        try:
            stat = path.stat()
        except OSError:
            continue
        entries.append((stat.st_mtime, stat.st_size, path))

    now = time.time()
    removed = freed = 0

    def drop(path: Path, size: int) -> None:
        nonlocal removed, freed
        try:
            path.unlink()
        except OSError:
            return
        removed += 1
        freed += size

    fresh = []
    for mtime, size, path in entries:
        if now - mtime > max_age:
            drop(path, size)
        else:
            fresh.append((mtime, size, path))

    total = sum(size for _, size, _ in fresh)
    fresh.sort()  # oldest first
    index = 0
    while total > max_bytes and index < len(fresh):
        _, size, path = fresh[index]
        drop(path, size)
        total -= size
        index += 1

    kept = len(fresh) - index
    if removed:
        logger.info("poster cache: removed %d files, freed %d bytes", removed, freed)
    return {"removed": removed, "freed": freed, "kept": kept, "bytes": total}


def backup_database(db_path: str, keep: int = BACKUP_KEEP) -> str | None:
    """Rolling on-disk copy of the sqlite file next to it.

    Uses sqlite's own backup API rather than copying bytes, so a snapshot taken
    while the app is writing is still consistent.
    """
    import sqlite3

    source = Path(db_path)
    if not source.exists():
        return None
    target_dir = source.parent / "backups"
    target_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    target = target_dir / f"{source.stem}-{stamp}.db"
    try:
        src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        dst = sqlite3.connect(target)
        with dst:
            src.backup(dst)
        src.close()
        dst.close()
    except Exception:
        logger.exception("database backup failed")
        return None

    existing = sorted(target_dir.glob(f"{source.stem}-*.db"))
    for stale in existing[:-keep]:
        with contextlib.suppress(OSError):
            stale.unlink()
    logger.info("database backed up to %s", target.name)
    return str(target)
