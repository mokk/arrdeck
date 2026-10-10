"""Service down/up alerts: every configured service is probed once a minute,
and one that stays unreachable for the threshold in the push rules gets ONE
"down" notification, then ONE "back up" when it answers again.

Quiet hours apply, by deferring rather than dropping: a service that goes
down at 03:00 is announced when the quiet window ends if it is still down,
and one that recovers before then is never announced at all — nobody wants
to wake up to "Radarr is down" followed by "Radarr is back up". A recovery
during quiet hours after a "down" that did go out is likewise held back and
sent when the window ends, so a "down" is always followed by its "back up".

Like the digest these are sent directly rather than through the coalescer,
which would merge two outages into "Service down · 2 items" and lose the names.
"""

import asyncio
import json
import time
from dataclasses import asdict, dataclass

from ..db import SettingsDB
from ..registry import Registry, probe_version
from .delivery import _send_all
from .events import get_rules, in_quiet_hours, logger
from .pipeline import Notification

PROBE_INTERVAL = 60
# shorter than a poll so one hung service cannot stretch a tick past the next
PROBE_TIMEOUT = 10
PROBE_CONCURRENCY = 3
STATE_KEY = "service_watch"
URL = "/settings/system"

LABELS = {
    "radarr": "Radarr",
    "sonarr": "Sonarr",
    "readarr": "Readarr",
    "prowlarr": "Prowlarr",
    "qbittorrent": "qBittorrent",
    "transmission": "Transmission",
    "overseerr": "Overseerr",
    "gluetun": "gluetun",
    "bazarr": "Bazarr",
    "plex": "Plex",
    "prometheus": "Prometheus",
    "trakt": "Trakt",
}


@dataclass(frozen=True)
class Outage:
    """One service's place in the down/up cycle. The default is "answering"."""

    since: float | None = None  # first failed probe of the current outage
    alerted: bool = False  # the "down" for this outage went out
    # set when it answered again but the "back up" is waiting out quiet hours
    lasted: float | None = None

    @property
    def down_since(self) -> float | None:
        return self.since if self.lasted is None else None


def step(
    prev: Outage, ok: bool, now: float, threshold: float, quiet: bool = False
) -> tuple[Outage, tuple[str, float] | None]:
    """The next state, and ("down" | "up", seconds it has been down) when a
    notification is due. Pure, so the whole cycle is testable without a clock."""
    if not ok:
        since = prev.since if prev.since is not None else now
        if not prev.alerted and not quiet and now - since >= threshold:
            return Outage(since, alerted=True), ("down", now - since)
        # down again while a "back up" was held back: still the same outage
        return Outage(since, alerted=prev.alerted), None
    if prev.since is None or not prev.alerted:
        # answered before anyone was told, which is how flapping stays silent
        return Outage(), None
    lasted = prev.lasted if prev.lasted is not None else now - prev.since
    if quiet:
        return Outage(prev.since, alerted=True, lasted=lasted), None
    return Outage(), ("up", lasted)


class ServiceWatch:
    """Every service's Outage, plus the persistence that stops an arrdeck
    restart from announcing an outage it already announced."""

    def __init__(self, states: dict[str, Outage] | None = None) -> None:
        self.states: dict[str, Outage] = states or {}

    @classmethod
    def load(cls, db: SettingsDB) -> "ServiceWatch":
        try:
            raw = json.loads(db.kv_get(STATE_KEY) or "{}")
            states = {name: Outage(**value) for name, value in raw.items()}
        except (ValueError, TypeError, AttributeError):
            return cls()
        # Only announced outages are kept: the timing of an unannounced one is
        # unknown after a gap, and restarting its clock costs nothing.
        return cls({name: s for name, s in states.items() if s.alerted})

    def save(self, db: SettingsDB) -> None:
        db.kv_set(STATE_KEY, json.dumps({n: asdict(s) for n, s in self.states.items()}))

    def down_since(self, name: str) -> float | None:
        state = self.states.get(name)
        return state.down_since if state else None

    def advance(
        self, results: dict[str, bool], now: float, threshold: float, quiet: bool
    ) -> list[tuple[str, str, float]]:
        """Apply one round of probes; returns (service, "down" | "up", seconds).
        A service missing from `results` is no longer configured and is forgotten."""
        states: dict[str, Outage] = {}
        alerts: list[tuple[str, str, float]] = []
        for name, ok in results.items():
            state, alert = step(self.states.get(name, Outage()), ok, now, threshold, quiet)
            if state != Outage():
                states[name] = state
            if alert:
                alerts.append((name, *alert))
        self.states = states
        return alerts


def outage_note(name: str, kind: str, seconds: float) -> Notification:
    label = LABELS.get(name, name)
    minutes = max(1, round(seconds / 60))
    if kind == "down":
        title, body = f"{label} is down", f"No answer for {minutes} min"
    else:
        title, body = f"{label} is back up", f"Was down for {minutes} min"
    return Notification(
        code=f"service_{kind}",
        count=1,
        app=name,
        heading=label,
        title=title,
        body=body,
        params={"minutes": minutes},
    )


async def probe_all(registry: Registry) -> dict[str, bool]:
    gate = asyncio.Semaphore(PROBE_CONCURRENCY)

    async def one(name: str) -> bool:
        async with gate:
            try:
                await asyncio.wait_for(probe_version(name, registry.get(name)), PROBE_TIMEOUT)
            except Exception:  # noqa: BLE001 — any failure means "not answering"
                return False
            return True

    names = registry.configured()
    return dict(zip(names, await asyncio.gather(*(one(n) for n in names)), strict=True))


async def watch_once(db: SettingsDB, registry: Registry, watch: ServiceWatch) -> int:
    results = await probe_all(registry)
    rules = get_rules(db)
    before = watch.states
    alerts = watch.advance(
        results, time.time(), rules["service_down_minutes"] * 60, in_quiet_hours(rules)
    )
    if watch.states != before:
        # saved before sending: a failing push must not make it announce twice
        watch.save(db)
    sent = 0
    for name, kind, seconds in alerts:
        note = outage_note(name, kind, seconds)
        # one tag for both, so "back up" replaces the "down" banner
        sent += await asyncio.to_thread(
            _send_all, db, note, URL, f"arrdeck:service:{name}", note.code
        )
    return sent


async def watch_loop(db: SettingsDB, registry: Registry, watch: ServiceWatch) -> None:
    while True:
        try:
            await watch_once(db, registry, watch)
        except Exception:  # noqa: BLE001 — the watcher must never die
            logger.exception("service watch failed")
        await asyncio.sleep(PROBE_INTERVAL)


__all__ = ["Outage", "ServiceWatch", "outage_note", "step", "watch_loop", "watch_once"]
