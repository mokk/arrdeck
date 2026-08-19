from typing import Generic, Literal, TypeVar

from pydantic import BaseModel

T = TypeVar("T")

ServiceName = Literal[
    "radarr", "sonarr", "prowlarr", "qbittorrent", "transmission", "overseerr"
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


class TorrentOut(BaseModel):
    client: Literal["qbittorrent", "transmission"]
    id: str  # qbit hash / transmission id as string
    name: str
    state: str  # downloading|seeding|paused|stalled|checking|queued|error|completed
    progress: float  # 0..1
    size: int
    dl_speed: int
    ul_speed: int
    eta: int | None = None  # seconds, None if unknown/infinite
    ratio: float | None = None
    added_on: int | None = None  # unix seconds
    tracker: str | None = None  # tracker hostname, e.g. torrentleech.org
    error: str | None = None


class TransferTotals(BaseModel):
    dl_speed: int
    ul_speed: int


class TorrentGroupOut(BaseModel):
    torrents: list[TorrentOut]
    totals: TransferTotals


class QueueItemOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    id: int
    title: str
    status: str
    tracked_state: str | None = None
    size: float
    size_left: float
    time_left: str | None = None
    errors: list[str] = []
    # enables blocklist-&-retry from the UI
    movie_id: int | None = None
    series_id: int | None = None
    episode_id: int | None = None


class CalendarItemOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    title: str
    date: str | None = None
    has_file: bool = False
    extra: str | None = None  # e.g. S01E02 episode title
    release_type: str | None = None  # cinema | digital | physical (movies)


class HistoryEventOut(BaseModel):
    type: str  # friendly label: fetched, imported, failed, deleted, ...
    date: str


class HistoryItemOut(BaseModel):
    """One release/torrent with every history event that happened to it."""

    app: Literal["radarr", "sonarr"]
    title: str
    date: str  # most recent event date (sort key)
    quality: str | None = None
    events: list[HistoryEventOut] = []
    movie_id: int | None = None
    series_id: int | None = None


class SearchResultOut(BaseModel):
    kind: Literal["movie", "series"]
    title: str
    year: int | None = None
    overview: str | None = None
    remote_id: int  # tmdbId for movies, tvdbId for series
    poster: str | None = None
    in_library: bool = False
    # external references for links (IMDb / TMDB; remote_id covers TVDB)
    imdb_id: str | None = None
    tmdb_id: int | None = None
    # set when in_library — enables editing straight from the Add page
    library_id: int | None = None
    monitored: bool | None = None
    quality_profile_id: int | None = None
    has_file: bool | None = None  # movie downloaded / series 100% complete


class ReleaseOut(BaseModel):
    guid: str
    indexer_id: int
    indexer: str | None = None
    title: str
    size: int | None = None
    seeders: int | None = None
    leechers: int | None = None
    age_days: float | None = None
    download_url: str | None = None


class TorrentActionIn(BaseModel):
    ids: list[str]


class TorrentDeleteIn(BaseModel):
    ids: list[str]
    delete_data: bool = False


class AddMovieIn(BaseModel):
    tmdb_id: int
    title: str
    quality_profile_id: int
    root_folder_path: str
    monitored: bool = True
    search_now: bool = True


class AddSeriesIn(BaseModel):
    tvdb_id: int
    title: str
    quality_profile_id: int
    root_folder_path: str
    monitored: bool = True
    season_folder: bool = True
    search_now: bool = True


class GrabIn(BaseModel):
    guid: str
    indexer_id: int


class LibraryUpdateIn(BaseModel):
    monitored: bool | None = None
    quality_profile_id: int | None = None


# ---- typed aggregate/list responses (kept explicit so the OpenAPI spec is
# complete and openapi-typescript generates accurate frontend types) ----


class QueueResponse(BaseModel):
    radarr: ServiceBlock[list[QueueItemOut]]
    sonarr: ServiceBlock[list[QueueItemOut]]


class TorrentsResponse(BaseModel):
    qbittorrent: ServiceBlock[TorrentGroupOut]
    transmission: ServiceBlock[TorrentGroupOut]


class CalendarResponse(BaseModel):
    radarr: ServiceBlock[list[CalendarItemOut]]
    sonarr: ServiceBlock[list[CalendarItemOut]]


class HistoryResponse(BaseModel):
    radarr: ServiceBlock[list[HistoryItemOut]]
    sonarr: ServiceBlock[list[HistoryItemOut]]


class HealthItemOut(BaseModel):
    type: str | None = None
    message: str | None = None


class IndexerStatOut(BaseModel):
    name: str | None = None
    queries: int = 0
    grabs: int = 0
    avg_response_ms: int = 0


class IndexerStatsOut(BaseModel):
    enabled: int
    total: int
    health: list[HealthItemOut]
    stats: list[IndexerStatOut]


class QualityProfileOut(BaseModel):
    id: int
    name: str


class RootFolderOut(BaseModel):
    id: int
    path: str
    free_space: int | None = None


class OptionsOut(BaseModel):
    quality_profiles: list[QualityProfileOut]
    root_folders: list[RootFolderOut]


class IndexerOut(BaseModel):
    id: int
    name: str | None = None
    enable: bool = False
    protocol: str | None = None
    privacy: str | None = None


class LibraryMovieOut(BaseModel):
    id: int
    title: str | None = None
    year: int | None = None
    monitored: bool = False
    has_file: bool = False
    size_on_disk: int = 0
    quality_profile_id: int | None = None
    poster: str | None = None


class LibrarySeriesOut(BaseModel):
    id: int
    title: str | None = None
    year: int | None = None
    monitored: bool = False
    status: str | None = None
    episode_count: int = 0
    episode_file_count: int = 0
    size_on_disk: int = 0
    quality_profile_id: int | None = None
    poster: str | None = None


class ServiceInfoOut(BaseModel):
    service: str
    configured: bool


class ServiceSettingsOut(BaseModel):
    url: str = ""
    api_key: str = ""
    username: str = ""
    password: str = ""
    configured: bool = False


class TorrentFileOut(BaseModel):
    name: str
    size: int
    progress: float  # 0..1
    index: int = 0
    wanted: bool = True


class TrackerOut(BaseModel):
    host: str
    ok: bool = True
    message: str | None = None


class TorrentDetailsOut(BaseModel):
    files: list[TorrentFileOut]
    dl_limit_kib: int = 0  # 0 = unlimited
    ul_limit_kib: int = 0
    category: str | None = None  # qbittorrent only
    categories: list[str] = []
    trackers: list[TrackerOut] = []


class TorrentLimitsIn(BaseModel):
    dl_kib: int = 0
    ul_kib: int = 0


class TorrentCategoryIn(BaseModel):
    category: str


class SeasonOut(BaseModel):
    number: int
    monitored: bool
    episode_count: int = 0
    episode_file_count: int = 0
    size_on_disk: int = 0


class SeriesDetailOut(BaseModel):
    id: int
    title: str | None = None
    poster: str | None = None
    seasons: list[SeasonOut]


class EpisodeOut(BaseModel):
    id: int
    season: int
    episode: int
    title: str | None = None
    air_date: str | None = None
    has_file: bool = False
    monitored: bool = False


class MonitorIn(BaseModel):
    monitored: bool


class EpisodeMonitorIn(BaseModel):
    ids: list[int]
    monitored: bool


class EpisodeIdsIn(BaseModel):
    ids: list[int]


class ArrReleaseOut(BaseModel):
    guid: str
    indexer_id: int
    indexer: str | None = None
    title: str
    quality: str | None = None
    size: int | None = None
    seeders: int | None = None
    leechers: int | None = None
    age_days: float | None = None
    approved: bool = True
    rejections: list[str] = []


class HistoryPageOut(BaseModel):
    items: list[HistoryItemOut]
    has_more: bool = False


class RecentItemOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    title: str
    subtitle: str | None = None
    date: str
    poster: str | None = None
    library_id: int | None = None


class WantedItemOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    id: int  # movieId for radarr, episodeId for sonarr
    library_id: int  # movieId / seriesId (for interactive search + navigation)
    title: str
    subtitle: str | None = None
    air_date: str | None = None
    poster: str | None = None


class WantedPageOut(BaseModel):
    items: list[WantedItemOut]
    total: int = 0
    has_more: bool = False


class CollectionOut(BaseModel):
    id: int
    title: str | None = None
    monitored: bool = False
    movie_count: int = 0
    missing_count: int = 0
    poster: str | None = None


class CollectionDetailOut(BaseModel):
    id: int
    title: str | None = None
    monitored: bool = False
    overview: str | None = None
    poster: str | None = None
    movies: list[SearchResultOut] = []


class BulkEditIn(BaseModel):
    ids: list[int]
    monitored: bool | None = None
    quality_profile_id: int | None = None


class BulkDeleteIn(BaseModel):
    ids: list[int]
    delete_files: bool = False


class SettingsExportOut(BaseModel):
    services: dict[str, ServiceSettingsOut]


class SettingsImportIn(BaseModel):
    services: dict[str, dict]


class TorrentFileToggleIn(BaseModel):
    index: int
    wanted: bool


class TorrentSummaryOut(BaseModel):
    totals: TransferTotals
    count: int = 0
    active_count: int = 0
    active: list[TorrentOut] = []


class TorrentsSummaryResponse(BaseModel):
    qbittorrent: ServiceBlock[TorrentSummaryOut]
    transmission: ServiceBlock[TorrentSummaryOut]


class MovieFileOut(BaseModel):
    quality: str | None = None
    size: int = 0
    resolution: str | None = None
    release_group: str | None = None


class MovieDetailOut(BaseModel):
    id: int
    title: str | None = None
    year: int | None = None
    overview: str | None = None
    poster: str | None = None
    status: str | None = None
    runtime: int | None = None
    path: str | None = None
    monitored: bool = False
    has_file: bool = False
    size_on_disk: int = 0
    quality_profile_id: int | None = None
    imdb_id: str | None = None
    tmdb_id: int | None = None
    file: MovieFileOut | None = None
    history: list[HistoryEventOut] = []


class PushSubscribeIn(BaseModel):
    subscription: dict


class PushEventOut(BaseModel):
    key: str
    label: str


class PushEventsOut(BaseModel):
    available: list[PushEventOut]
    enabled: list[str]


class PushEventsIn(BaseModel):
    enabled: list[str]


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
    movies: int = 0
    series: int = 0
    episode_files: int = 0
    library_bytes: int = 0
    torrents_qbit: int = 0
    torrents_tm: int = 0
    indexer_grabs: int = 0
    indexer_queries: int = 0
