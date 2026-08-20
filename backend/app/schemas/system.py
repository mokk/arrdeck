"""Services, auth, push, backups, health and the media-server integrations."""

from typing import Generic, Literal, TypeVar
from pydantic import BaseModel
T = TypeVar("T")
ServiceName = Literal[
    "radarr", "sonarr", "prowlarr", "qbittorrent", "transmission", "overseerr", "gluetun",
    "bazarr", "plex", "prometheus",
]

from .common import ServiceSettingsOut


class HealthItemOut(BaseModel):
    type: str | None = None
    message: str | None = None


class DiskSpaceOut(BaseModel):
    path: str
    label: str = ""
    free_bytes: int = 0
    total_bytes: int = 0


class HealthWarningOut(BaseModel):
    app: str
    level: str = "warning"  # arr "type": warning | error
    message: str = ""
    wiki_url: str | None = None
    source: str | None = None


class SettingsExportOut(BaseModel):
    services: dict[str, ServiceSettingsOut]


class SettingsImportIn(BaseModel):
    services: dict[str, dict]


class PushSubscribeIn(BaseModel):
    subscription: dict


class WatchedItemOut(BaseModel):
    watched: bool = False
    progress: float = 0.0  # shows: watched episodes / total
    url: str | None = None


class PlaySessionOut(BaseModel):
    title: str = ""
    subtitle: str | None = None  # SxxEyy – episode title
    kind: str = ""  # movie | episode
    user: str = ""
    player: str = ""
    state: str = ""  # playing | paused | buffering
    progress: float = 0.0  # 0..1
    transcoding: bool = False
    url: str | None = None  # opens the item in Plex


class SubtitleItemOut(BaseModel):
    kind: str  # movie | episode
    id: int  # radarrId, or sonarrEpisodeId for episodes
    series_id: int | None = None  # episodes need both ids to search
    title: str = ""
    subtitle: str | None = None
    missing: list[str] = []


class SubtitlesOut(BaseModel):
    episodes: int = 0  # counts come straight from Bazarr's badges
    movies: int = 0
    providers: int = 0
    items: list[SubtitleItemOut] = []


class VpnStatusOut(BaseModel):
    status: str = ""  # running | stopped | ...
    public_ip: str = ""
    country: str | None = None
    city: str | None = None
    forwarded_port: int | None = None
    client_port: int | None = None  # qBittorrent's listen port
    port_matches: bool | None = None  # None when either side is unknown


class LogEntryOut(BaseModel):
    app: str
    time: str = ""
    level: str = ""
    logger: str = ""
    message: str = ""
    exception: str | None = None


class SessionOut(BaseModel):
    id: str  # a prefix of the token hash, enough to address it
    created: int
    last_used: int
    current: bool = False


class PushEventOut(BaseModel):
    key: str
    label: str


class PushEventsOut(BaseModel):
    available: list[PushEventOut]
    enabled: list[str]  # the global default
    device: list[str] | None = None  # this device's own set, if it has one


class PushEventsIn(BaseModel):
    enabled: list[str]
    # when set and subscribed, the choice applies to that device only
    endpoint: str = ""


class PushRulesOut(BaseModel):
    quiet_start: str = ""
    quiet_end: str = ""
    timezone: str = "UTC"
    tags: dict[str, list[int]] = {}
    quiet_now: bool = False  # whether the window is currently in effect


class PushRulesIn(BaseModel):
    quiet_start: str = ""
    quiet_end: str = ""
    timezone: str = "UTC"
    tags: dict[str, list[int]] = {}


class PushTestIn(BaseModel):
    endpoint: str = ""


class PushTestOut(BaseModel):
    sent: int


class WebhookAppOut(BaseModel):
    app: str
    configured: bool = False
    installed: bool = False
    url: str = ""
    error: str = ""


class WebhookStatusOut(BaseModel):
    base_url: str
    last_event: int | None = None  # unix seconds
    apps: list[WebhookAppOut]


class WebhookInstallIn(BaseModel):
    base_url: str


class StatsSampleOut(BaseModel):
    ts: int  # unix seconds
    disk_free_bytes: int = 0
    movies: int = 0
    series: int = 0
    episode_files: int = 0
    library_bytes: int = 0
    torrents_qbit: int = 0
    torrents_tm: int = 0
    indexer_grabs: int = 0
    indexer_queries: int = 0


class BackupOut(BaseModel):
    version: int = 1
    services: dict[str, ServiceSettingsOut] = {}
    kv: dict[str, str] = {}
    credentials: list[dict] = []
    push_subscriptions: list[dict] = []
    stats_samples: list[StatsSampleOut] = []


class RestoreIn(BaseModel):
    version: int = 1
    services: dict[str, dict] = {}
    kv: dict[str, str] = {}
    credentials: list[dict] = []
    push_subscriptions: list[dict] = []
    stats_samples: list[dict] = []


class RestoreOut(BaseModel):
    services: int = 0
    kv: int = 0
    credentials: int = 0
    push_subscriptions: int = 0
    stats: int = 0
