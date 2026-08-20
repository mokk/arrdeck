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


class QueueItemOut(BaseModel):
    app: Literal["radarr", "sonarr"]
    id: int
    title: str
    status: str
    tracked_state: str | None = None
    tracked_status: str | None = None  # ok | warning | error
    size: float
    size_left: float
    time_left: str | None = None
    errors: list[str] = []
    # enables blocklist-&-retry from the UI
    movie_id: int | None = None
    series_id: int | None = None
    episode_id: int | None = None


class TorrentActionIn(BaseModel):
    ids: list[str]


class TorrentDeleteIn(BaseModel):
    ids: list[str]
    delete_data: bool = False


class QueueResponse(BaseModel):
    radarr: ServiceBlock[list[QueueItemOut]]
    sonarr: ServiceBlock[list[QueueItemOut]]


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
    languages: list[str] = []
    rejections: list[str] = []
    importable: bool = False  # has everything needed to be imported


class ManualImportIn(BaseModel):
    item_id: int
    paths: list[str]
    mode: Literal["auto", "move", "copy"] = "auto"


class ManualImportFileIn(BaseModel):
    path: str
    movie_id: int | None = None
    series_id: int | None = None
    episode_ids: list[int] = []


class ManualImportAssignIn(BaseModel):
    item_id: int
    files: list[ManualImportFileIn]
    mode: Literal["auto", "move", "copy"] = "auto"


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
