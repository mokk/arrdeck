"""The arrs' own schedulers: what ran, what's next, and what's late.

"Why hasn't anything been grabbed?" is usually answered by "RSS sync last ran
six hours ago", which needs the arr's System -> Tasks page. This surfaces the
same data, plus the arrs' own backups, which are separate from arrdeck's.
"""

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, Depends

from ...cache import cached, guarded
from ...clients.base import ArrClient
from ...clients.prowlarr import ProwlarrClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_prowlarr, get_radarr, get_sonarr
from ...schemas import ArrBackupOut, ScheduledTaskOut, ServiceBlock

router = APIRouter(tags=["system"])

# The tasks worth showing before the card is expanded. Everything else is
# bookkeeping the user never asks about (MessagingCleanup, CleanUpRecycleBin) or
# runs so often that its last-run time carries no information
# (RefreshMonitoredDownloads, every minute).
NOTABLE_TASKS = {
    "RssSync",
    "ImportListSync",
    "RefreshMovie",
    "RefreshSeries",
    "CheckHealth",
    "Backup",
    "ApplicationIndexerSync",
}

# Being a little late is normal — the arrs queue tasks behind each other. Grace
# scales with the interval so a 1-minute task isn't flagged for a 30s slip, and
# is capped so a weekly Backup isn't given three days of leeway.
MIN_GRACE_SECONDS = 120
MAX_GRACE_SECONDS = 1800


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    # The arrs are inconsistent about the offset; assume UTC when it's missing
    # rather than dropping the field.
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _parse_duration(value: str | None) -> float | None:
    """The arrs report durations as HH:MM:SS.fffffff."""
    if not value:
        return None
    try:
        hours, minutes, seconds = value.split(":")
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except ValueError:
        return None


def _grace(interval_minutes: int) -> float:
    half = interval_minutes * 60 / 2
    return min(max(half, MIN_GRACE_SECONDS), MAX_GRACE_SECONDS)


def _to_task(app: str, raw: dict, now: datetime) -> ScheduledTaskOut:
    task_name = raw.get("taskName") or raw.get("name") or ""
    interval = int(raw.get("interval") or 0)
    next_run = _parse_time(raw.get("nextExecution"))
    late = (now - next_run).total_seconds() if next_run else 0.0
    # interval 0 means "disabled", which is a choice rather than a failure.
    overdue = bool(interval and next_run and late > _grace(interval))
    return ScheduledTaskOut(
        app=app,
        name=task_name,
        label=raw.get("name") or task_name,
        interval_minutes=interval,
        last_execution=raw.get("lastExecution"),
        next_execution=raw.get("nextExecution"),
        last_duration_seconds=_parse_duration(raw.get("lastDuration")),
        overdue=overdue,
        overdue_by_seconds=round(late, 1) if overdue else None,
        notable=task_name in NOTABLE_TASKS,
    )


def _clients(
    radarr: RadarrClient, sonarr: SonarrClient, prowlarr: ProwlarrClient
) -> list[tuple[str, ArrClient]]:
    return [("radarr", radarr), ("sonarr", sonarr), ("prowlarr", prowlarr)]


@router.get("/tasks", response_model=ServiceBlock[list[ScheduledTaskOut]])
async def tasks(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
):
    """Scheduled tasks across the arrs, soonest-due first."""

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            pairs = _clients(radarr, sonarr, prowlarr)
            results = await asyncio.gather(
                *(client.tasks() for _, client in pairs), return_exceptions=True
            )
            now = datetime.now(UTC)
            out: list[ScheduledTaskOut] = []
            for (app, _), result in zip(pairs, results, strict=True):
                # One arr being down shouldn't blank the other two's tasks.
                if isinstance(result, BaseException) or not isinstance(result, list):
                    continue
                out.extend(_to_task(app, raw, now) for raw in result)
            # Overdue first, then soonest next run: the reason to open this card
            # is always something being late.
            out.sort(key=lambda t: (not t.overdue, t.next_execution or "9999"))
            return [t.model_dump() for t in out]

        return await cached("tasks", 60, call)

    return await guarded(fetch(), "tasks")


@router.get("/arr-backups", response_model=ServiceBlock[list[ArrBackupOut]])
async def arr_backups(
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    prowlarr: ProwlarrClient = Depends(get_prowlarr),
):
    """The arrs' own backups, newest first — arrdeck's live at /backup."""

    async def fetch() -> list[dict]:
        async def call() -> list[dict]:
            pairs = _clients(radarr, sonarr, prowlarr)
            results = await asyncio.gather(
                *(client.backups() for _, client in pairs), return_exceptions=True
            )
            out: list[ArrBackupOut] = []
            for (app, client), result in zip(pairs, results, strict=True):
                if isinstance(result, BaseException) or not isinstance(result, list):
                    continue
                for raw in result:
                    path = raw.get("path") or ""
                    out.append(
                        ArrBackupOut(
                            app=app,
                            name=raw.get("name") or "",
                            kind=raw.get("type") or "",
                            size_bytes=int(raw.get("size") or 0),
                            time=raw.get("time"),
                            # Served unauthenticated off the arr's root, so this
                            # is a link the browser can follow directly.
                            url=f"{client.base_url}{path}" if path else None,
                        )
                    )
            out.sort(key=lambda b: b.time or "", reverse=True)
            return [b.model_dump() for b in out]

        return await cached("arr:backups", 300, call)

    return await guarded(fetch(), "arr-backups")
