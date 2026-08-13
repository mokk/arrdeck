from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable


class OverseerrClient(BaseClient):
    """Overseerr API — used purely as a TMDB discovery proxy."""

    name = "overseerr"

    def __init__(self, http: httpx.AsyncClient, base_url: str, api_key: str) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def get(self, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers["X-Api-Key"] = self.api_key
        resp = await self._request(
            "GET", f"{self.base_url}/api/v1{path}", headers=headers, **kwargs
        )
        if resp.status_code in (401, 403):
            raise ServiceUnavailable(self.name, "unauthorized (check API key)")
        resp.raise_for_status()
        return resp.json()

    async def status(self) -> dict:
        return await self.get("/status")

    async def discover_movies(self, page: int = 1) -> list:
        data = await self.get("/discover/movies", params={"page": page})
        return data.get("results", [])

    async def discover_tv(self, page: int = 1) -> list:
        data = await self.get("/discover/tv", params={"page": page})
        return data.get("results", [])

    async def tv_details(self, tmdb_id: int) -> dict:
        return await self.get(f"/tv/{tmdb_id}")
