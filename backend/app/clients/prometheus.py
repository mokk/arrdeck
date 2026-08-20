import httpx

from .base import BaseClient, ServiceUnavailable


class PrometheusClient(BaseClient):
    """Prometheus query API.

    Used to read unpackerr, which publishes metrics but no reachable port of its
    own — Prometheus already scrapes it on the compose network, so querying
    Prometheus avoids touching that stack's configuration.
    """

    name = "prometheus"

    def __init__(self, http: httpx.AsyncClient, base_url: str) -> None:
        super().__init__(http)
        self.base_url = base_url.rstrip("/")

    async def query(self, expr: str) -> list[dict]:
        resp = await self._request(
            "GET", f"{self.base_url}/api/v1/query", params={"query": expr}
        )
        resp.raise_for_status()
        payload = resp.json()
        if payload.get("status") != "success":
            raise ServiceUnavailable(self.name, str(payload.get("error") or "query failed"))
        return payload.get("data", {}).get("result") or []

    async def status(self) -> dict:
        resp = await self._request("GET", f"{self.base_url}/api/v1/status/buildinfo")
        resp.raise_for_status()
        return resp.json().get("data", {})

    async def scalars(self, expr: str, label: str = "name") -> dict[str, float]:
        """Instant vector -> {label value: number}, for the gauge/counter
        families unpackerr exposes as one metric with a name label."""
        out: dict[str, float] = {}
        for row in await self.query(expr):
            key = row.get("metric", {}).get(label) or ""
            try:
                out[key] = float(row["value"][1])
            except (KeyError, IndexError, ValueError):
                continue
        return out
