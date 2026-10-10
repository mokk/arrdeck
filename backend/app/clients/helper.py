"""The host helper (host-helper/arrdeck_helper.py): restarts compose projects on
arrdeck's behalf, so arrdeck never holds the docker socket. It listens on the
host's loopback, which containers reach as host.docker.internal."""

from typing import Any

import httpx

from .base import BaseClient, ServiceUnavailable

HELPER_URL = "http://host.docker.internal:8790"
# the helper waits for `docker compose` to finish, and gives it 300 s
ACTION_TIMEOUT = 320.0


class HelperError(Exception):
    """The helper answered, and said no: unknown project, too soon, or the
    compose command failed. Distinct from ServiceUnavailable, which means it
    could not be asked at all."""

    def __init__(self, status: int, message: str, retry_after: int | None = None) -> None:
        self.status = status
        self.message = message
        self.retry_after = retry_after
        super().__init__(message)


class HelperClient(BaseClient):
    name = "helper"

    def __init__(self, http: httpx.AsyncClient, token: str, base_url: str = HELPER_URL) -> None:
        super().__init__(http)
        self.base_url = (base_url or HELPER_URL).rstrip("/")
        self.token = token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

    def _check(self, resp: httpx.Response) -> Any:
        if resp.status_code == 401:
            raise ServiceUnavailable(self.name, "unauthorized (check the helper token)")
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if resp.status_code >= 400:
            message = (body or {}).get("error") or f"helper HTTP {resp.status_code}"
            raise HelperError(resp.status_code, message, (body or {}).get("retry_after"))
        return body

    async def get(self, path: str) -> Any:
        resp = await self._request("GET", f"{self.base_url}{path}", headers=self._headers())
        return self._check(resp)

    async def health(self) -> dict:
        return await self.get("/health")

    async def projects(self) -> list[dict]:
        return (await self.get("/projects")).get("projects") or []

    async def action(self, project: str, action: str) -> dict:
        # Straight to httpx rather than _request: that turns any 5xx into a
        # generic "upstream HTTP 502", and the helper's 502 carries the compose
        # error worth showing. A POST is never retried anyway.
        try:
            resp = await self.http.post(
                f"{self.base_url}/projects/{project}/{action}",
                headers=self._headers(),
                timeout=ACTION_TIMEOUT,
            )
        except httpx.HTTPError as exc:
            raise ServiceUnavailable(self.name, str(exc) or type(exc).__name__) from exc
        return self._check(resp)
