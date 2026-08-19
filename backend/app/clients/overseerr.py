from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable


class OverseerrClient(BaseClient):
    """Overseerr API — a TMDB discovery proxy and the request queue."""

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

    async def movie_details(self, tmdb_id: int) -> dict:
        return await self.get(f"/movie/{tmdb_id}")

    async def post(self, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers["X-Api-Key"] = self.api_key
        resp = await self._request(
            "POST", f"{self.base_url}/api/v1{path}", headers=headers, **kwargs
        )
        if resp.status_code in (401, 403):
            raise ServiceUnavailable(self.name, "unauthorized (check API key)")
        resp.raise_for_status()
        return resp.json() if resp.content else None

    async def requests(self, filter_: str = "pending", take: int = 20) -> dict:
        return await self.get(
            "/request", params={"filter": filter_, "take": take, "sort": "added"}
        )

    async def request_action(self, request_id: int, action: str) -> dict:
        # action: "approve" | "decline"
        return await self.post(f"/request/{request_id}/{action}")
