import time
from typing import Any


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
