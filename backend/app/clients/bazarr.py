from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable


class BazarrClient(BaseClient):
    """Bazarr API. Auth is X-API-KEY; write actions are PATCH with form data."""

    name = "bazarr"

    def __init__(self, http: httpx.AsyncClient, base_url: str, api_key: str) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers["X-API-KEY"] = self.api_key
        resp = await self._request(method, f"{self.base_url}/api{path}", headers=headers, **kwargs)
        if resp.status_code in (401, 403):
            raise ServiceUnavailable(self.name, "unauthorized (check API key)")
        resp.raise_for_status()
        return resp.json() if resp.content else None

    async def get(self, path: str, **kwargs: Any) -> Any:
        return await self.request("GET", path, **kwargs)

    async def status(self) -> dict:
        return (await self.get("/system/status")).get("data", {})

    async def badges(self) -> dict:
        return await self.get("/badges")

    async def wanted_episodes(self, length: int = 20) -> list:
        data = await self.get("/episodes/wanted", params={"start": 0, "length": length})
        return data.get("data") or []

    async def wanted_movies(self, length: int = 20) -> list:
        data = await self.get("/movies/wanted", params={"start": 0, "length": length})
        return data.get("data") or []

    async def search_episode(self, series_id: int, episode_id: int) -> None:
        await self.request(
            "PATCH",
            "/episodes",
            data={"seriesid": series_id, "episodeid": episode_id, "action": "search-missing"},
        )

    async def search_movie(self, radarr_id: int) -> None:
        await self.request(
            "PATCH", "/movies", data={"radarrid": radarr_id, "action": "search-missing"}
        )
