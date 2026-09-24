"""Services, auth, push, backups, health and the media-server integrations."""

from typing import Any, Literal

from pydantic import BaseModel, Field

from .common import ServiceSettingsOut


class HealthItemOut(BaseModel):
    type: str | None = None
    message: str | None = None
    # Which check produced it. "UpdateCheck" is a notice rather than a fault, and
    # without this the diagnosis reported "a new version is available" as an
    # indexer failure.
    source: str | None = None


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
    # The device's language, so notification text can be rendered in it. A
    # service worker cannot read the app's stored preference, so it has to come
    # down in the payload — which means the server has to know it.
    language: str | None = None


class WatchedItemOut(BaseModel):
    watched: bool = False
    progress: float = 0.0  # shows: watched episodes / total
    # Plex's rating key, not a full URL. Every entry shared the same
    # app.plex.tv/#!/server/{id} prefix, which was two thirds of a ~98 KB payload
    # across ~590 entries; the prefix now ships once as WatchedMapOut.base_url.
    key: str | None = None
    last_viewed_at: int | None = None  # unix seconds, the cleanup assistant's clock


class WatchedEpisodeOut(BaseModel):
    season: int
    episode: int


class WatchedMapOut(BaseModel):
    base_url: str | None = None
    items: dict[str, WatchedItemOut] = {}


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
    # Bazarr's `providers` badge counts *throttled* providers, not configured
    # ones, so zero is the healthy answer. It was read as "none configured",
    # which warned permanently on a working setup and went quiet exactly when a
    # provider started failing.
    throttled_providers: int = 0
    items: list[SubtitleItemOut] = []


class SubtitleWantedOut(BaseModel):
    items: list[SubtitleItemOut] = []
    total: int = 0


class LanguageProfileOut(BaseModel):
    id: int
    name: str
    languages: list[str] = []  # two-letter codes, in the profile's order


class SubtitleTitleOut(BaseModel):
    kind: Literal["movie", "series"]
    id: int  # radarrId, or sonarrSeriesId
    title: str = ""
    year: str | None = None
    profile_id: int | None = None  # None: Bazarr fetches nothing for it


class ProfileAssignIn(BaseModel):
    kind: Literal["movie", "series"]
    ids: list[int] = Field(min_length=1, max_length=1000)
    profile_id: int | None = None


class SubtitleTrackOut(BaseModel):
    language: str  # Bazarr's display name, e.g. Danish
    code: str  # two-letter code, what the download call takes
    forced: bool = False
    hi: bool = False  # hearing impaired
    path: str | None = None  # present subtitles only


class TitleSubtitlesOut(BaseModel):
    # False when Bazarr does not track this title (no language profile, or not
    # synced yet); the clients then say so instead of showing "nothing missing".
    tracked: bool = True
    present: list[SubtitleTrackOut] = []
    missing: list[SubtitleTrackOut] = []


class EpisodeSubtitlesOut(BaseModel):
    episode_id: int
    season: int = 0
    episode: int = 0
    subtitles: TitleSubtitlesOut


class SubtitleDownloadIn(BaseModel):
    language: str  # two-letter code
    hi: bool = False
    forced: bool = False


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


class ScheduledTaskOut(BaseModel):
    app: str
    name: str  # taskName, e.g. RssSync — stable across versions, unlike name
    label: str  # the arr's own display name
    interval_minutes: int = 0
    last_execution: str | None = None
    next_execution: str | None = None
    last_duration_seconds: float | None = None
    # Late by more than the grace period for its interval. A task that runs every
    # minute being seconds late is normal; one that runs hourly being an hour late
    # means the arr's scheduler is wedged.
    overdue: bool = False
    overdue_by_seconds: float | None = None
    # Whether this is one of the tasks worth showing without expanding the card.
    notable: bool = False


class ArrBackupOut(BaseModel):
    app: str
    name: str
    kind: str = ""  # the arr's "type": scheduled | manual | update
    size_bytes: int = 0
    time: str | None = None
    url: str | None = None


class QualityItemOut(BaseModel):
    name: str
    allowed: bool = False
    # Radarr and Sonarr both group the WEB qualities, e.g. "WEB 1080p" holding
    # WEBDL-1080p and WEBRip-1080p, and a profile can allow the group as a unit.
    is_group: bool = False
    members: list[str] = []
    # The quality the profile upgrades *until*. Higher qualities can still be
    # allowed above it, which is the whole point of the setting.
    is_cutoff: bool = False


class CustomFormatScoreOut(BaseModel):
    name: str
    score: int


class QualityProfileDetailOut(BaseModel):
    id: int
    name: str
    upgrade_allowed: bool = False
    cutoff: str | None = None
    min_format_score: int = 0
    # Best first, matching the arr's own UI. The API returns them worst first.
    items: list[QualityItemOut] = []
    format_scores: list[CustomFormatScoreOut] = []


class QualityDefinitionOut(BaseModel):
    name: str
    # Megabytes per minute of runtime — the arrs reject a release outside this
    # band regardless of what any profile allows, which is why it belongs next to
    # the profiles rather than in a settings screen of its own.
    min_size: float | None = None
    preferred_size: float | None = None
    max_size: float | None = None


class QualityProfilesOut(BaseModel):
    profiles: list[QualityProfileDetailOut] = []
    # The arr's global size table. Ordered by the arr's own weight, worst first,
    # so it reads like the quality ladder.
    quality_definitions: list[QualityDefinitionOut] = []
    # Names defined in the arr, whether or not any profile scores them. Empty is
    # a real answer worth showing rather than an empty card.
    custom_formats: list[str] = []


class DiagnosisFindingOut(BaseModel):
    # A translation key suffix rather than a sentence: the app ships English and
    # Danish, so the wording belongs in the locale files.
    code: str
    level: str  # ok | info | warning | blocked
    # Any, not a typed union. The union used to exist to stop pydantic coercing
    # True to 1 (bool had to come first), which Any also avoids — and the union
    # rendered as a nullable anyOf inside additionalProperties in the OpenAPI
    # spec, which swift-openapi-generator turns into Swift that does not
    # compile. Values here are heterogeneous display material either way; a
    # test pins the no-coercion behaviour.
    params: dict[str, Any] = {}


class DiagnosisOut(BaseModel):
    app: str
    id: int
    title: str | None = None
    findings: list[DiagnosisFindingOut] = []


class OpdsSettingsOut(BaseModel):
    enabled: bool = False
    # the secret path segment; the client builds the URL from its own origin
    token: str | None = None
    # the feed serves files through the Readarr fork; without it there is nothing to offer
    available: bool = False
