"""Cleanup rules, evaluated: which titles a rule matches, and why.

Everything here is pure — titles in, matches out — so the part that decides
what may be deleted can be tested without a server in sight. Fetching, marking
and deleting live in job.py.

A rule is {id, name, kind, enabled, grace_days, conditions}; its conditions are
ANDed, and a rule with none matches nothing. The brakes apply to every rule and
cannot be switched off: a kept title, an open request, or a title added in the
last RECENT_DAYS (or with no added date at all) is never matched.
"""

from dataclasses import dataclass, field
from datetime import datetime

from ..api.v1.cleanup import watched_entry
from ..api.v1.discover import _poster, _rating

DAY = 86_400
GIB = 1024**3  # the PWA shows sizes in 1024s, so a "50 GB" threshold agrees with it
RECENT_DAYS = 30
MIN_GRACE_DAYS = 3
DEFAULT_GRACE_DAYS = 14

CONDITION_KEYS = (
    "watched_days",
    "unwatched_days",
    "min_size_gb",
    "unmonitored",
    "rating_below",
    "without_tags",
    "with_tags",
)


@dataclass(frozen=True)
class Candidate:
    """One title on disk, with what Plex and Overseerr know about it."""

    kind: str  # "movie" | "series"
    id: int
    title: str
    year: int | None
    poster: str | None
    size: int
    added: float | None  # unix seconds
    monitored: bool
    tags: tuple[int, ...]
    rating: float | None
    # watched, progress, last_viewed_at, key, section, section_type; None when
    # Plex does not have the title, which is never read as "unwatched"
    plex: dict | None
    requested: bool

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.id}"


@dataclass
class Match:
    candidate: Candidate
    reasons: list[dict]  # {"code": ..., "value": ...}, worded by the client


@dataclass
class Evaluation:
    matches: list[Match] = field(default_factory=list)
    # titles the rule matched but a brake held back: (candidate, brake)
    held: list[tuple[Candidate, str]] = field(default_factory=list)


def _ts(value) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def arr_request_keys(kind: str, item: dict) -> list[str]:
    """The keys requests.request_keys files an Overseerr request under."""
    if kind == "movie":
        return [f"movie:tmdb:{item['tmdbId']}"] if item.get("tmdbId") else []
    keys = []
    if item.get("tvdbId"):
        keys.append(f"tv:tvdb:{item['tvdbId']}")
    if item.get("tmdbId"):
        keys.append(f"tv:tmdb:{item['tmdbId']}")
    return keys


def candidate(kind: str, item: dict, plex_items: dict, requests: dict) -> Candidate:
    """`plex_items` is the guid-keyed map for this kind's Plex sections only: a
    film and a show can share a TMDB number, and the wrong one's watch state
    must not decide anything."""
    size = (
        item.get("sizeOnDisk", 0)
        if kind == "movie"
        else (item.get("statistics") or {}).get("sizeOnDisk", 0)
    )
    return Candidate(
        kind=kind,
        id=item["id"],
        title=item.get("title") or "",
        year=item.get("year"),
        poster=_poster(item.get("images")),
        size=size or 0,
        added=_ts(item.get("added")),
        monitored=bool(item.get("monitored", False)),
        tags=tuple(t for t in item.get("tags") or [] if isinstance(t, int)),
        rating=_rating(item.get("ratings")),
        plex=watched_entry(kind, item, plex_items),
        requested=any(k in requests for k in arr_request_keys(kind, item)),
    )


def has_conditions(conditions: dict) -> bool:
    return any(
        conditions.get(k) not in (None, False, []) for k in CONDITION_KEYS if k in conditions
    )


def check(c: Candidate, conditions: dict, now: float) -> list[dict] | None:
    """The reasons every condition holds, or None when one does not."""
    reasons: list[dict] = []
    plex = c.plex
    days = conditions.get("watched_days")
    if days is not None:
        last = (plex or {}).get("last_viewed_at")
        if not (plex and plex.get("watched") and last and now - last > days * DAY):
            return None
        reasons.append({"code": "watched", "value": int((now - last) // DAY)})
    days = conditions.get("unwatched_days")
    if days is not None:
        # partly watched is not "never watched", and Plex not knowing it is not either
        if not (plex and not plex.get("progress") and c.added and now - c.added > days * DAY):
            return None
        reasons.append({"code": "unwatched", "value": int((now - c.added) // DAY)})
    gb = conditions.get("min_size_gb")
    if gb is not None:
        if not c.size > gb * GIB:
            return None
        reasons.append({"code": "size", "value": c.size})
    if conditions.get("unmonitored"):
        if c.monitored:
            return None
        reasons.append({"code": "unmonitored", "value": None})
    below = conditions.get("rating_below")
    if below is not None:
        # no rating is not a low rating
        if c.rating is None or c.rating >= below:
            return None
        reasons.append({"code": "rating", "value": c.rating})
    without = set(conditions.get("without_tags") or [])
    if without:
        if without & set(c.tags):
            return None
        reasons.append({"code": "without_tags", "value": None})
    only = set(conditions.get("with_tags") or [])
    if only:
        if not only & set(c.tags):
            return None
        reasons.append({"code": "with_tags", "value": None})
    return reasons


def brake(c: Candidate, now: float, kept: set[str] | dict) -> str | None:
    """Why a title must be left alone whatever the rule says, or None."""
    if c.key in kept:
        return "kept"
    if c.requested:
        return "requested"
    if c.added is None or now - c.added < RECENT_DAYS * DAY:
        return "recent"
    return None


def matches(c: Candidate, rule: dict, now: float, kept: set[str] | dict) -> list[dict] | None:
    """The reasons `rule` takes this title now, or None. The recheck before a
    deletion is this same call on fresh data."""
    conditions = rule.get("conditions") or {}
    if c.kind != rule.get("kind") or c.size <= 0 or not has_conditions(conditions):
        return None
    if brake(c, now, kept):
        return None
    return check(c, conditions, now)


def evaluate(
    candidates: list[Candidate], rule: dict, now: float, kept: set[str] | dict
) -> Evaluation:
    """Every title `rule` matches now, largest first, and the ones a brake held."""
    out = Evaluation()
    conditions = rule.get("conditions") or {}
    if not has_conditions(conditions):
        return out
    for c in candidates:
        if c.kind != rule.get("kind") or c.size <= 0:
            continue
        reasons = check(c, conditions, now)
        if reasons is None:
            continue
        held = brake(c, now, kept)
        if held:
            out.held.append((c, held))
        else:
            out.matches.append(Match(c, reasons))
    out.matches.sort(key=lambda m: -m.candidate.size)
    return out
