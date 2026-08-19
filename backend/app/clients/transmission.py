from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable

TORRENT_FIELDS = [
    "id",
    "hashString",
    "name",
    "status",
    "percentDone",
    "totalSize",
    "rateDownload",
    "rateUpload",
    "eta",
    "uploadRatio",
    "uploadedEver",
    "errorString",
    "downloadDir",
    "peersConnected",
    "addedDate",
    "trackers",
]

# https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md
STATUS_NAMES = {
    0: "paused",
    1: "queued",  # check pending
    2: "checking",
    3: "queued",  # download pending
    4: "downloading",
    5: "queued",  # seed pending
    6: "seeding",
}


class TransmissionClient(BaseClient):
    name = "transmission"

    def __init__(self, http: httpx.AsyncClient, base_url: str) -> None:
        super().__init__(http)
        self.rpc_url = base_url.rstrip("/") + "/transmission/rpc"
        self._session_id: str | None = None

    async def rpc(self, method: str, arguments: dict | None = None) -> Any:
        body = {"method": method, "arguments": arguments or {}}
        headers = {}
        if self._session_id:
            headers["X-Transmission-Session-Id"] = self._session_id
        resp = await self._request("POST", self.rpc_url, json=body, headers=headers)
        if resp.status_code == 409:
            self._session_id = resp.headers.get("X-Transmission-Session-Id")
            headers["X-Transmission-Session-Id"] = self._session_id or ""
            resp = await self._request("POST", self.rpc_url, json=body, headers=headers)
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("result") != "success":
            raise ServiceUnavailable(self.name, f"rpc error: {payload.get('result')}")
        return payload.get("arguments", {})

    async def session(self) -> dict:
        return await self.rpc("session-get")

    async def session_stats(self) -> dict:
        return await self.rpc("session-stats")

    async def torrents(self) -> list:
        result = await self.rpc("torrent-get", {"fields": TORRENT_FIELDS})
        return result.get("torrents", [])

    async def torrent_details(self, torrent_id: int) -> dict:
        result = await self.rpc(
            "torrent-get",
            {
                "ids": [torrent_id],
                "fields": [
                    "files",
                    "fileStats",
                    "downloadLimit",
                    "downloadLimited",
                    "uploadLimit",
                    "uploadLimited",
                    "trackerStats",
                ],
            },
        )
        torrents = result.get("torrents", [])
        return torrents[0] if torrents else {}

    async def verify(self, ids: list[int]) -> None:
        await self.rpc("torrent-verify", {"ids": ids})

    async def set_files_wanted(self, torrent_id: int, indices: list[int], wanted: bool) -> None:
        key = "files-wanted" if wanted else "files-unwanted"
        await self.rpc("torrent-set", {"ids": [torrent_id], key: indices})

    async def set_limits(self, ids: list[int], dl_kib: int, ul_kib: int) -> None:
        await self.rpc(
            "torrent-set",
            {
                "ids": ids,
                "downloadLimit": dl_kib,
                "downloadLimited": dl_kib > 0,
                "uploadLimit": ul_kib,
                "uploadLimited": ul_kib > 0,
            },
        )

    async def queue_move(self, ids: list[int], position: str) -> None:
        # position: "top" | "bottom" | "up" | "down"
        await self.rpc(f"queue-move-{position}", {"ids": ids})

    async def alt_speed_enabled(self) -> bool:
        return bool((await self.session()).get("alt-speed-enabled"))

    async def set_alt_speed(self, enabled: bool) -> None:
        await self.rpc("session-set", {"alt-speed-enabled": enabled})

    async def add_torrent(
        self,
        url: str | None = None,
        metainfo_b64: str | None = None,
        paused: bool = False,
    ) -> None:
        args: dict = {"paused": paused}
        if url:
            args["filename"] = url
        elif metainfo_b64:
            args["metainfo"] = metainfo_b64
        result = await self.rpc("torrent-add", args)
        if "torrent-duplicate" in result:
            raise ServiceUnavailable(self.name, "torrent already added")

    async def start(self, ids: list[int]) -> None:
        await self.rpc("torrent-start", {"ids": ids})

    async def stop(self, ids: list[int]) -> None:
        await self.rpc("torrent-stop", {"ids": ids})

    async def remove(self, ids: list[int], delete_data: bool) -> None:
        await self.rpc("torrent-remove", {"ids": ids, "delete-local-data": delete_data})
