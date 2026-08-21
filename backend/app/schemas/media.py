"""The library proper: movies, series, seasons, episodes, credits and the
payloads for editing them.

Split out of library.py, which had grown to 44 classes across every domain in the
app. Depends on library.py one-way — HistoryEventOut lives there — so nothing
imports back.
"""

from typing import Literal

from pydantic import BaseModel

from .library import HistoryEventOut


class LibraryUpdateIn(BaseModel):
    monitored: bool | None = None
    quality_profile_id: int | None = None


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


class CreditPersonOut(BaseModel):
    name: str
    # A character for cast, a job for crew — one field because the UI renders
    # them the same way, under the name.
    role: str | None = None
    image: str | None = None
    tmdb_id: int | None = None


class CreditsOut(BaseModel):
    cast: list[CreditPersonOut] = []
    crew: list[CreditPersonOut] = []
