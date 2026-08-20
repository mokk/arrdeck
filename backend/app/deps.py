from fastapi import Request

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

# Getters return the live client, or an Unconfigured stand-in whose calls
# raise ServiceUnavailable — aggregates degrade, direct endpoints 502.


def get_radarr(request: Request) -> RadarrClient:
    return request.app.state.registry.get("radarr")


def get_sonarr(request: Request) -> SonarrClient:
    return request.app.state.registry.get("sonarr")


def get_prowlarr(request: Request) -> ProwlarrClient:
    return request.app.state.registry.get("prowlarr")


def get_qbit(request: Request) -> QbittorrentClient:
    return request.app.state.registry.get("qbittorrent")


def get_transmission(request: Request) -> TransmissionClient:
    return request.app.state.registry.get("transmission")


def get_overseerr(request: Request) -> OverseerrClient:
    return request.app.state.registry.get("overseerr")


def get_gluetun(request: Request) -> GluetunClient:
    return request.app.state.registry.get("gluetun")


def get_bazarr(request: Request) -> BazarrClient:
    return request.app.state.registry.get("bazarr")


def get_plex(request: Request) -> PlexClient:
    return request.app.state.registry.get("plex")


def get_prometheus(request: Request) -> PrometheusClient:
    return request.app.state.registry.get("prometheus")
