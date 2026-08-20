"""Shared envelope types: the ServiceBlock wrapper and service identity."""

from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")
ServiceName = Literal[
    "radarr", "sonarr", "prowlarr", "qbittorrent", "transmission", "overseerr", "gluetun",
    "bazarr", "plex", "prometheus",
]


class ServiceBlock(BaseModel, Generic[T]):
    """Wrapper used by every aggregate endpoint: a dead upstream never fails
    the response, it just yields ok=false (optionally with stale data)."""

    ok: bool
    data: T | None = None
    error: str | None = None
    stale_age_seconds: float | None = None


class ServiceStatus(BaseModel):
    service: ServiceName
    ok: bool
    version: str | None = None
    error: str | None = None


class ServiceInfoOut(BaseModel):
    service: str
    configured: bool


class ServiceSettingsOut(BaseModel):
    url: str = ""
    api_key: str = ""
    username: str = ""
    password: str = ""
    configured: bool = False
