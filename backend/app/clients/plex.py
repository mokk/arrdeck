from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable


class PlexClient(BaseClient):
    """Plex Media Server.

    Plex speaks XML unless asked otherwise, so every call sets Accept: json.
    The token is a server credential and never leaves the backend — session
    artwork would require embedding it in an image URL, so it isn't exposed.
    """

    name = "plex"

    def __init__(self, http: httpx.AsyncClient, base_url: str, token: str) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")
        self.token = token

    async def get(self, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers["Accept"] = "application/json"
        headers["X-Plex-Token"] = self.token
        resp = await self._request("GET", f"{self.base_url}{path}", headers=headers, **kwargs)
        if resp.status_code in (401, 403):
            raise ServiceUnavailable(self.name, "unauthorized (check the Plex token)")
        resp.raise_for_status()
        return resp.json()

    async def identity(self) -> dict:
        return (await self.get("/identity")).get("MediaContainer", {})

    async def status(self) -> dict:
        return await self.identity()

    async def sections(self) -> list:
        container = (await self.get("/library/sections")).get("MediaContainer", {})
        return container.get("Directory") or []

    async def section_items(self, key: str) -> list:
        # includeGuids gives imdb/tmdb/tvdb ids inline, which is the whole
        # reason this can be joined to the arrs without per-item lookups
        container = (
            await self.get(f"/library/sections/{key}/all", params={"includeGuids": 1}, timeout=30.0)
        ).get("MediaContainer", {})
        return container.get("Metadata") or []

    async def sessions(self) -> list:
        container = (await self.get("/status/sessions")).get("MediaContainer", {})
        return container.get("Metadata") or []
