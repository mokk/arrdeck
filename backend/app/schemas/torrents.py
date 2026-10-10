"""Torrent clients, the arr queue, manual import and renaming."""

from typing import Literal

from pydantic import BaseModel

from .common import ServiceBlock


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
    uploaded: int = 0  # bytes sent for this torrent, all time
    added_on: int | None = None  # unix seconds
    completed_on: int | None = None  # unix seconds, when the download finished
    tracker: str | None = None  # tracker hostname, e.g. torrentleech.org
    error: str | None = None
    tags: list[str] = []  # qBittorrent only


class TransferTotals(BaseModel):
    dl_speed: int
    ul_speed: int


class TorrentGroupOut(BaseModel):
    torrents: list[TorrentOut]
    totals: TransferTotals
    total: int = 0  # matches before the limit was applied
    states: list[str] = []  # every state present, so the filter can list them


class QueueStatusMessageOut(BaseModel):
    title: str = ""  # usually the file or release the messages are about
    messages: list[str] = []


class QueueItemOut(BaseModel):
    app: Literal["radarr", "sonarr", "readarr"]
    id: int
    title: str
    status: str
    tracked_state: str | None = None
    tracked_status: str | None = None  # ok | warning | error
    size: float
    size_left: float
    time_left: str | None = None
    # a release held by a delay profile: when it will be grabbed on its own
    estimated_completion: str | None = None
    errors: list[str] = []
    # every reason the arr gives, grouped as it groups them; `errors` keeps
    # only the first line of each for the compact rows
    status_messages: list[QueueStatusMessageOut] = []
    error_message: str | None = None  # the download client's own complaint
    # waiting on a person: blocked/failed imports, or the arr flagged it
    needs_attention: bool = False
    # enables blocklist-&-retry from the UI
    movie_id: int | None = None
    series_id: int | None = None
    episode_id: int | None = None
    book_id: int | None = None


class AttentionOut(BaseModel):
    count: int = 0
    items: list[QueueItemOut] = []
    # arrs whose queue could not be read, so the list may be incomplete
    unavailable: list[str] = []


class TorrentActionIn(BaseModel):
    ids: list[str]


class TorrentDeleteIn(BaseModel):
    ids: list[str]
    delete_data: bool = False


class QueueResponse(BaseModel):
    radarr: ServiceBlock[list[QueueItemOut]]
    sonarr: ServiceBlock[list[QueueItemOut]]
    readarr: ServiceBlock[list[QueueItemOut]] | None = None


class TorrentsResponse(BaseModel):
    qbittorrent: ServiceBlock[TorrentGroupOut]
    transmission: ServiceBlock[TorrentGroupOut]


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


class TorrentPriorityIn(BaseModel):
    ids: list[str]
    position: Literal["top", "bottom", "up", "down"]


class TorrentForceStartIn(BaseModel):
    ids: list[str]
    value: bool = True


class TorrentTagsIn(BaseModel):
    ids: list[str]
    tags: list[str]
    remove: bool = False


class SpeedLimitOut(BaseModel):
    qbittorrent: bool | None = None  # None = not configured / unreachable
    transmission: bool | None = None


class SpeedLimitIn(BaseModel):
    enabled: bool


class TorrentLimitsIn(BaseModel):
    dl_kib: int = 0
    ul_kib: int = 0


class TorrentCategoryIn(BaseModel):
    category: str


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


class ImportCandidateOut(BaseModel):
    path: str
    name: str = ""
    size: int = 0
    title: str = ""  # the movie/series the arr matched it to
    subtitle: str | None = None  # SxxEyy for episodes
    quality: str | None = None
    quality_id: int | None = None  # the arr's detection, as an /options id
    languages: list[str] = []
    language_ids: list[int] = []
    rejections: list[str] = []
    importable: bool = False  # has everything needed to be imported


class ImportChoiceOut(BaseModel):
    id: int
    name: str


class ImportOptionsOut(BaseModel):
    qualities: list[ImportChoiceOut] = []  # the arr's own order, worst to best
    languages: list[ImportChoiceOut] = []  # empty for Readarr, which has none per file


class ManualImportIn(BaseModel):
    item_id: int
    paths: list[str]
    mode: Literal["auto", "move", "copy"] = "auto"


class ManualImportFileIn(BaseModel):
    path: str
    # the target; all empty keeps the arr's own match
    movie_id: int | None = None
    series_id: int | None = None
    episode_ids: list[int] = []
    # overrides of the arr's detection, as ids from /manual-import/{app}/options;
    # None / empty keeps what the arr detected
    quality_id: int | None = None
    language_ids: list[int] | None = None


class ManualImportAssignIn(BaseModel):
    item_id: int
    files: list[ManualImportFileIn]
    mode: Literal["auto", "move", "copy"] = "auto"


class ImportCommandOut(BaseModel):
    """The arr's ManualImport command, as started or as it stands now."""

    app: Literal["radarr", "sonarr", "readarr"]
    id: int
    # the arr's own: queued | started | completed | failed | aborted | cancelled | orphaned
    status: str = "queued"
    result: str | None = None  # successful | unsuccessful | unknown
    message: str | None = None  # the arr's last progress line or its error
    done: bool = False  # no longer queued or running
    ok: bool | None = None  # None until done
    # files the arr reports handling, parsed from its message; it counts files
    # it then rejected too, so this is "processed", not a guarantee
    imported: int | None = None


class RenamePreviewOut(BaseModel):
    file_id: int
    existing_path: str = ""
    new_path: str = ""


class RenameIn(BaseModel):
    id: int
    file_ids: list[int]


class BlocklistItemOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    id: int
    title: str = ""  # the movie/series it belongs to
    source_title: str = ""  # the release that was blocked
    quality: str | None = None
    date: str | None = None
    indexer: str | None = None


class BlocklistPageOut(BaseModel):
    items: list[BlocklistItemOut] = []
    total: int = 0
