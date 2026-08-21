"""Movies, series, episodes, discovery, calendar, history and indexers."""

from typing import Literal

from pydantic import BaseModel

from .common import ServiceBlock
from .system import HealthItemOut


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


class CalendarResponse(BaseModel):
    radarr: ServiceBlock[list[CalendarItemOut]]
    sonarr: ServiceBlock[list[CalendarItemOut]]


class HistoryResponse(BaseModel):
    radarr: ServiceBlock[list[HistoryItemOut]]
    sonarr: ServiceBlock[list[HistoryItemOut]]


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
    tags: list[int] = []
    tmdb_id: int | None = None
    imdb_id: str | None = None


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
    tags: list[int] = []
    tvdb_id: int | None = None
    imdb_id: str | None = None


class SeasonOut(BaseModel):
    number: int
    monitored: bool
    episode_count: int = 0
    episode_file_count: int = 0
    size_on_disk: int = 0


class SeriesDetailOut(BaseModel):
    """Deliberately mirrors MovieDetailOut, so the two detail pages can show the
    same things. The extra fields are the ones with no film equivalent: a series
    has a network and an air time, and its "is it on disk" answer is a ratio of
    episodes rather than a single file."""

    id: int
    title: str | None = None
    year: int | None = None
    overview: str | None = None
    poster: str | None = None
    status: str | None = None  # continuing | ended | upcoming
    runtime: int | None = None  # minutes per episode
    path: str | None = None
    monitored: bool = False
    size_on_disk: int = 0
    quality_profile_id: int | None = None
    imdb_id: str | None = None
    tvdb_id: int | None = None
    tmdb_id: int | None = None
    network: str | None = None
    air_time: str | None = None
    certification: str | None = None
    genres: list[str] = []
    # Whole-series totals. episode_count counts what has aired, which is what
    # the file ratio should be read against; total_episode_count includes
    # unaired episodes and is why the two differ.
    episode_count: int = 0
    episode_file_count: int = 0
    total_episode_count: int = 0
    season_count: int = 0
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


class TagOut(BaseModel):
    id: int
    label: str


class BulkEditIn(BaseModel):
    ids: list[int]
    monitored: bool | None = None
    quality_profile_id: int | None = None
    tags: list[int] | None = None
    # the arrs need to be told what to do with the tags they were handed
    apply_tags: Literal["add", "remove", "replace"] = "add"


class BulkDeleteIn(BaseModel):
    ids: list[int]
    delete_files: bool = False


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


class SubtitleSearchIn(BaseModel):
    kind: Literal["movie", "episode"]
    id: int
    series_id: int | None = None


class MediaRequestOut(BaseModel):
    id: int
    type: str  # movie | tv
    status: int  # 1 pending, 2 approved, 3 declined, 4 available
    title: str = ""
    year: str | None = None
    poster: str | None = None
    requested_by: str = ""
    created_at: str | None = None
    seasons: list[int] = []


class PopularReleaseOut(BaseModel):
    guid: str = ""
    indexer_id: int = 0
    title: str = ""
    category: str | None = None
    kind: str = ""  # movie | tv
    size: int = 0
    seeders: int = 0
    leechers: int = 0
    grabs: int = 0
    published: str | None = None
    info_url: str | None = None


class PopularIndexerOut(BaseModel):
    indexer: str
    indexer_id: int
    scanned: int = 0  # unique releases seen inside the window
    releases: list[PopularReleaseOut] = []


class PopularSnapshotOut(BaseModel):
    generated_at: int = 0  # unix seconds; the page shows how fresh this is
    hours: int = 24
    indexers: list[PopularIndexerOut] = []


class ImportListOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    id: int
    name: str = ""
    implementation: str = ""
    enabled: bool = False
    enable_auto: bool = False  # add items automatically, not just track them
    monitor: str | None = None
    quality_profile_id: int | None = None
    root_folder: str | None = None
