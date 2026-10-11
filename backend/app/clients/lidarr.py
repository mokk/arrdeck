from typing import Any

import httpx

from .base import ArrClient

# a fresh term sends Lidarr to its metadata server, and adding an artist pulls
# their whole discography from it before Lidarr answers
SLOW_TIMEOUT = 90.0


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

    async def get_artist(self, artist_id: int) -> dict:
        return await self.get(f"/artist/{artist_id}")

    async def update_artist(self, artist_id: int, payload: dict, move_files: bool = False) -> dict:
        return await self.request(
            "PUT",
            f"/artist/{artist_id}",
            params={"moveFiles": str(move_files).lower()},
            json=payload,
            timeout=30.0,
        )

    async def delete_artist(self, artist_id: int, delete_files: bool) -> None:
        await self.request(
            "DELETE",
            f"/artist/{artist_id}",
            params={"deleteFiles": str(delete_files).lower(), "addImportListExclusion": "false"},
            timeout=60.0,
        )

    async def monitor_albums(self, album_ids: list[int], monitored: bool) -> None:
        """The monitored flag alone. PUT /album/{id} wants the whole resource
        back, releases and all; this is what Lidarr's own toggle sends."""
        await self.request(
            "PUT", "/album/monitor", json={"albumIds": album_ids, "monitored": monitored}
        )

    async def tracks(self, album_id: int) -> list:
        """The tracks of the album's chosen release, each with hasFile and
        its trackFileId."""
        return await self.get("/track", params={"albumId": album_id})

    async def track_files(self, album_id: int) -> list:
        return await self.get("/trackfile", params={"albumId": album_id})

    async def delete_track_files(self, file_ids: list[int]) -> None:
        await self.request("DELETE", "/trackfile/bulk", json={"trackFileIds": file_ids})

    async def history_album(self, album_id: int) -> list:
        payload = await self.get(
            "/history",
            params={
                "pageSize": 100,
                "page": 1,
                "sortKey": "date",
                "sortDirection": "descending",
                "albumId": album_id,
            },
        )
        return payload.get("records", [])

    async def search(self, term: str) -> list:
        """Artists and albums in one list: {foreignId, artist} or {foreignId, album}."""
        return await self.get("/search", params={"term": term}, timeout=SLOW_TIMEOUT)

    async def lookup_artist(self, term: str) -> list:
        return await self.get("/artist/lookup", params={"term": term}, timeout=SLOW_TIMEOUT)

    async def lookup_album(self, term: str) -> list:
        return await self.get("/album/lookup", params={"term": term}, timeout=SLOW_TIMEOUT)

    async def add_artist(self, payload: dict) -> dict:
        return await self.request("POST", "/artist", json=payload, timeout=SLOW_TIMEOUT)

    async def add_album(self, payload: dict) -> dict:
        """Adds the album, and its artist first when Lidarr does not have them."""
        return await self.request("POST", "/album", json=payload, timeout=SLOW_TIMEOUT)

    async def bulk_edit(self, payload: dict) -> None:
        await self.request("PUT", "/artist/editor", json=payload, timeout=30.0)

    async def bulk_delete(
        self, artist_ids: list[int], delete_files: bool, exclude: bool = False
    ) -> None:
        await self.request(
            "DELETE",
            "/artist/editor",
            json={
                "artistIds": artist_ids,
                "deleteFiles": delete_files,
                "addImportListExclusion": exclude,
            },
            timeout=60.0,
        )

    async def blocklist_clear(self) -> None:
        """Lidarr's bulk delete removes the ids it is given and nothing else."""
        ids: list[int] = []
        page = 1
        while True:
            payload = await self.blocklist(page, page_size=1000)
            records = payload.get("records") or []
            ids += [r["id"] for r in records if "id" in r]
            if not records or len(ids) >= (payload.get("totalRecords") or 0):
                break
            page += 1
        if ids:
            await self.request("DELETE", "/blocklist/bulk", json={"ids": ids})

    async def open_media_cover(self, path: str) -> httpx.Response:
        """One of Lidarr's own copies of an artist's artwork
        (`artist/<id>/poster-250.jpg`). Lidarr reports these as paths inside
        its container, which only its API can serve."""
        return await self.http.get(
            f"{self.base_url}{self.api_prefix}/mediacover/{path}",
            headers={"X-Api-Key": self.api_key},
            timeout=15.0,
        )

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
