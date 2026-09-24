from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable

TRAKT_URL = "https://api.trakt.tv"


class TraktClient(BaseClient):
    """Trakt's public lists. Only a client id (a Trakt "API app") is needed —
    no account, no OAuth; nothing is written to Trakt."""

    name = "trakt"

    def __init__(self, http: httpx.AsyncClient, client_id: str, base_url: str = TRAKT_URL) -> None:
        super().__init__(http)
        self.base_url = (base_url or TRAKT_URL).rstrip("/")
        self.client_id = client_id

    async def get(self, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        headers.update({"trakt-api-version": "2", "trakt-api-key": self.client_id})
        resp = await self._request("GET", f"{self.base_url}{path}", headers=headers, **kwargs)
        if resp.status_code in (401, 403):
            raise ServiceUnavailable(self.name, "unauthorized (check the Trakt client id)")
        resp.raise_for_status()
        return resp.json()

    async def status(self) -> dict:
        await self.get("/movies/trending", params={"limit": 1})
        return {"version": "2"}  # the API version; Trakt reports none of its own

    async def list(self, kind: str, which: str, limit: int = 20) -> list[dict]:
        """`kind` movies | shows, `which` trending | anticipated | popular.
        Trending and anticipated wrap each title; popular does not."""
        rows = await self.get(f"/{kind}/{which}", params={"limit": limit, "extended": "full"})
        key = "movie" if kind == "movies" else "show"
        return [r.get(key, r) if isinstance(r, dict) else r for r in rows or []]
