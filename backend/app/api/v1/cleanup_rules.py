"""Cleanup rules: the switch, the rules and their preview, what is leaving
soon, the keep list and the run log. The lifecycle itself is in autoclean/.

Off unless switched on, twice over: the global switch and each rule's own.
A preview and a dry run work either way and change nothing.
"""

import time

from fastapi import APIRouter, Body, HTTPException, Request

from ...autoclean import job, store
from ...autoclean.rules import evaluate
from ...clients.base import ServiceUnavailable
from ...schemas import (
    CleanupKeepIn,
    CleanupKeptOut,
    CleanupLeavingOut,
    CleanupPreviewOut,
    CleanupRuleIn,
    CleanupRulesIn,
    CleanupRulesOut,
    CleanupRunOut,
)

router = APIRouter(tags=["library"])

KINDS = ("movie", "series")


def _library(request: Request) -> job.LiveLibrary:
    return job.LiveLibrary(request.app.state.db, request.app.state.registry)


def _kind(kind: str) -> str:
    if kind not in KINDS:
        raise HTTPException(404, f"unknown kind {kind!r}")
    return kind


@router.get("/cleanup/rules", response_model=CleanupRulesOut)
def get_rules(request: Request) -> dict:
    db = request.app.state.db
    return {"settings": store.load_settings(db), "rules": store.load_rules(db)}


@router.put("/cleanup/rules", response_model=CleanupRulesOut)
async def put_rules(body: CleanupRulesIn, request: Request) -> dict:
    """Replaces the switch and the whole rule list. A rule without an id gets
    one. Switching off releases everything that was leaving, so turning it on
    again starts every grace period afresh."""
    db = request.app.state.db
    was_on = store.load_settings(db)["enabled"]
    settings = store.save_settings(db, body.settings.model_dump())
    rules = store.save_rules(db, [r.model_dump() for r in body.rules])
    if was_on and not settings["enabled"]:
        await job.release_all(db, _library(request))
    return {"settings": settings, "rules": rules}


@router.post("/cleanup/rules/preview", response_model=CleanupPreviewOut)
async def preview_rule(body: CleanupRuleIn, request: Request) -> dict:
    """What this rule — saved or not, on or off — would take right now, why,
    and how much space that is. Read-only. 502 when Plex, an arr or Overseerr
    cannot be asked, rather than an answer built on missing data."""
    db = request.app.state.db
    try:
        candidates = await _library(request).snapshot()
    except job.Unreachable as exc:
        raise ServiceUnavailable(exc.service, exc.message) from exc
    rule = store.normalise_rule(body.model_dump())
    result = evaluate(candidates, rule, time.time(), store.load_kept(db))
    pending = store.load_pending(db)
    held: dict[str, int] = {}
    for _c, why in result.held:
        held[why] = held.get(why, 0) + 1
    return {
        "matches": [
            {
                **{k: getattr(m.candidate, k) for k in ("kind", "id", "title", "year", "poster")},
                "size": m.candidate.size,
                "reasons": m.reasons,
                "leave_at": (pending.get(m.candidate.key) or {}).get("leave_at"),
            }
            for m in result.matches
        ],
        "total_size": sum(m.candidate.size for m in result.matches),
        "held": held,
    }


@router.get("/cleanup/leaving", response_model=list[CleanupLeavingOut])
def leaving(request: Request) -> list[dict]:
    """Titles marked to go, soonest first."""
    return sorted(store.load_pending(request.app.state.db).values(), key=lambda i: i["leave_at"])


@router.post("/cleanup/leaving/{kind}/{item_id}/keep", response_model=CleanupKeptOut)
async def keep(
    kind: str, item_id: int, request: Request, body: CleanupKeepIn | None = Body(None)
) -> dict:
    """Keep a title for good: off the leaving list and the Plex shelf, and never
    matched by any rule again until it is taken off the keep list. Works for a
    title that is not leaving yet, too (from a preview)."""
    body = body or CleanupKeepIn()
    return await job.keep_title(
        request.app.state.db, _library(request), _kind(kind), item_id, body.title, body.year
    )


@router.get("/cleanup/kept", response_model=list[CleanupKeptOut])
def kept(request: Request) -> list[dict]:
    return sorted(store.load_kept(request.app.state.db).values(), key=lambda i: -i["kept_at"])


@router.delete("/cleanup/kept", status_code=204)
def clear_kept(request: Request) -> None:
    """Empty the keep list: the rules may match those titles again."""
    store.unkeep(request.app.state.db)


@router.delete("/cleanup/kept/{kind}/{item_id}", status_code=204)
def unkeep(kind: str, item_id: int, request: Request) -> None:
    store.unkeep(request.app.state.db, f"{_kind(kind)}:{item_id}")


@router.get("/cleanup/log", response_model=list[CleanupRunOut])
def run_log(request: Request) -> list[dict]:
    """The last runs, newest first. Dry runs are not recorded."""
    return store.load_log(request.app.state.db)


@router.post("/cleanup/run", response_model=CleanupRunOut)
async def run_now(request: Request, dry_run: bool = False) -> dict:
    """Run the lifecycle now. With the switch off only a dry run does anything
    (the answer says skipped=disabled otherwise). 409 while a run is going."""
    if job.RUN_LOCK.locked():
        raise HTTPException(409, "a cleanup run is already going")
    async with job.RUN_LOCK:
        return await job.run(request.app.state.db, _library(request), dry_run=dry_run)
