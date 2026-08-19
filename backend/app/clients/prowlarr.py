from .base import ArrClient


class ProwlarrClient(ArrClient):
    name = "prowlarr"
    api_prefix = "/api/v1"

    async def indexers(self) -> list:
        return await self.get("/indexer")

    async def indexer_stats(self) -> dict:
        return await self.get("/indexerstats")

    async def search(
        self,
        query: str,
        categories: list[int] | None = None,
        indexer_ids: list[int] | None = None,
        limit: int = 0,
    ) -> list:
        params: dict = {"query": query, "type": "search"}
        if categories:
            params["categories"] = categories
        if indexer_ids:
            params["indexerIds"] = indexer_ids
        if limit:
            params["limit"] = limit
        # an empty query is an RSS-style fetch of the newest releases
        return await self.get("/search", params=params, timeout=90.0)

    async def grab(self, guid: str, indexer_id: int) -> dict:
        return await self.request(
            "POST", "/search", json={"guid": guid, "indexerId": indexer_id}
        )

    async def indexer_schemas(self) -> list:
        return await self.get("/indexer/schema")

    async def app_profiles(self) -> list:
        return await self.get("/appprofile")

    async def add_indexer(self, payload: dict) -> dict:
        # Prowlarr validates against the live site on add; its own HTTP
        # timeout is ~100s, so allow for the worst case
        return await self.request("POST", "/indexer", json=payload, timeout=120.0)

    async def update_indexer(self, indexer_id: int, payload: dict) -> dict:
        return await self.request("PUT", f"/indexer/{indexer_id}", json=payload)

    async def test_indexer(self, payload: dict) -> None:
        await self.request("POST", "/indexer/test", json=payload, timeout=120.0)
