from typing import Any

from .base import ArrClient


class LidarrClient(ArrClient):
    """Lidarr is Readarr's cousin on /api/v1: artists where Readarr has
    authors, albums where it has books. An album is imported into one of its
    releases (a pressing: CD, vinyl, digital), and each file into tracks."""

    name = "lidarr"
    api_prefix = "/api/v1"

    async def queue(self) -> dict:
        return await self.get(
            "/queue",
            params={
                "pageSize": 50,
                "includeUnknownArtistItems": "true",
                "includeAlbum": "true",
                "includeArtist": "true",
            },
        )

    async def calendar(self, start: str, end: str) -> list:
        return await self.get(
            "/calendar", params={"start": start, "end": end, "includeArtist": "true"}
        )

    async def history(self, page_size: int = 20, page: int = 1, **params: bool) -> dict:
        # Lidarr's records name a file, not the album it belongs to; with the
        # album and artist attached, a row can say what was imported
        return await super().history(
            page_size, page, **{"includeAlbum": True, "includeArtist": True, **params}
        )

    async def artists(self) -> list:
        return await self.get("/artist")

    async def albums(self, artist_id: int | None = None) -> list:
        params = {"artistId": artist_id} if artist_id is not None else None
        return await self.get("/album", params=params)

    async def get_album(self, album_id: int) -> dict:
        return await self.get(f"/album/{album_id}")

    async def manual_import(self, download_id: str) -> list:
        return await self.get(
            "/manualimport", params={"downloadId": download_id, "filterExistingFiles": "false"}
        )

    async def manual_import_reprocess(self, items: list[dict]) -> list:
        """Lidarr's answer to "these files are this album": it matches each
        file to tracks on the given release and returns the candidates again,
        tracks filled in. This is what its own import screen does when an
        album is picked by hand."""
        return await self.request("POST", "/manualimport", json=items, timeout=120.0) or []

    async def quality_profiles(self) -> list:
        return await self.get("/qualityprofile")

    async def metadata_profiles(self) -> list:
        return await self.get("/metadataprofile")

    async def root_folders(self) -> list:
        return await self.get("/rootfolder")

    async def command(self, payload: dict) -> Any:
        return await self.request("POST", "/command", json=payload)

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

    async def wanted(self, kind: str, page: int = 1, page_size: int = 30) -> dict:
        # kind: "missing" | "cutoff"; both list albums
        return await self.get(
            f"/wanted/{kind}",
            params={
                "page": page,
                "pageSize": page_size,
                "sortKey": "albums.releaseDate",
                "sortDirection": "descending",
                "monitored": "true",
                "includeArtist": "true",
            },
        )
