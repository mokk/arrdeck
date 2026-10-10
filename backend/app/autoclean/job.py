"""The cleanup rules' lifecycle: mark, wait out the grace period, recheck,
delete — or release.

A run reads everything fresh (no cache) and refuses to go on if Plex, an arr or
a configured Overseerr does not answer: watch data that is unknown is not
"unwatched", and requests that are unknown are not "nobody asked". It then

1. rechecks every leaving title against the rule that marked it; anything that
   no longer matches, was kept, or whose rule is gone or off, is released;
2. deletes the leaving titles whose date has passed — at most max_deletions,
   oldest first, through the arr with files and an import-list exclusion;
3. marks new matches with a date grace_days ahead.

The "Leaving soon" collections in Plex are then brought in line with what is
leaving. Deciding (plan_run) is pure; applying it goes through a Library, which
tests replace with a fake.
"""

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

import httpx

from ..api.v1.plex import _guid_keys, watch_entry
from ..api.v1.requests import OPEN_FILTERS, request_keys
from ..cache import cache
from ..push.delivery import _send_all
from ..push.events import wants_event
from ..push.pipeline import Notification
from . import store
from .rules import DAY, Candidate, brake, candidate, evaluate, matches

logger = logging.getLogger("arrdeck.cleanup")

COLLECTION_TITLE = "Leaving soon"
CHECK_INTERVAL = 3600
REQUEST_PAGE = 100
REQUEST_PAGES = 50
HEADLINE_TITLES = 3

# One run at a time, whoever started it: the schedule, Run now, a Keep's
# collection update or the switch going off.
RUN_LOCK = asyncio.Lock()


class Unreachable(Exception):
    def __init__(self, service: str, message: str = "unreachable") -> None:
        self.service = service
        self.message = message
        super().__init__(f"{service}: {message}")


class CollectionGone(Exception):
    """The collection was deleted in Plex behind our back."""


class Library(Protocol):
    async def snapshot(self) -> list[Candidate]: ...
    async def delete(self, kind: str, ids: list[int]) -> None: ...
    async def collection_create(self, section: str, section_type: str, rating_key: str) -> str: ...
    async def collection_items(self, collection_id: str) -> list[str]: ...
    async def collection_add(self, collection_id: str, rating_key: str) -> None: ...
    async def collection_remove(self, collection_id: str, rating_key: str) -> None: ...
    async def collection_delete(self, collection_id: str) -> None: ...
    async def notify(self, note: Notification) -> None: ...


def key_of(item: dict) -> str:
    return f"{item['kind']}:{item['id']}"


def row(item: dict, reason: str | None = None) -> dict:
    """A title as the run log records it."""
    return {
        "kind": item["kind"],
        "id": item["id"],
        "title": item.get("title") or "",
        "year": item.get("year"),
        "size": item.get("size") or 0,
        "reason": reason,
        "leave_at": item.get("leave_at"),
    }


def leaving_item(c: Candidate, reasons: list[dict], rule: dict, now: float) -> dict:
    plex = c.plex or {}
    return {
        "kind": c.kind,
        "id": c.id,
        "title": c.title,
        "year": c.year,
        "poster": c.poster,
        "size": c.size,
        "rule_id": rule["id"],
        "rule_name": rule["name"],
        "reasons": reasons,
        "marked_at": int(now),
        "leave_at": int(now + rule["grace_days"] * DAY),
        "plex_key": plex.get("key"),
        "section": plex.get("section"),
        "section_type": plex.get("section_type"),
    }


@dataclass
class Plan:
    release: list[tuple[dict, str]] = field(default_factory=list)
    mark: list[dict] = field(default_factory=list)
    delete: list[dict] = field(default_factory=list)
    deferred: list[dict] = field(default_factory=list)  # due, but over the cap
    kept: list[dict] = field(default_factory=list)  # matched, but on the keep list


def plan_run(
    candidates: list[Candidate],
    rules: list[dict],
    pending: dict[str, dict],
    kept: dict[str, dict],
    max_deletions: int,
    now: float,
) -> Plan:
    plan = Plan()
    active = [r for r in rules if r.get("enabled")]
    by_id = {r["id"]: r for r in active}
    by_key = {c.key: c for c in candidates}
    staying: set[str] = set()
    due = []
    for key, item in sorted(pending.items()):
        rule = by_id.get(item.get("rule_id"))
        c = by_key.get(key)
        if key in kept:
            reason = "kept"
        elif rule is None:
            reason = "rule_off"
        elif c is None:
            reason = "gone"  # deleted by hand, or nothing on disk any more
        else:
            reason = brake(c, now, kept)
            if reason is None and matches(c, rule, now, kept) is None:
                reason = "no_match"
        if reason:
            plan.release.append((item, reason))
            continue
        staying.add(key)
        if now >= item.get("leave_at", 0):
            due.append({**item, "size": c.size})
    for rule in active:
        evaluation = evaluate(candidates, rule, now, kept)
        for m in evaluation.matches:
            if m.candidate.key not in staying:
                staying.add(m.candidate.key)
                plan.mark.append(leaving_item(m.candidate, m.reasons, rule, now))
        for c, why in evaluation.held:
            if why == "kept" and all(r["id"] != c.id or r["kind"] != c.kind for r in plan.kept):
                plan.kept.append(row(vars(c)))
    due.sort(key=lambda i: (i["leave_at"], i["kind"], i["id"]))
    plan.delete, plan.deferred = due[:max_deletions], due[max_deletions:]
    return plan


def new_entry(now: float, trigger: str, dry_run: bool) -> dict:
    return {
        "ts": int(now),
        "trigger": trigger,
        "dry_run": dry_run,
        "skipped": None,
        "marked": [],
        "released": [],
        "kept": [],
        "deleted": [],
        "deferred": 0,
        "errors": [],
    }


def _note(action: str, items: list[dict], days: int = 0) -> Notification:
    count = len(items)
    noun = "title" if count == 1 else "titles"
    return Notification(
        code="cleanup",
        count=count,
        app="arrdeck",
        heading=", ".join(i["title"] for i in items[:HEADLINE_TITLES] if i.get("title")),
        title="Leaving soon" if action == "leaving" else "Cleanup",
        body=(
            f"{count} {noun} leave in {days} days"
            if action == "leaving"
            else f"{count} {noun} were removed"
        ),
        params={"action": action, "days": days} if action == "leaving" else {"action": action},
    )


async def run(
    db, lib: Library, now: float | None = None, *, dry_run: bool = False, trigger: str = "manual"
) -> dict:
    """One pass of the lifecycle. A dry run decides the same things and changes
    nothing — no marks, no collection, no push, no deletion, no log entry."""
    now = time.time() if now is None else now
    settings = store.load_settings(db)
    entry = new_entry(now, trigger, dry_run)
    if not settings["enabled"] and not dry_run:
        entry["skipped"] = "disabled"
        return entry
    try:
        candidates = await lib.snapshot()
    except Unreachable as exc:
        entry["skipped"] = "unreachable"
        entry["errors"].append(str(exc))
        if not dry_run:
            store.append_log(db, entry)
        return entry
    plan = plan_run(
        candidates,
        store.load_rules(db),
        store.load_pending(db),
        store.load_kept(db),
        settings["max_deletions"],
        now,
    )
    entry["released"] = [row(i, reason) for i, reason in plan.release]
    entry["kept"] = plan.kept
    entry["deferred"] = len(plan.deferred)
    if dry_run:
        entry["marked"] = [row(i) for i in plan.mark]
        entry["deleted"] = [row(i) for i in plan.delete]
        return entry
    await apply(db, lib, plan, entry)
    store.append_log(db, entry)
    return entry


async def apply(db, lib: Library, plan: Plan, entry: dict) -> None:
    errors = entry["errors"]
    for item, _reason in plan.release:
        store.unmark(db, key_of(item))

    # A Keep tapped while this run was fetching wins over the deletion.
    kept, pending = store.load_kept(db), store.load_pending(db)
    batch = [i for i in plan.delete if key_of(i) not in kept and key_of(i) in pending]
    deleted: list[dict] = []
    for kind in ("movie", "series"):
        group = [i for i in batch if i["kind"] == kind]
        if not group:
            continue
        try:
            await lib.delete(kind, [i["id"] for i in group])
        except Exception as exc:  # noqa: BLE001 — they stay leaving and are retried next run
            errors.append(f"delete {kind}: {exc}")
            continue
        for item in group:
            store.unmark(db, key_of(item))
            deleted.append(item)
    entry["deleted"] = [row(i) for i in deleted]

    marked = [item for item in plan.mark if store.mark(db, key_of(item), item)]
    entry["marked"] = [row(i) for i in marked]

    await sync_collections(db, lib, errors)
    if deleted:
        await _notify(lib, _note("removed", deleted), errors)
    if marked:
        days = min(round((i["leave_at"] - i["marked_at"]) / DAY) for i in marked)
        await _notify(lib, _note("leaving", marked, days), errors)


async def _notify(lib: Library, note: Notification, errors: list[str]) -> None:
    try:
        await lib.notify(note)
    except Exception as exc:  # noqa: BLE001 — a failed banner must not undo the run
        errors.append(f"push: {exc}")


async def sync_collections(db, lib: Library, errors: list[str]) -> None:
    """One "Leaving soon" collection per Plex section, holding exactly the
    leaving titles Plex has: created with the first, deleted with the last."""
    wanted: dict[str, tuple[str, set[str]]] = {}
    for item in store.load_pending(db).values():
        if item.get("plex_key") and item.get("section"):
            _, keys = wanted.setdefault(item["section"], (item.get("section_type") or "", set()))
            keys.add(str(item["plex_key"]))
    collections = store.load_collections(db)
    for section in sorted(set(wanted) | set(collections)):
        section_type, want = wanted.get(section, ("", set()))
        collection = collections.get(section)
        try:
            if not want:
                if collection:
                    with contextlib.suppress(CollectionGone):
                        await lib.collection_delete(collection)
                store.set_collection(db, section, None)
                continue
            have: set[str] = set()
            if collection:
                try:
                    have = set(await lib.collection_items(collection))
                except CollectionGone:
                    collection = None
            if not collection:
                first = sorted(want)[0]
                collection = await lib.collection_create(section, section_type, first)
                store.set_collection(db, section, collection)
                have = {first}
            for rating_key in sorted(want - have):
                await lib.collection_add(collection, rating_key)
            for rating_key in sorted(have - want):
                await lib.collection_remove(collection, rating_key)
        except Exception as exc:  # noqa: BLE001 — the shelf is a courtesy, never a blocker
            errors.append(f"plex collection {section}: {exc}")


async def keep_title(db, lib: Library, kind: str, item_id: int, title: str, year) -> dict:
    """Never match this title again, and take it off the leaving list now."""
    key = f"{kind}:{item_id}"
    leaving = store.load_pending(db).get(key) or {}
    entry = {
        "kind": kind,
        "id": item_id,
        "title": leaving.get("title") or title,
        "year": leaving.get("year") if leaving else year,
        "kept_at": int(time.time()),
    }
    store.keep(db, key, entry)
    if leaving:
        errors: list[str] = []
        async with RUN_LOCK:
            await sync_collections(db, lib, errors)
        for error in errors:
            logger.warning("cleanup keep: %s", error)
    return entry


async def release_all(db, lib: Library, reason: str = "switched_off") -> None:
    """The switch went off: nothing is leaving any more."""
    async with RUN_LOCK:
        entry = new_entry(time.time(), "switch", False)
        for key, item in store.load_pending(db).items():
            if store.unmark(db, key) is not None:
                entry["released"].append(row(item, reason))
        await sync_collections(db, lib, entry["errors"])
        if entry["released"] or entry["errors"]:
            store.append_log(db, entry)


class LiveLibrary:
    """The real thing: Radarr, Sonarr, Plex and Overseerr through the registry."""

    def __init__(self, db, registry) -> None:
        self.db = db
        self.registry = registry
        self.machine_id = ""

    @property
    def plex(self):
        return self.registry.get("plex")

    async def _plex_maps(self) -> dict[str, dict]:
        """Watch state by guid, per kind. Strict where load_watched is lenient:
        a section that fails fails the run rather than looking unwatched."""
        identity = await self.plex.identity()
        self.machine_id = identity.get("machineIdentifier") or ""
        if not self.machine_id:
            raise Unreachable("plex", "no machine identifier")
        sections = [s for s in await self.plex.sections() if s.get("type") in ("movie", "show")]
        results = await asyncio.gather(*(self.plex.section_items(s["key"]) for s in sections))
        maps: dict[str, dict] = {"movie": {}, "series": {}}
        for section, items in zip(sections, results, strict=True):
            kind = "movie" if section["type"] == "movie" else "series"
            for item in items:
                entry = watch_entry(section["type"], item) | {
                    "section": str(section["key"]),
                    "section_type": section["type"],
                }
                for guid in _guid_keys(item):
                    maps[kind][guid] = entry
        return maps

    async def _requests(self) -> dict:
        """Every open request, paged to the end — unlike the badge map, which
        stops at a hundred. Unconfigured means there is nobody to ask."""
        if not self.registry.is_configured("overseerr"):
            return {}
        overseerr = self.registry.get("overseerr")
        out: dict[str, bool] = {}
        for filter_ in OPEN_FILTERS:
            for page in range(REQUEST_PAGES):
                results = (
                    await overseerr.requests(filter_, REQUEST_PAGE, page * REQUEST_PAGE)
                ).get("results") or []
                for req in results:
                    for key in request_keys(req):
                        out[key] = True
                if len(results) < REQUEST_PAGE:
                    break
            else:
                raise Unreachable("overseerr", "too many open requests to read")
        return out

    async def _items(self, app: str) -> list:
        if not self.registry.is_configured(app):
            return []
        client = self.registry.get(app)
        return await (client.movies() if app == "radarr" else client.series())

    async def snapshot(self) -> list[Candidate]:
        if not self.registry.is_configured("plex"):
            raise Unreachable("plex", "not configured")

        async def strict(service: str, coro):
            try:
                return await coro
            except Unreachable:
                raise
            except Exception as exc:
                raise Unreachable(service, str(exc) or type(exc).__name__) from exc

        maps, requests, movies, series = await asyncio.gather(
            strict("plex", self._plex_maps()),
            strict("overseerr", self._requests()),
            strict("radarr", self._items("radarr")),
            strict("sonarr", self._items("sonarr")),
        )
        return [candidate("movie", m, maps["movie"], requests) for m in movies or []] + [
            candidate("series", s, maps["series"], requests) for s in series or []
        ]

    async def delete(self, kind: str, ids: list[int]) -> None:
        # the library's bulk delete: files go, and import lists may not re-add them
        client = self.registry.get("radarr" if kind == "movie" else "sonarr")
        await client.bulk_delete(ids, True, True)
        cache.set(f"library_map:{kind}", None)

    async def _machine(self) -> str:
        if not self.machine_id:
            self.machine_id = (await self.plex.identity()).get("machineIdentifier") or ""
        return self.machine_id

    async def _gone(self, coro):
        try:
            return await coro
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise CollectionGone from exc
            raise

    async def collection_create(self, section: str, section_type: str, rating_key: str) -> str:
        uri = self.plex.item_uri(await self._machine(), rating_key)
        return await self.plex.create_collection(section, section_type, COLLECTION_TITLE, uri)

    async def collection_items(self, collection_id: str) -> list[str]:
        items = await self._gone(self.plex.collection_items(collection_id))
        return [str(i["ratingKey"]) for i in items if i.get("ratingKey")]

    async def collection_add(self, collection_id: str, rating_key: str) -> None:
        uri = self.plex.item_uri(await self._machine(), rating_key)
        await self._gone(self.plex.collection_add(collection_id, uri))

    async def collection_remove(self, collection_id: str, rating_key: str) -> None:
        # not in it any more is what we wanted
        with contextlib.suppress(CollectionGone):
            await self._gone(self.plex.collection_remove(collection_id, rating_key))

    async def collection_delete(self, collection_id: str) -> None:
        await self._gone(self.plex.delete_collection(collection_id))

    async def notify(self, note: Notification) -> None:
        if self.db.push_all() and wants_event(self.db, "cleanup"):
            await asyncio.to_thread(
                _send_all, self.db, note, "/cleanup", "arrdeck:cleanup", "cleanup"
            )


async def cleanup_loop(db, registry) -> None:
    """Once a day while the switch is on. Waits first, so a restart does not
    run it before Plex and the arrs are back."""
    while True:
        await asyncio.sleep(CHECK_INTERVAL)
        try:
            if not store.load_settings(db)["enabled"]:
                continue
            last = float(db.kv_get(store.LAST_RUN_KEY) or 0)
            if time.time() - last < DAY - CHECK_INTERVAL / 2:
                continue
            # marked first: a run that keeps failing must not retry every hour
            db.kv_set(store.LAST_RUN_KEY, str(time.time()))
            async with RUN_LOCK:
                await run(db, LiveLibrary(db, registry), trigger="schedule")
        except Exception:
            logger.exception("cleanup run failed")
