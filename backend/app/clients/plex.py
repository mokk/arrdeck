from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable

WATCHLIST_URL = "https://discover.provider.plex.tv/library/sections/watchlist/all"
WATCHLIST_PAGE = 100
WATCHLIST_PAGES = 10


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

    async def episodes(self, show_key: str) -> list:
        """Every episode of a show, with its viewCount."""
        container = (await self.get(f"/library/metadata/{show_key}/allLeaves")).get(
            "MediaContainer", {}
        )
        return container.get("Metadata") or []

    async def history(self, since: int) -> list:
        """Every play recorded after `since` (unix seconds), newest first."""
        container = (
            await self.get(
                "/status/sessions/history/all",
                params={
                    "sort": "viewedAt:desc",
                    "viewedAt>": since,
                    "X-Plex-Container-Size": 20000,
                },
                timeout=30.0,
            )
        ).get("MediaContainer", {})
        return container.get("Metadata") or []

    async def watchlist(self) -> list:
        """The token owner's watchlist on plex.tv — not the server's library,
        so it is asked of Plex's discover service with the same token. Plex
        refuses pages over 100 or so; ten pages is plenty for a watchlist."""
        items: list = []
        for page in range(WATCHLIST_PAGES):
            resp = await self._request(
                "GET",
                WATCHLIST_URL,
                headers={"X-Plex-Token": self.token, "Accept": "application/json"},
                params={
                    "includeGuids": 1,
                    "X-Plex-Container-Start": page * WATCHLIST_PAGE,
                    "X-Plex-Container-Size": WATCHLIST_PAGE,
                },
                timeout=30.0,
            )
            if resp.status_code in (401, 403):
                raise ServiceUnavailable(
                    self.name, "unauthorized (the watchlist needs a plex.tv token)"
                )
            if resp.is_error:
                raise ServiceUnavailable(self.name, f"watchlist: HTTP {resp.status_code}")
            container = resp.json().get("MediaContainer", {})
            batch = container.get("Metadata") or []
            items += batch
            if len(batch) < WATCHLIST_PAGE or len(items) >= (container.get("totalSize") or 0):
                break
        return items

    async def accounts(self) -> dict[int, str]:
        container = (await self.get("/accounts")).get("MediaContainer", {})
        return {a["id"]: a.get("name") or "" for a in container.get("Account") or [] if "id" in a}

    async def sessions(self) -> list:
        container = (await self.get("/status/sessions")).get("MediaContainer", {})
        return container.get("Metadata") or []
