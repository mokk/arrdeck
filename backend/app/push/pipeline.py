"""Between an event and a banner: dedupe, coalesce a burst, then flush."""

import asyncio
import time
from dataclasses import dataclass, field

from ..db import SettingsDB
from .delivery import _send_all
from .events import COALESCE_WINDOW, NOUNS, Event, get_rules, logger, passes_rules, wants_event

FLUSH_INTERVAL = 5


DEDUPE_TTL = 6 * 3600


@dataclass
class _Slot:
    event: Event
    due: float
    count: int = 1
    titles: list[str] = field(default_factory=list)


class Coalescer:
    """Holds events open for COALESCE_WINDOW seconds so bursts merge."""

    def __init__(self) -> None:
        self._pending: dict[str, _Slot] = {}
        self._lock = asyncio.Lock()

    async def add(self, event: Event, now: float) -> None:
        async with self._lock:
            slot = self._pending.get(event.group)
            if slot is None:
                # The window is anchored to the first member, so a long import
                # run flushes in steady batches instead of never settling.
                self._pending[event.group] = _Slot(
                    event=event, due=now + COALESCE_WINDOW, titles=[event.title]
                )
            else:
                slot.count += 1
                slot.titles.append(event.title)

    async def due(self, now: float) -> list[_Slot]:
        async with self._lock:
            ready = [g for g, slot in self._pending.items() if slot.due <= now]
            return [self._pending.pop(g) for g in ready]


COALESCER = Coalescer()


@dataclass
class Notification:
    """What to show, described rather than written out.

    The text used to be assembled here in English and shown verbatim, so a
    Danish device got English notifications — and a native client would have no
    way to localise a banner that arrives pre-rendered. `code` names what
    happened, `count` and `app` are what the sentence needs, and `heading` is
    pass-through media text that must not be translated.

    `title`/`body` are kept as an English rendering so a service worker that
    predates this still shows something instead of a blank banner.
    """

    code: str
    count: int
    app: str
    heading: str
    title: str
    body: str


def render(slot: _Slot) -> Notification:
    event = slot.event
    label = event.label
    if slot.count == 1:
        return Notification(
            code=event.key,
            count=1,
            app=event.app,
            heading=event.title,
            title=event.title or label,
            body=label,
        )
    noun = NOUNS.get(event.app, "items")
    if event.group_title:
        return Notification(
            code=event.key,
            count=slot.count,
            app=event.app,
            heading=event.group_title,
            title=event.group_title,
            body=f"{label} · {slot.count} {noun}",
        )
    return Notification(
        code=event.key,
        count=slot.count,
        app=event.app,
        heading="",
        title=label,
        body=f"{slot.count} {noun}",
    )


async def notify(db: SettingsDB, event: Event) -> bool:
    """Queue an event for delivery. False when it was filtered or already sent."""
    if not db.push_all():
        return False
    if event.key == "test":  # always delivered: it exists to prove the wiring
        await asyncio.to_thread(
            _send_all,
            db,
            Notification(
                code="test",
                count=1,
                app=event.app,
                heading=event.title,
                title=event.title,
                body=event.label,
            ),
            event.url,
            event.tag,
            "test",
        )
        return True
    if not wants_event(db, event.key):
        return False
    if not passes_rules(get_rules(db), event):
        return False
    if not db.notified_add(event.dedupe_key, int(time.time()), DEDUPE_TTL):
        return False
    await COALESCER.add(event, time.monotonic())
    return True


async def flush_loop(db: SettingsDB) -> None:
    while True:
        await asyncio.sleep(FLUSH_INTERVAL)
        try:
            for slot in await COALESCER.due(time.monotonic()):
                note = render(slot)
                await asyncio.to_thread(
                    _send_all, db, note, slot.event.url, slot.event.tag, slot.event.key
                )
        except Exception:  # noqa: BLE001 — the notifier must never die
            logger.exception("push flush failed")
