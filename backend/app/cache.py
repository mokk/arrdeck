import logging
import time
from collections import OrderedDict
from collections.abc import Callable, Coroutine
from typing import Any

from .clients.base import ServiceUnavailable
from .schemas import ServiceBlock

logger = logging.getLogger("arrdeck.cache")

# Entries are kept past their TTL on purpose, so a dead upstream can still
# render its last good value. That makes the key space the thing to bound: keys
# like calendar:radarr:{start}:{end} gain a permanent entry for every month —
# and, since the calendar grew a week view, every week — that anyone browses.
MAX_ENTRIES = 512


class TTLCache:
    """In-memory TTL cache that retains the last good value past its TTL, so an
    offline service can render stale data with a timestamp.

    Least-recently-used beyond MAX_ENTRIES. The blocks that rely on the stale
    fallback (diskspace, health, vpn, watched) are re-read on every dashboard
    poll, so they stay resident; it is the one-off date-range keys that fall out.
    """

    def __init__(self, max_entries: int = MAX_ENTRIES) -> None:
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._max_entries = max_entries
        self.evictions = 0

    def _touch(self, key: str) -> None:
        self._store.move_to_end(key)

    def get(self, key: str, ttl: float) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        self._touch(key)
        stored_at, value = entry
        if time.monotonic() - stored_at > ttl:
            return None
        return value

    def get_stale(self, key: str) -> tuple[float, Any] | None:
        """Return (age_seconds, value) regardless of TTL."""
        entry = self._store.get(key)
        if entry is None:
            return None
        self._touch(key)
        stored_at, value = entry
        return time.monotonic() - stored_at, value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (time.monotonic(), value)
        self._touch(key)
        while len(self._store) > self._max_entries:
            evicted, _ = self._store.popitem(last=False)
            self.evictions += 1
            logger.info("cache evicted %s (%d entries)", evicted, len(self._store))

    def clear(self) -> None:
        self._store.clear()

    def stats(self) -> dict:
        return {
            "entries": len(self._store),
            "max_entries": self._max_entries,
            "evictions": self.evictions,
        }


cache = TTLCache()


async def guarded(coro: Coroutine, cache_key: str | None = None):
    """Run an upstream call; on failure return ok=false, falling back to the
    last good cached value if one exists."""
    try:
        data = await coro
        if cache_key:
            cache.set(cache_key, data)
        return ServiceBlock(ok=True, data=data)
    except ServiceUnavailable as exc:
        stale = cache.get_stale(cache_key) if cache_key else None
        if stale:
            age, value = stale
            return ServiceBlock(ok=False, error=exc.message, data=value, stale_age_seconds=age)
        return ServiceBlock(ok=False, error=exc.message)
    except Exception as exc:  # noqa: BLE001 — aggregates must never 500
        return ServiceBlock(ok=False, error=str(exc))


async def cached(key: str, ttl: float, fetch: Callable[[], Coroutine]) -> Any:
    hit = cache.get(key, ttl)
    if hit is not None:
        return hit
    data = await fetch()
    cache.set(key, data)
    return data
