from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable


class GluetunClient(BaseClient):
    """gluetun's HTTP control server.

    Only the three read-only routes arrdeck needs are used; 3.38+ requires an
    API key per route, granted in /gluetun/auth/config.toml.
    """

    name = "gluetun"

    def __init__(self, http: httpx.AsyncClient, base_url: str, api_key: str) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def get(self, path: str, **kwargs: Any) -> Any:
        headers = kwargs.pop("headers", {})
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        resp = await self._request("GET", f"{self.base_url}{path}", headers=headers, **kwargs)
        if resp.status_code in (401, 403):
            raise ServiceUnavailable(
                self.name, "unauthorized — grant this route in gluetun's auth config"
            )
        resp.raise_for_status()
        return resp.json()

    async def status(self) -> dict:
        return await self.get("/v1/vpn/status")

    async def public_ip(self) -> dict:
        return await self.get("/v1/publicip/ip")

    async def port_forward(self) -> dict:
        # older builds answer on /v1/openvpn/portforwarded and redirect here
        return await self.get("/v1/portforward")
