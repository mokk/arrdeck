from typing import Any

from .base import ArrClient


class RadarrClient(ArrClient):
    name = "radarr"

    async def queue(self) -> dict:
        return await self.get("/queue", params={"pageSize": 50})

    async def calendar(self, start: str, end: str) -> list:
        return await self.get("/calendar", params={"start": start, "end": end})

    async def movies(self) -> list:
        return await self.get("/movie")

    async def lookup(self, term: str) -> list:
        return await self.get("/movie/lookup", params={"term": term})

    async def add_movie(self, payload: dict) -> dict:
        return await self.request("POST", "/movie", json=payload)

    async def quality_profiles(self) -> list:
        return await self.get("/qualityprofile")

    async def root_folders(self) -> list:
        return await self.get("/rootfolder")

    async def delete_queue_item(
        self, item_id: int, remove_from_client: bool, blocklist: bool
    ) -> None:
        await self.request(
            "DELETE",
            f"/queue/{item_id}",
            params={
                "removeFromClient": str(remove_from_client).lower(),
                "blocklist": str(blocklist).lower(),
            },
        )

    async def command(self, payload: dict) -> Any:
        return await self.request("POST", "/command", json=payload)

    async def get_movie(self, movie_id: int) -> dict:
        return await self.get(f"/movie/{movie_id}")

    async def update_movie(self, movie_id: int, payload: dict) -> dict:
        return await self.request("PUT", f"/movie/{movie_id}", json=payload)

    async def delete_movie(self, movie_id: int, delete_files: bool) -> None:
        await self.request(
            "DELETE",
            f"/movie/{movie_id}",
            params={
                "deleteFiles": str(delete_files).lower(),
                "addImportExclusion": "false",
            },
        )
