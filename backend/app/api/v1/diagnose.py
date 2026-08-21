"""Why hasn't this arrived yet?

Every input here already existed and was already cached — the queue, the
blocklist, the scheduled tasks, indexer health, delay profiles and the item's own
availability. What was missing was somewhere that reads them in one go, in the
order a person actually asks the questions.

Findings are returned as codes, not sentences: the app ships English and Danish,
so the wording lives in the locale files.
"""

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cached
from ...clients.base import ArrClient
from ...clients.prowlarr import ProwlarrClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_prowlarr, get_radarr, get_sonarr
from ...schemas import DiagnosisFindingOut, DiagnosisOut
from .dashboard import build_indexer_stats

router = APIRouter(tags=["library"])

# Ordered worst-first so the UI can lead with whatever actually blocks the grab.
LEVELS = ("blocked", "warning", "info", "ok")

# Beyond this a task is late enough to be worth mentioning. The scheduler
# tolerates a lot of slack normally, so a smaller window would cry wolf.
RSS_OVERDUE_SECONDS = 3600

# Prowlarr reports these as warnings, but they say nothing about whether an
# indexer can be searched.
HEALTH_NOTICES = {"UpdateCheck", "ApplicationLongTermStatusCheck"}


def _finding(code: str, level: str, **params) -> DiagnosisFindingOut:
    return DiagnosisFindingOut(code=code, level=level, params=params)


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _queue_findings(items: list[dict], item_id: int, app: str) -> list[DiagnosisFindingOut]:
    """The first question: is it already on its way?"""
    id_field = "movie_id" if app == "radarr" else "series_id"
    mine = [q for q in items if q.get(id_field) == item_id]
    if not mine:
        return []
    out = []
    for entry in mine:
        errors = entry.get("errors") or []
        state = (entry.get("tracked_state") or entry.get("status") or "").lower()
        if errors:
            # An import that failed keeps a "downloading" status in the arr, so
            # the errors are the only honest signal here.
            out.append(_finding("queue_failed", "blocked", reason=errors[0]))
        elif state in ("stalled", "warning"):
            out.append(_finding("queue_stalled", "warning", state=state))
        elif (entry.get("size_left") or 0) <= 0:
            out.append(_finding("queue_importing", "info"))
        else:
            out.append(_finding("queue_downloading", "ok", state=state or "downloading"))
    return out


def _availability_findings(movie: dict) -> list[DiagnosisFindingOut]:
    """The commonest real answer for a film, and the least obvious.

    Radarr will not search at all until a movie reaches its minimum availability,
    so a monitored, unreleased film looks identical to a broken indexer.
    """
    out = []
    if not movie.get("monitored", True):
        out.append(_finding("not_monitored", "blocked"))
    if movie.get("isAvailable") is False:
        target = movie.get("minimumAvailability") or "released"
        dates = {
            "announced": movie.get("inCinemas"),
            "inCinemas": movie.get("inCinemas"),
            "released": movie.get("physicalRelease") or movie.get("digitalRelease"),
        }
        when = _parse(dates.get(target))
        out.append(
            _finding(
                "not_yet_available",
                "blocked",
                availability=target,
                date=when.date().isoformat() if when else None,
            )
        )
    return out


def _blocklist_findings(
    entries: list[dict], item_id: int, app: str
) -> list[DiagnosisFindingOut]:
    """A release that was grabbed and rejected will not be tried again.

    The arr's raw blocklist record carries movieId / seriesId, so this is an exact
    join — an earlier version matched on title, which missed every entry because
    the record names the *release*, not the film.
    """
    id_field = "movieId" if app == "radarr" else "seriesId"
    hits = [e for e in entries if e.get(id_field) == item_id]
    if not hits:
        return []
    return [
        _finding(
            "blocklisted",
            "warning",
            count=len(hits),
            indexer=hits[0].get("indexer"),
            release=hits[0].get("sourceTitle"),
            reason=hits[0].get("message"),
        )
    ]


def _rss_findings(tasks: list[dict], app: str) -> list[DiagnosisFindingOut]:
    """Nothing gets picked up between RSS syncs, so a wedged scheduler explains
    an item that should have been found hours ago."""
    rss = next(
        (t for t in tasks if t.get("app") == app and t.get("name") == "RssSync"),
        None,
    )
    if not rss:
        return []
    if rss.get("overdue"):
        return [
            _finding(
                "rss_overdue",
                "warning",
                minutes=round((rss.get("overdue_by_seconds") or 0) / 60),
            )
        ]
    last = _parse(rss.get("last_execution"))
    if last:
        age = (datetime.now(UTC) - last).total_seconds()
        if age > RSS_OVERDUE_SECONDS:
            return [_finding("rss_stale", "info", minutes=round(age / 60))]
    return []


def _delay_findings(profiles: list[dict]) -> list[DiagnosisFindingOut]:
    """A delay profile holds a grab on purpose. Without this the wait looks
    identical to nothing being found."""
    out = []
    for profile in profiles:
        usenet = profile.get("usenetDelay") or 0
        torrent = profile.get("torrentDelay") or 0
        if usenet or torrent:
            out.append(
                _finding(
                    "delay_profile",
                    "info",
                    usenet=usenet,
                    torrent=torrent,
                    bypass=bool(profile.get("bypassIfHighestQuality")),
                )
            )
    return out


def _indexer_findings(stats: dict) -> list[DiagnosisFindingOut]:
    enabled = stats.get("enabled")
    total = stats.get("total")
    if enabled == 0:
        return [_finding("no_indexers", "blocked", total=total or 0)]
    # Prowlarr's health feed describes the whole instance, not individual
    # indexers, and it mixes faults with notices — "New update is available" is a
    # warning there. Reporting that as an indexer failure is exactly the kind of
    # false alarm this endpoint exists to prevent.
    warnings = [
        h
        for h in (stats.get("health") or [])
        if h.get("type") in ("error", "warning") and h.get("source") not in HEALTH_NOTICES
    ]
    if warnings:
        return [
            _finding(
                "indexers_failing",
                "warning",
                count=len(warnings),
                total=enabled or total or 0,
                message=warnings[0].get("message"),
            )
        ]
    return []


@router.get("/diagnose/{app}/{item_id}", response_model=DiagnosisOut)
async def diagnose(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
) -> DiagnosisOut:
    """Answer in the order a person asks: is it coming, is it blocked, is anyone
    looking, and is there anywhere to look."""
    client: ArrClient
    if app == "radarr":
        client = radarr
    elif app == "sonarr":
        client = sonarr
    else:
        raise HTTPException(404, f"unknown app {app!r}")

    item, queue, blocklist, tasks, delays, indexers = await asyncio.gather(
        radarr.get_movie(item_id) if app == "radarr" else sonarr.get_series(item_id),
        client.queue(),
        client.blocklist(page_size=200),
        # Cached separately from the tasks card, which has its own TTL; a
        # diagnosis is rare enough that a fresh-ish read is fine.
        cached(f"diagnose:tasks:{app}", 120, client.tasks),
        cached(f"diagnose:delays:{app}", 300, client.delay_profiles),
        build_indexer_stats(prowlarr),
        return_exceptions=True,
    )

    def rows(value, key: str = "records") -> list[dict]:
        if isinstance(value, BaseException):
            return []
        if isinstance(value, dict):
            return value.get(key) or value.get("items") or []
        return value if isinstance(value, list) else []

    if isinstance(item, BaseException):
        raise HTTPException(404, f"{app} does not have item {item_id}")

    title = item.get("title")
    findings: list[DiagnosisFindingOut] = []
    findings += _queue_findings(rows(queue), item_id, app)
    if app == "radarr":
        findings += _availability_findings(item)
    elif not item.get("monitored", True):
        findings += [_finding("not_monitored", "blocked")]
    findings += _blocklist_findings(rows(blocklist), item_id, app)
    findings += _rss_findings(rows(tasks), app)
    findings += _delay_findings(rows(delays))
    findings += _indexer_findings({} if isinstance(indexers, BaseException) else indexers)

    if not findings:
        # Everything checked out, which is itself the answer: the indexers simply
        # have not offered a matching release yet.
        findings.append(_finding("nothing_found", "info"))

    findings.sort(key=lambda f: LEVELS.index(f.level) if f.level in LEVELS else len(LEVELS))
    return DiagnosisOut(app=app, id=item_id, title=title, findings=findings)
