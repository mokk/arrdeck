from typing import Any

from .base import ArrClient


class SonarrClient(ArrClient):
    name = "sonarr"

    async def queue(self) -> dict:
        # includeUnknownSeriesItems: see the note in RadarrClient.queue
        return await self.get(
            "/queue",
            params={
                "pageSize": 50,
                "includeSeries": "true",
                "includeUnknownSeriesItems": "true",
            },
        )

    async def calendar(self, start: str, end: str) -> list:
        return await self.get(
            "/calendar", params={"start": start, "end": end, "includeSeries": "true"}
        )

    async def series(self) -> list:
        return await self.get("/series")

    async def lookup(self, term: str) -> list:
        return await self.get("/series/lookup", params={"term": term})

    async def add_series(self, payload: dict) -> dict:
        return await self.request("POST", "/series", json=payload)

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

    async def get_series(self, series_id: int) -> dict:
        return await self.get(f"/series/{series_id}")

    async def episodes(self, series_id: int) -> list:
        return await self.get("/episode", params={"seriesId": series_id})

    async def monitor_episodes(self, episode_ids: list[int], monitored: bool) -> None:
        await self.request(
            "PUT", "/episode/monitor", json={"episodeIds": episode_ids, "monitored": monitored}
        )

    async def update_series(self, series_id: int, payload: dict) -> dict:
        return await self.request("PUT", f"/series/{series_id}", json=payload)

    async def wanted(self, kind: str, page: int = 1, page_size: int = 30) -> dict:
        # kind: "missing" | "cutoff"
        return await self.get(
            f"/wanted/{kind}",
            params={
                "page": page,
                "pageSize": page_size,
                "sortKey": "airDateUtc",
                "sortDirection": "descending",
                "monitored": "true",
                "includeSeries": "true",
            },
        )

    async def manual_import(self, download_id: str) -> list:
        return await self.get(
            "/manualimport", params={"downloadId": download_id, "filterExistingFiles": "false"}
        )

    async def bulk_edit(self, payload: dict) -> None:
        await self.request("PUT", "/series/editor", json=payload)

    async def bulk_delete(self, series_ids: list[int], delete_files: bool) -> None:
        await self.request(
            "DELETE",
            "/series/editor",
            json={"seriesIds": series_ids, "deleteFiles": delete_files},
        )

    async def delete_series(self, series_id: int, delete_files: bool) -> None:
        await self.request(
            "DELETE",
            f"/series/{series_id}",
            params={"deleteFiles": str(delete_files).lower()},
        )
