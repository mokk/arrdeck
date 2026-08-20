import httpx

from .clients.base import ServiceUnavailable
from .clients.bazarr import BazarrClient
from .clients.gluetun import GluetunClient
from .clients.plex import PlexClient
from .clients.prometheus import PrometheusClient
from .clients.overseerr import OverseerrClient
from .clients.prowlarr import ProwlarrClient
from .clients.qbittorrent import QbittorrentClient
from .clients.radarr import RadarrClient
from .clients.sonarr import SonarrClient
from .clients.transmission import TransmissionClient
from .db import SERVICES

NEEDS_API_KEY = {
    "radarr", "sonarr", "prowlarr", "overseerr", "gluetun", "bazarr", "plex",
}


def is_configured(name: str, conf: dict) -> bool:
    if not conf.get("url"):
        return False
    if name in NEEDS_API_KEY and not conf.get("api_key"):
        return False
    return True


class Unconfigured:
    """Stand-in client: every method call raises ServiceUnavailable, so
    aggregate endpoints degrade and direct endpoints 502 cleanly."""

    def __init__(self, name: str) -> None:
        self.name = name

    def __getattr__(self, item: str):
        async def _raise(*args, **kwargs):
            raise ServiceUnavailable(self.name, "not configured")

        return _raise


class Registry:
    def __init__(
        self,
        arr_http: httpx.AsyncClient,
        qbit_http: httpx.AsyncClient,
        tm_http: httpx.AsyncClient,
    ) -> None:
        self._arr_http = arr_http
        self._qbit_http = qbit_http
        self._tm_http = tm_http
        self._clients: dict[str, object | None] = {s: None for s in SERVICES}

    def rebuild(self, name: str, conf: dict) -> None:
        if not is_configured(name, conf):
            self._clients[name] = None
            return
        if name == "radarr":
            self._clients[name] = RadarrClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "sonarr":
            self._clients[name] = SonarrClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "prowlarr":
            self._clients[name] = ProwlarrClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "overseerr":
            self._clients[name] = OverseerrClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "qbittorrent":
            self._clients[name] = QbittorrentClient(
                self._qbit_http, conf["url"], conf.get("username", ""), conf.get("password", "")
            )
        elif name == "transmission":
            self._clients[name] = TransmissionClient(self._tm_http, conf["url"])
        elif name == "gluetun":
            self._clients[name] = GluetunClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "bazarr":
            self._clients[name] = BazarrClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "plex":
            self._clients[name] = PlexClient(self._arr_http, conf["url"], conf["api_key"])
        elif name == "prometheus":
            self._clients[name] = PrometheusClient(self._arr_http, conf["url"])

    def rebuild_all(self, confs: dict[str, dict]) -> None:
        for name in SERVICES:
            self.rebuild(name, confs.get(name, {}))

    def get(self, name: str):
        return self._clients.get(name) or Unconfigured(name)

    def is_configured(self, name: str) -> bool:
        return self._clients.get(name) is not None

    def configured(self) -> list[str]:
        return [n for n in SERVICES if self._clients.get(n) is not None]


async def probe_version(name: str, client) -> str:
    """Return the service's version string (raises ServiceUnavailable if down)."""
    if name in ("radarr", "sonarr", "prowlarr", "overseerr"):
        return (await client.status()).get("version", "?")
    if name == "qbittorrent":
        return await client.version()
    if name == "transmission":
        return (await client.session()).get("version", "?")
    if name == "gluetun":
        # no version endpoint; the tunnel state is the useful signal
        return (await client.status()).get("status", "?")
    if name == "bazarr":
        return (await client.status()).get("bazarr_version", "?")
    if name == "plex":
        return (await client.identity()).get("version", "?")
    if name == "prometheus":
        return (await client.status()).get("version", "?")
    raise ServiceUnavailable(name, "unknown service")
