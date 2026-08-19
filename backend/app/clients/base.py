from typing import Any

import httpx


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
        try:
            resp = await self.http.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise ServiceUnavailable(self.name, str(exc) or type(exc).__name__) from exc
        if resp.status_code >= 500:
            raise ServiceUnavailable(self.name, f"upstream HTTP {resp.status_code}")
        return resp


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
