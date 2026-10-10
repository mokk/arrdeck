"""The library proper: movies, series, seasons, episodes, credits and the
payloads for editing them.

Split out of library.py, which had grown to 44 classes across every domain in the
app. Depends on library.py one-way — HistoryEventOut lives there — so nothing
imports back.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .library import HistoryEventOut, SearchResultOut


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
    # when the arr started monitoring it; the libraries sort on this by default
    added: datetime | None = None
    # The file's quality (WEBDL-2160p…), for the details layout and filters.
    quality: str | None = None
    genres: list[str] = []
    rating: float | None = None  # IMDb, else TMDB, out of 10
    runtime: int | None = None  # minutes
    slug: str | None = None  # the arr's own URL segment, for "Open in Radarr"


class NextEpisodeOut(BaseModel):
    season: int
    episode: int
    title: str | None = None
    air_date: datetime | None = None
    finale_type: str | None = None  # season | series | midseason


class SeasonProgressOut(BaseModel):
    number: int
    have: int = 0  # episodes on disk
    total: int = 0  # episodes in the season, aired or not


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
    # when the arr started monitoring it; the libraries sort on this by default
    added: datetime | None = None
    tmdb_id: int | None = None
    network: str | None = None
    genres: list[str] = []
    rating: float | None = None
    next_airing: datetime | None = None
    slug: str | None = None
    previous_airing: datetime | None = None
    # The next episode on the calendar, for the "Up next" view.
    next_episode: NextEpisodeOut | None = None
    # The season "Up next" tracks: the next episode's, else the latest.
    current_season: SeasonProgressOut | None = None


class SeasonOut(BaseModel):
    number: int
    monitored: bool
    episode_count: int = 0
    episode_file_count: int = 0
    size_on_disk: int = 0


class RatingOut(BaseModel):
    source: str  # imdb | tmdb | rottenTomatoes | metacritic | trakt
    # 0-10 for imdb/tmdb/trakt, a 0-100 score for rottenTomatoes/metacritic;
    # the client formats it
    value: float
    votes: int | None = None


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
    fanart: str | None = None  # the wide backdrop behind the header
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
    ratings: list[RatingOut] = []
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
    # what happens in it: behind spoiler protection when unwatched
    overview: str | None = None
    finale_type: str | None = None  # season | series | midseason
    air_date: str | None = None
    has_file: bool = False
    monitored: bool = False
    # the file on disk, when there is one: what to show, and what to delete
    file_id: int | None = None
    quality: str | None = None
    size: int | None = None


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
    # keep the arr's import lists from adding them straight back
    exclude: bool = False


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
    fanart: str | None = None  # the wide backdrop behind the header
    status: str | None = None
    runtime: int | None = None
    path: str | None = None
    monitored: bool = False
    has_file: bool = False
    size_on_disk: int = 0
    quality_profile_id: int | None = None
    imdb_id: str | None = None
    tmdb_id: int | None = None
    ratings: list[RatingOut] = []
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


class PersonMovieOut(BaseModel):
    movie_id: int
    title: str | None = None
    year: int | None = None
    poster: str | None = None
    role: str | None = None  # the character, or the job
    has_file: bool = False
    monitored: bool = False


class PersonOut(BaseModel):
    """Someone from a film's credits: what of theirs is in the library, and —
    when Overseerr is there to ask — the films of theirs that are not."""

    tmdb_id: int
    name: str | None = None
    image: str | None = None
    known_for: str | None = None
    owned: list[PersonMovieOut] = []
    elsewhere: list[SearchResultOut] = []


class CleanupSeasonOut(BaseModel):
    number: int
    size: int = 0
    files: int = 0
    monitored: bool = False


class CleanupItemOut(BaseModel):
    kind: Literal["movie", "series"]
    id: int
    title: str | None = None
    year: int | None = None
    poster: str | None = None
    size: int = 0
    added: datetime | None = None
    last_viewed_at: int | None = None  # unix seconds, from Plex
    monitored: bool = False
    # shows: the seasons with files, so some can go instead of the whole show
    seasons: list[CleanupSeasonOut] = []


class SeasonRemoveIn(BaseModel):
    seasons: list[int] = Field(min_length=1)


class SeasonRemoveOut(BaseModel):
    deleted_files: int = 0


class CleanupOut(BaseModel):
    """What could go to free space, in four lists. Nothing here deletes: the
    client sends the chosen ids to the libraries' bulk delete."""

    plex: bool = False  # without Plex the two watch-based lists stay empty
    watched: list[CleanupItemOut] = []  # fully watched, last seen long ago
    never_watched: list[CleanupItemOut] = []  # in Plex, never played, added long ago
    largest: list[CleanupItemOut] = []
    unmonitored: list[CleanupItemOut] = []  # nobody wants it, still on disk


# --- cleanup rules ("Leaving soon") ---


class CleanupConditions(BaseModel):
    """ANDed. Unset (null, false, empty) is no condition; a rule with none at
    all matches nothing."""

    # watched to the end, last played more than this many days ago
    watched_days: int | None = Field(None, ge=1, le=3650)
    # never played (Plex has it, nothing seen), added more than this many days ago
    unwatched_days: int | None = Field(None, ge=1, le=3650)
    min_size_gb: float | None = Field(None, gt=0, le=100_000)  # GiB, as the app shows sizes
    unmonitored: bool = False
    rating_below: float | None = Field(None, gt=0, le=10)  # the arr's IMDb/TMDB rating
    without_tags: list[int] = Field([], max_length=50)  # none of these arr tags
    with_tags: list[int] = Field([], max_length=50)  # at least one of these


class CleanupRuleIn(BaseModel):
    id: str = Field("", max_length=40)  # empty for a new rule: the server assigns one
    name: str = Field("", max_length=80)
    kind: Literal["movie", "series"]
    enabled: bool = False
    grace_days: int = Field(14, ge=3, le=365)
    conditions: CleanupConditions = CleanupConditions()


class CleanupRuleOut(BaseModel):
    id: str
    name: str
    kind: Literal["movie", "series"]
    enabled: bool
    grace_days: int
    conditions: CleanupConditions


class CleanupRulesSettings(BaseModel):
    # the master switch: off, nothing is marked or deleted, whatever the rules say
    enabled: bool = False
    max_deletions: int = Field(10, ge=1, le=100)  # per run; the rest wait for the next


class CleanupRulesIn(BaseModel):
    settings: CleanupRulesSettings
    rules: list[CleanupRuleIn] = Field([], max_length=30)


class CleanupRulesOut(BaseModel):
    settings: CleanupRulesSettings
    rules: list[CleanupRuleOut]


class CleanupReasonOut(BaseModel):
    # watched | unwatched (value: days) · size (bytes) · rating · unmonitored ·
    # without_tags · with_tags
    code: str
    value: float | None = None


class CleanupMatchOut(BaseModel):
    kind: Literal["movie", "series"]
    id: int
    title: str = ""
    year: int | None = None
    poster: str | None = None
    size: int = 0
    reasons: list[CleanupReasonOut] = []
    leave_at: int | None = None  # unix seconds, when it is already leaving


class CleanupPreviewOut(BaseModel):
    """What the rule would take now. Nothing is changed by asking."""

    matches: list[CleanupMatchOut] = []
    total_size: int = 0
    # matched, but held back by a brake: kept | requested | recent
    held: dict[str, int] = {}


class CleanupLeavingOut(BaseModel):
    kind: Literal["movie", "series"]
    id: int
    title: str = ""
    year: int | None = None
    poster: str | None = None
    size: int = 0
    rule_id: str = ""
    rule_name: str = ""
    reasons: list[CleanupReasonOut] = []
    marked_at: int  # unix seconds
    leave_at: int  # unix seconds; deleted at the first run after this, if it still matches


class CleanupKeepIn(BaseModel):
    # what to call it in the keep list when it is not leaving (kept from a preview)
    title: str = Field("", max_length=300)
    year: int | None = None


class CleanupKeptOut(BaseModel):
    kind: Literal["movie", "series"]
    id: int
    title: str = ""
    year: int | None = None
    kept_at: int = 0


class CleanupLogTitleOut(BaseModel):
    kind: Literal["movie", "series"]
    id: int
    title: str = ""
    year: int | None = None
    size: int = 0
    # released: kept | rule_off | gone | no_match | requested | recent | switched_off
    reason: str | None = None
    leave_at: int | None = None


class CleanupRunOut(BaseModel):
    ts: int
    trigger: str  # schedule | manual | switch
    dry_run: bool = False
    # disabled (the switch is off) | unreachable (see errors); nothing was done
    skipped: str | None = None
    marked: list[CleanupLogTitleOut] = []
    released: list[CleanupLogTitleOut] = []
    kept: list[CleanupLogTitleOut] = []  # matched, but on the keep list
    deleted: list[CleanupLogTitleOut] = []
    deferred: int = 0  # due, but over the per-run limit
    errors: list[str] = []
