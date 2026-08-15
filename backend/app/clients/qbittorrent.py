import asyncio
from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable


class QbittorrentClient(BaseClient):
    """qBittorrent WebUI API v2.

    Normally reachable without login thanks to the AuthSubnetWhitelist, but if
    qBittorrent returns 403 (whitelist miss or expired session) we fall back to
    cookie login with the configured credentials and retry once.
    """

    name = "qbittorrent"

    def __init__(
        self, http: httpx.AsyncClient, base_url: str, username: str, password: str
    ) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self._login_lock = asyncio.Lock()

    async def _login(self) -> None:
        if not self.username:
            raise ServiceUnavailable(
                self.name, "403 Forbidden and no credentials configured"
            )
        async with self._login_lock:
            resp = await self._request(
                "POST",
                f"{self.base_url}/api/v2/auth/login",
                data={"username": self.username, "password": self.password},
            )
            if resp.status_code != 200 or resp.text.strip() != "Ok.":
                raise ServiceUnavailable(self.name, "login failed (check credentials)")

    async def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        resp = await self._request(method, f"{self.base_url}{path}", **kwargs)
        if resp.status_code == 403:
            await self._login()
            resp = await self._request(method, f"{self.base_url}{path}", **kwargs)
            if resp.status_code == 403:
                raise ServiceUnavailable(self.name, "403 Forbidden after login")
        resp.raise_for_status()
        return resp

    async def version(self) -> str:
        resp = await self.request("GET", "/api/v2/app/version")
        return resp.text

    async def torrents(self, hashes: list[str] | None = None) -> list:
        params = {"hashes": "|".join(hashes)} if hashes else None
        resp = await self.request("GET", "/api/v2/torrents/info", params=params)
        return resp.json()

    async def files(self, torrent_hash: str) -> list:
        resp = await self.request("GET", "/api/v2/torrents/files", params={"hash": torrent_hash})
        return resp.json()

    async def trackers(self, torrent_hash: str) -> list:
        resp = await self.request(
            "GET", "/api/v2/torrents/trackers", params={"hash": torrent_hash}
        )
        return resp.json()

    async def categories(self) -> dict:
        resp = await self.request("GET", "/api/v2/torrents/categories")
        return resp.json()

    async def recheck(self, hashes: list[str]) -> None:
        await self._torrent_action("recheck", hashes)

    async def set_limits(self, hashes: list[str], dl_bytes: int, ul_bytes: int) -> None:
        joined = "|".join(hashes)
        await self.request(
            "POST", "/api/v2/torrents/setDownloadLimit", data={"hashes": joined, "limit": dl_bytes}
        )
        await self.request(
            "POST", "/api/v2/torrents/setUploadLimit", data={"hashes": joined, "limit": ul_bytes}
        )

    async def add_torrent(
        self,
        url: str | None = None,
        file: tuple[str, bytes] | None = None,
        category: str = "",
        paused: bool = False,
    ) -> None:
        data: dict[str, str] = {}
        if category:
            data["category"] = category
        if paused:
            # 5.x renamed the flag; sending both is harmless
            data["stopped"] = "true"
            data["paused"] = "true"
        files = None
        if url:
            data["urls"] = url
        elif file:
            files = {"torrents": (file[0], file[1], "application/x-bittorrent")}
        resp = await self.request("POST", "/api/v2/torrents/add", data=data, files=files)
        if resp.text.strip().lower().startswith("fail"):
            raise ServiceUnavailable(self.name, "qBittorrent rejected the torrent")

    async def set_file_priority(self, torrent_hash: str, indices: list[int], priority: int) -> None:
        await self.request(
            "POST",
            "/api/v2/torrents/filePrio",
            data={"hash": torrent_hash, "id": "|".join(map(str, indices)), "priority": priority},
        )

    async def set_category(self, hashes: list[str], category: str) -> None:
        await self.request(
            "POST", "/api/v2/torrents/setCategory", data={"hashes": "|".join(hashes), "category": category}
        )

    async def transfer_info(self) -> dict:
        resp = await self.request("GET", "/api/v2/transfer/info")
        return resp.json()

    async def _torrent_action(self, action: str, hashes: list[str], **extra: str) -> None:
        await self.request(
            "POST", f"/api/v2/torrents/{action}", data={"hashes": "|".join(hashes), **extra}
        )

    async def pause(self, hashes: list[str]) -> None:
        # qBittorrent 5.x renamed pause/resume to stop/start
        try:
            await self._torrent_action("stop", hashes)
        except httpx.HTTPStatusError:
            await self._torrent_action("pause", hashes)

    async def resume(self, hashes: list[str]) -> None:
        try:
            await self._torrent_action("start", hashes)
        except httpx.HTTPStatusError:
            await self._torrent_action("resume", hashes)

    async def delete(self, hashes: list[str], delete_files: bool) -> None:
        await self._torrent_action(
            "delete", hashes, deleteFiles="true" if delete_files else "false"
        )
