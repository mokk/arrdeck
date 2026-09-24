"""Movies, series, episodes, discovery, calendar, history and indexers."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .common import ServiceBlock
from .system import HealthItemOut


class CalendarItemOut(BaseModel):
    app: Literal["radarr", "sonarr", "readarr"]
    title: str
    date: str | None = None
    has_file: bool = False
    extra: str | None = None  # e.g. S01E02 episode title
    release_type: str | None = None  # cinema | digital | physical (movies)
    # The library id to open: the movie, the episode's series, the book.
    item_id: int | None = None
    poster: str | None = None
    # Sonarr: "season", "series" or "midseason" when the episode ends one
    finale_type: str | None = None


class HistoryEventOut(BaseModel):
    type: str  # friendly label: fetched, imported, failed, deleted, ...
    date: str


class HistoryItemOut(BaseModel):
    """One release/torrent with every history event that happened to it."""

    app: Literal["radarr", "sonarr", "readarr"]
    title: str
    date: str  # most recent event date (sort key)
    quality: str | None = None
    events: list[HistoryEventOut] = []
    movie_id: int | None = None
    series_id: int | None = None
    book_id: int | None = None


class SearchResultOut(BaseModel):
    kind: Literal["movie", "series", "book"]
    title: str
    year: int | None = None
    overview: str | None = None
    remote_id: int  # tmdbId for movies, tvdbId for series, the numeric foreign id for books
    # Books: Readarr's foreign (Goodreads-style) ids, and who wrote it. The
    # edition id is what the add call looks the book up by.
    foreign_id: str | None = None
    foreign_edition_id: str | None = None
    author: str | None = None
    # every edition Readarr offers, so the add sheet can pick a language/format
    editions: list["EditionChoiceOut"] = []
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


class EditionChoiceOut(BaseModel):
    foreign_edition_id: str
    title: str | None = None
    format: str | None = None
    language: str | None = None
    year: int | None = None
    page_count: int | None = None
    monitored: bool = False  # Readarr's own pick


class AddBookIn(BaseModel):
    foreign_book_id: str
    foreign_edition_id: str | None = None
    title: str
    quality_profile_id: int
    # Readarr keeps quality and metadata profiles on the author; a new author is
    # created with these, an existing one keeps their own.
    metadata_profile_id: int | None = None
    root_folder_path: str
    monitored: bool = True
    search_now: bool = True


class GrabIn(BaseModel):
    guid: str
    indexer_id: int


class CalendarResponse(BaseModel):
    radarr: ServiceBlock[list[CalendarItemOut]]
    sonarr: ServiceBlock[list[CalendarItemOut]]
    # Optional: older clients never asked, and a stack without Readarr has nothing to say.
    readarr: ServiceBlock[list[CalendarItemOut]] | None = None


class HistoryResponse(BaseModel):
    radarr: ServiceBlock[list[HistoryItemOut]]
    sonarr: ServiceBlock[list[HistoryItemOut]]
    readarr: ServiceBlock[list[HistoryItemOut]] | None = None


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
    # Readarr only: which metadata source/profile an author is matched with.
    metadata_profiles: list[QualityProfileOut] = []


class IndexerOut(BaseModel):
    id: int
    name: str | None = None
    enable: bool = False
    protocol: str | None = None
    privacy: str | None = None


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


class ActivityEventOut(BaseModel):
    """One thing that happened since the client last looked."""

    kind: Literal["imported", "failed", "fetched", "incomplete", "completed"]
    app: str  # radarr | sonarr | readarr | qbittorrent | transmission
    title: str
    date: str  # ISO 8601, UTC
    movie_id: int | None = None
    series_id: int | None = None
    book_id: int | None = None


class ActivitySinceOut(BaseModel):
    since: str
    now: str
    count: int
    items: list[ActivityEventOut] = []


class HistoryPageOut(BaseModel):
    items: list[HistoryItemOut]
    has_more: bool = False


class RecentItemOut(BaseModel):
    app: Literal["radarr", "sonarr", "readarr"]
    title: str
    subtitle: str | None = None
    date: str
    poster: str | None = None
    library_id: int | None = None


class WantedItemOut(BaseModel):
    app: Literal["radarr", "sonarr", "readarr"]
    id: int  # movieId for radarr, episodeId for sonarr
    library_id: int  # movieId / seriesId (for interactive search + navigation)
    title: str
    subtitle: str | None = None
    air_date: str | None = None
    poster: str | None = None
    # when the arr last went looking; None when it never has
    last_search: datetime | None = None


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
    app: Literal["radarr", "sonarr", "readarr"]
    id: int
    name: str = ""
    implementation: str = ""
    enabled: bool = False
    enable_auto: bool = False  # add items automatically, not just track them
    monitor: str | None = None
    quality_profile_id: int | None = None
    root_folder: str | None = None


class LibraryBookOut(BaseModel):
    id: int
    title: str | None = None
    author: str | None = None
    author_id: int | None = None
    year: int | None = None
    series_title: str | None = None
    monitored: bool = False
    has_file: bool = False
    size_on_disk: int = 0
    # The author's — Readarr keeps quality on the author, not the book.
    quality_profile_id: int | None = None
    poster: str | None = None
    page_count: int | None = None
    foreign_book_id: str | None = None
    # when the arr started monitoring it; the libraries sort on this by default
    added: datetime | None = None
    genres: list[str] = []
    rating: float | None = None  # Goodreads, out of 5
    slug: str | None = None


class BookFileOut(BaseModel):
    id: int
    name: str | None = None
    size: int = 0
    # Readarr's quality name doubles as the format: EPUB, MOBI, AZW3, PDF…
    format: str | None = None


class BookEditionOut(BaseModel):
    title: str | None = None
    format: str | None = None
    is_ebook: bool | None = None
    monitored: bool = False
    page_count: int | None = None


class SeriesBookOut(BaseModel):
    book_id: int
    position: str | None = None
    title: str | None = None
    monitored: bool = False
    has_file: bool = False
    poster: str | None = None
    year: int | None = None


class BookSeriesOut(BaseModel):
    id: int
    title: str | None = None
    books: list[SeriesBookOut] = []


class ShelfSeriesOut(BookSeriesOut):
    """A series on the bookshelf: every book in it, owned or not, so the gaps
    show. Only series with at least one book in the library are listed."""

    author: str | None = None
    author_id: int | None = None


class RequestStateOut(BaseModel):
    request_id: int
    status: int  # Overseerr's request status: 1 pending, 2 approved
    requested_by: str = ""


class AuthorOut(BaseModel):
    id: int
    name: str | None = None
    monitored: bool = False
    # Readarr: all | none | new — what happens to books it discovers later
    monitor_new_items: str | None = None
    poster: str | None = None
    quality_profile_id: int | None = None
    metadata_profile_id: int | None = None
    book_count: int = 0  # books Readarr tracks for this author
    available_count: int = 0  # of which are on disk
    size_on_disk: int = 0


class AuthorDetailOut(AuthorOut):
    overview: str | None = None
    # every book Readarr knows for this author, unmonitored ones included —
    # this is where a hidden book gets monitored again
    books: list[LibraryBookOut] = []
    series: list[BookSeriesOut] = []


class AuthorUpdateIn(BaseModel):
    monitored: bool | None = None
    monitor_new_items: Literal["all", "none", "new"] | None = None
    quality_profile_id: int | None = None
    metadata_profile_id: int | None = None


class BookDetailOut(BaseModel):
    id: int
    title: str | None = None
    author: str | None = None
    author_id: int | None = None
    overview: str | None = None
    poster: str | None = None
    release_date: str | None = None
    year: int | None = None
    page_count: int | None = None
    genres: list[str] = []
    series_title: str | None = None
    monitored: bool = False
    has_file: bool = False
    size_on_disk: int = 0
    quality_profile_id: int | None = None
    metadata_profile_id: int | None = None
    rating: float | None = None
    rating_votes: int | None = None
    goodreads_url: str | None = None
    editions: list[BookEditionOut] = []
    history: list[HistoryEventOut] = []
    files: list[BookFileOut] = []
    # True only when the connected Readarr is our fork, which serves the files
    # itself; upstream Readarr has no download endpoint.
    downloadable: bool = False
    # the series this book is part of, with what you have of each
    series: list[BookSeriesOut] = []


class ReadingOut(BaseModel):
    status: Literal["to_read", "reading", "read"]
    finished_at: int | None = None  # unix seconds, set when marked read
    updated_at: int = 0


class ReadingIn(BaseModel):
    # None clears it: the book goes back to having no reading status
    status: Literal["to_read", "reading", "read"] | None = None
