"""HTTP plumbing shared by every upstream client."""

import asyncio
import logging
import time
from collections import defaultdict, deque
from typing import Any

import httpx

logger = logging.getLogger("arrdeck.clients")

# One retry, not a loop: these services sit on the same LAN, so a request that
# fails twice in a row is a real outage rather than a blip, and a longer chain
# just delays the "offline" card the user needs to see.
RETRY_BACKOFF_SECONDS = 0.25

# Errors where the request demonstrably never landed, so re-sending it cannot
# duplicate work. ReadTimeout is deliberately absent: the server did receive the
# request and is merely slow, so retrying doubles the wait (releases() allows 90s)
# and piles a second fan-out onto an already-struggling indexer.
RETRYABLE_ERRORS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadError,
    httpx.RemoteProtocolError,
)

# How long a retry keeps counting towards "flaky". Long enough that a service
# blipping a few times an hour is still visible, short enough that yesterday's
# reboot doesn't brand it flaky forever.
RETRY_WINDOW_SECONDS = 900

_retries: dict[str, deque[float]] = defaultdict(deque)


def record_retry(service: str) -> None:
    now = time.monotonic()
    stamps = _retries[service]
    stamps.append(now)
    while stamps and now - stamps[0] > RETRY_WINDOW_SECONDS:
        stamps.popleft()


def retry_count(service: str) -> int:
    """Retries for this service inside the window (prunes as it reads)."""
    now = time.monotonic()
    stamps = _retries[service]
    while stamps and now - stamps[0] > RETRY_WINDOW_SECONDS:
        stamps.popleft()
    return len(stamps)


def reset_retries() -> None:
    _retries.clear()


class ServiceUnavailable(Exception):
    def __init__(self, service: str, message: str = "unreachable") -> None:
        self.service = service
        self.message = message
        super().__init__(f"{service}: {message}")


class BaseClient:
    name: str = "service"

    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        # Only GET is retried. A re-sent grab, delete or blocklist write is worse
        # than an error: the caller sees one failure and can decide, whereas a
        # duplicated POST leaves the arr with two of something and no way back.
        retryable = method.upper() == "GET"
        try:
            return await self._attempt(method, url, **kwargs)
        except ServiceUnavailable as exc:
            if not retryable or not getattr(exc, "transient", False):
                raise
            record_retry(self.name)
            logger.info("%s %s failed (%s), retrying once", method, url, exc.message)
        await asyncio.sleep(RETRY_BACKOFF_SECONDS)
        return await self._attempt(method, url, **kwargs)

    async def _attempt(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        try:
            resp = await self.http.request(method, url, **kwargs)
        except RETRYABLE_ERRORS as exc:
            raise _transient(self.name, str(exc) or type(exc).__name__) from exc
        except httpx.HTTPError as exc:
            raise ServiceUnavailable(self.name, str(exc) or type(exc).__name__) from exc
        if resp.status_code >= 500:
            # 5xx on a GET is worth one more try — the arrs return them while a
            # task holds their database lock, which clears in well under a second.
            raise _transient(self.name, f"upstream HTTP {resp.status_code}")
        return resp


def _transient(service: str, message: str) -> ServiceUnavailable:
    exc = ServiceUnavailable(service, message)
    exc.transient = True  # type: ignore[attr-defined]
    return exc


class ArrClient(BaseClient):
    """Shared client for Radarr/Sonarr/Prowlarr (identical auth + API shape)."""

    api_prefix = "/api/v3"

    def __init__(self, http: httpx.AsyncClient, base_url: str, api_key: str) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers["X-Api-Key"] = self.api_key
        resp = await self._request(
            method, f"{self.base_url}{self.api_prefix}{path}", headers=headers, **kwargs
        )
        if resp.status_code == 401:
            raise ServiceUnavailable(self.name, "unauthorized (check API key)")
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await self.request("GET", path, **kwargs)

    async def status(self) -> dict:
        return await self.get("/system/status")

    async def history(self, page_size: int = 20, page: int = 1, **params: bool) -> dict:
        # Extra params: Radarr includeMovie=, Sonarr includeSeries=/includeEpisode=.
        return await self.get(
            "/history",
            params={
                "pageSize": page_size,
                "page": page,
                "sortKey": "date",
                "sortDirection": "descending",
                **params,
            },
        )

    async def releases(self, **params: int) -> list:
        # Radarr: movieId=; Sonarr: episodeId= or seriesId=&seasonNumber=.
        # The arr fans out to all indexers — slow; allow for it.
        return await self.get("/release", params=params, timeout=90.0)

    async def health(self) -> list:
        return await self.get("/health")

    async def download_clients(self) -> list:
        return await self.get("/downloadclient")

    async def import_lists(self) -> list:
        return await self.get("/importlist")

    async def update_import_list(self, list_id: int, payload: dict) -> dict:
        return await self.request("PUT", f"/importlist/{list_id}", json=payload, timeout=30.0)

    async def logs(self, page: int = 1, page_size: int = 50, level: str = "") -> dict:
        params: dict = {
            "page": page,
            "pageSize": page_size,
            "sortKey": "time",
            "sortDirection": "descending",
        }
        if level:
            params["level"] = level
        return await self.get("/log", params=params)

    async def blocklist(self, page: int = 1, page_size: int = 50) -> dict:
        return await self.get(
            "/blocklist",
            params={
                "page": page,
                "pageSize": page_size,
                "sortKey": "date",
                "sortDirection": "descending",
            },
        )

    async def blocklist_delete(self, entry_id: int) -> None:
        await self.request("DELETE", f"/blocklist/{entry_id}")

    async def blocklist_clear(self) -> None:
        await self.request("DELETE", "/blocklist/bulk", json={"ids": []})

    async def rename_preview(self, **params: int) -> list:
        # Radarr: movieId=; Sonarr: seriesId= (+ optional seasonNumber=)
        return await self.get("/rename", params=params)

    async def tasks(self) -> list:
        """Scheduled tasks with their last and next run (System -> Tasks)."""
        return await self.get("/system/task")

    async def backups(self) -> list:
        """The arr's own backups — separate from arrdeck's /backup."""
        return await self.get("/system/backup")

    async def tags(self) -> list:
        return await self.get("/tag")

    async def diskspace(self) -> list:
        return await self.get("/diskspace")

    # --- Connect / notification settings (used to install arrdeck's webhook) ---

    async def notifications(self) -> list:
        return await self.get("/notification")

    async def notification_schemas(self) -> list:
        return await self.get("/notification/schema")

    async def add_notification(self, payload: dict) -> dict:
        return await self.request("POST", "/notification", json=payload, timeout=30.0)

    async def update_notification(self, notification_id: int, payload: dict) -> dict:
        return await self.request(
            "PUT", f"/notification/{notification_id}", json=payload, timeout=30.0
        )

    async def delete_notification(self, notification_id: int) -> None:
        await self.request("DELETE", f"/notification/{notification_id}")

    async def test_notification(self, payload: dict) -> None:
        await self.request("POST", "/notification/test", json=payload, timeout=30.0)

    async def grab_release(self, guid: str, indexer_id: int) -> None:
        await self.request(
            "POST", "/release", json={"guid": guid, "indexerId": indexer_id}, timeout=90.0
        )
