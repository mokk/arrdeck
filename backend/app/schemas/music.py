"""Lidarr's library: artists, their albums, an album's tracks, and the
payloads for editing and adding them.

Every route that answers with these is new with Lidarr, so nothing here can
change what an existing client sees.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .library import HistoryEventOut
from .media import RatingOut


class LibraryArtistOut(BaseModel):
    """A Lidarr artist: a card in the Music tab, or a choice in the import
    sheet's picker."""

    id: int
    name: str = ""
    sort_name: str | None = None
    monitored: bool = False
    album_count: int = 0
    track_file_count: int = 0
    poster: str | None = None
    # tracks Lidarr expects across the monitored releases; track_file_count of
    # them are on disk
    track_count: int = 0
    size_on_disk: int = 0
    # when Lidarr started tracking them; the library sorts on this by default
    added: datetime | None = None
    quality_profile_id: int | None = None
    metadata_profile_id: int | None = None
    # all | none | new: what happens to albums Lidarr learns of later
    monitor_new_items: str | None = None
    tags: list[int] = []
    genres: list[str] = []
    rating: float | None = None  # out of 10, from Lidarr's metadata (MusicBrainz)
    status: str | None = None  # continuing | ended
    disambiguation: str | None = None
    # the MusicBrainz id, which is Lidarr's own URL segment: /artist/<id>
    slug: str | None = None


class LibraryAlbumOut(BaseModel):
    """One of a Lidarr artist's albums (EPs and singles too)."""

    id: int
    title: str = ""
    artist_id: int | None = None
    artist: str | None = None
    year: int | None = None
    release_date: str | None = None
    album_type: str | None = None  # Lidarr's: Album, EP, Single, Broadcast, Other
    monitored: bool = False
    track_count: int = 0
    track_file_count: int = 0
    poster: str | None = None
    size_on_disk: int = 0
    # Compilation, Live, Remix, Soundtrack…: Lidarr's secondary types
    secondary_types: list[str] = []
    rating: float | None = None


class MusicLinkOut(BaseModel):
    name: str
    url: str


class ArtistDetailOut(LibraryArtistOut):
    overview: str | None = None
    artist_type: str | None = None  # Person | Group | Orchestra…
    path: str | None = None
    root_folder_path: str | None = None
    fanart: str | None = None  # the wide backdrop behind the header
    links: list[MusicLinkOut] = []
    ratings: list[RatingOut] = []
    # every album Lidarr knows for them under the metadata profile, unmonitored
    # ones included, newest first; the page groups them by album_type
    albums: list[LibraryAlbumOut] = []


class ArtistUpdateIn(BaseModel):
    monitored: bool | None = None
    monitor_new_items: Literal["all", "none", "new"] | None = None
    quality_profile_id: int | None = None
    metadata_profile_id: int | None = None
    path: str | None = None
    # with a new path: move the files there too, rather than only pointing at it
    move_files: bool = False
    tags: list[int] | None = None


class AlbumTrackOut(BaseModel):
    id: int
    medium: int = 1  # disc or side number
    # as printed: "3", or "A1" on vinyl
    number: str | None = None
    absolute: int = 0  # position across the whole release
    title: str | None = None
    duration: int | None = None  # seconds
    has_file: bool = False
    # the file on disk, when there is one: what to show, and what to delete
    file_id: int | None = None
    quality: str | None = None
    size: int | None = None


class AlbumMediumOut(BaseModel):
    number: int
    name: str | None = None
    format: str | None = None  # CD, 12" Vinyl, Digital Media…


class AlbumDetailOut(BaseModel):
    id: int
    title: str = ""
    disambiguation: str | None = None
    artist: str | None = None
    artist_id: int | None = None
    overview: str | None = None
    poster: str | None = None
    release_date: str | None = None
    year: int | None = None
    album_type: str | None = None
    secondary_types: list[str] = []
    genres: list[str] = []
    monitored: bool = False
    # of the release Lidarr picked (the pressing it matches files against)
    track_count: int = 0
    track_file_count: int = 0
    size_on_disk: int = 0
    duration: int | None = None  # seconds
    # the artist's: Lidarr keeps quality on the artist, not the album
    quality_profile_id: int | None = None
    ratings: list[RatingOut] = []
    links: list[MusicLinkOut] = []
    slug: str | None = None  # the album's MusicBrainz id
    artist_slug: str | None = None
    # the release Lidarr matches files against: its format and label
    release: str | None = None
    media: list[AlbumMediumOut] = []
    tracks: list[AlbumTrackOut] = []
    history: list[HistoryEventOut] = []


class AddArtistIn(BaseModel):
    foreign_artist_id: str
    title: str
    quality_profile_id: int
    metadata_profile_id: int | None = None  # the first of Lidarr's when left out
    root_folder_path: str
    monitored: bool = True
    # which of their existing albums to monitor: Lidarr's own choices
    monitor: Literal["all", "future", "missing", "existing", "latest", "first", "none"] = "all"
    monitor_new_items: Literal["all", "none", "new"] = "all"
    search_now: bool = True


class AddAlbumIn(BaseModel):
    foreign_album_id: str
    title: str
    # for the artist, when Lidarr does not have them yet: they are added with
    # these and only this album monitored. An artist Lidarr has keeps theirs.
    quality_profile_id: int
    metadata_profile_id: int | None = None
    root_folder_path: str
    monitored: bool = True
    search_now: bool = True
