import time
from typing import Any, Callable, Coroutine

from .clients.base import ServiceUnavailable
from .schemas import ServiceBlock


class TTLCache:
    """In-memory TTL cache that also retains the last good value forever,
    so offline services can render stale data with a timestamp."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str, ttl: float) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if time.monotonic() - stored_at > ttl:
            return None
        return value

    def get_stale(self, key: str) -> tuple[float, Any] | None:
        """Return (age_seconds, value) regardless of TTL."""
        entry = self._store.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        return time.monotonic() - stored_at, value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (time.monotonic(), value)

    def clear(self) -> None:
        self._store.clear()


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
