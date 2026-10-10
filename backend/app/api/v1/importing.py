"""Rescuing a stuck download: manual import, hand-picked targets, renaming."""

import re

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cached
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_sonarr
from ...schemas import (
    ImportCandidateOut,
    ImportCommandOut,
    ImportOptionsOut,
    ManualImportAssignIn,
    ManualImportFileIn,
    ManualImportIn,
    RenameIn,
    RenamePreviewOut,
)

router = APIRouter(tags=["importing"])

FINISHED = {"completed", "failed", "aborted", "cancelled", "orphaned"}
# "Manually imported 3 files" — the arrs' closing progress line
IMPORTED_RE = re.compile(r"imported (\d+) files?", re.IGNORECASE)


def command_out(app: str, command: dict | None) -> dict:
    """What the PWA needs to say how an import went, from the arr's command."""
    command = command or {}
    status = command.get("status") or "queued"
    done = status in FINISHED
    message = command.get("message") or None
    # a crash leaves the message at "Failed" and the reason in a full .NET
    # stack trace, whose first line is the part a person can act on
    trace = (command.get("exception") or "").strip().splitlines()
    if status == "failed" and trace and message in (None, "Failed"):
        message = trace[0]
    match = IMPORTED_RE.search(message or "")
    return {
        "app": app,
        "id": command.get("id") or 0,
        "status": status,
        "result": command.get("result"),
        "message": message,
        "done": done,
        "ok": (status == "completed" and command.get("result") != "unsuccessful") if done else None,
        "imported": int(match.group(1)) if match else None,
    }


def _own_target(app: str, candidate: dict) -> dict:
    """The arr's own match for a candidate as payload ids, or {} when it
    couldn't place it. An id can be missing even when the arr returned a stub
    match; that is still "couldn't place it", not a crash."""
    if app == "radarr":
        movie_id = (candidate.get("movie") or {}).get("id")
        return {"movieId": movie_id} if movie_id else {}
    series_id = (candidate.get("series") or {}).get("id")
    episode_ids = [e["id"] for e in candidate.get("episodes") or [] if e.get("id")]
    if series_id and episode_ids:
        return {"seriesId": series_id, "episodeIds": episode_ids}
    return {}


def _import_file(app: str, candidate: dict, download_id: str | None = None) -> dict | None:
    """The ManualImport command payload for one candidate, or None when the arr
    didn't work out what it is."""
    target = _own_target(app, candidate)
    if not candidate.get("quality") or not target:
        return None
    return {
        "path": candidate["path"],
        "quality": candidate["quality"],
        "languages": candidate.get("languages", []),
        "releaseGroup": candidate.get("releaseGroup") or "",
        **_tracked(download_id),
        **target,
    }


def _tracked(download_id: str | None) -> dict:
    """Ties an imported file to the arr's tracked download. Without it the arr
    has no download client item, and importMode "auto" then means *move* — the
    torrent loses its files and stops seeding. With it, auto copies/hardlinks
    until the client says the files may be moved."""
    return {"downloadId": download_id} if download_id else {}


async def _queue_download_id(client, item_id: int) -> str:
    payload = await client.queue()
    rec = next((r for r in payload.get("records", []) if r.get("id") == item_id), None)
    if rec is None or not rec.get("downloadId"):
        raise HTTPException(404, "queue item not found")
    return rec["downloadId"]


def _describe_candidate(app: str, candidate: dict) -> dict:
    quality = ((candidate.get("quality") or {}).get("quality") or {}).get("name")
    if app == "radarr":
        movie = candidate.get("movie") or {}
        title, subtitle = movie.get("title", ""), None
    else:
        series = candidate.get("series") or {}
        episodes = candidate.get("episodes") or []
        title = series.get("title", "")
        subtitle = None
        if episodes:
            first = episodes[0]
            season, number = first.get("seasonNumber"), first.get("episodeNumber")
            if season is not None and number is not None:
                subtitle = f"S{season:02d}E{number:02d}"
                if len(episodes) > 1:
                    subtitle += f" +{len(episodes) - 1}"
    return {
        "path": candidate.get("path", ""),
        "name": candidate.get("name") or (candidate.get("path", "").rsplit("/", 1)[-1]),
        "size": candidate.get("size", 0),
        "title": title,
        "subtitle": subtitle,
        "quality": quality,
        "quality_id": ((candidate.get("quality") or {}).get("quality") or {}).get("id"),
        "languages": [x.get("name", "") for x in candidate.get("languages") or []],
        "language_ids": [x["id"] for x in candidate.get("languages") or [] if "id" in x],
        "rejections": [
            r.get("reason", "") if isinstance(r, dict) else str(r)
            for r in candidate.get("rejections") or []
        ],
        "importable": _import_file(app, candidate) is not None,
    }


async def _import_options(app: str, client) -> dict:
    """The qualities and languages a file can be imported as, keyed by id.
    Languages with negative ids ("Any", "Original") are profile wildcards,
    not something a file can be."""

    async def fetch() -> dict:
        definitions = await client.quality_definitions()
        languages = await client.languages()
        return {
            "qualities": {
                d["quality"]["id"]: d["quality"] for d in definitions if d.get("quality")
            },
            "languages": {
                lang["id"]: {"id": lang["id"], "name": lang.get("name", "")}
                for lang in languages
                if lang.get("id", -1) >= 0
            },
        }

    return await cached(f"import-options:{app}", 600, fetch)


def _quality(candidate: dict, choice: ManualImportFileIn, options: dict | None) -> dict:
    detected = candidate.get("quality")
    if choice.quality_id is None:
        if not detected:
            raise HTTPException(409, f"the arr could not determine a quality for {choice.path!r}")
        return detected
    chosen = (options or {}).get("qualities", {}).get(choice.quality_id)
    if chosen is None:
        raise HTTPException(422, f"unknown quality id {choice.quality_id}")
    # only the quality itself changes; the revision (proper/repack) the arr
    # parsed from the name still holds
    revision = (detected or {}).get("revision") or {"version": 1, "real": 0, "isRepack": False}
    return {"quality": chosen, "revision": revision}


def _languages(candidate: dict, choice: ManualImportFileIn, options: dict | None) -> list:
    if not choice.language_ids:
        return candidate.get("languages", [])
    known = (options or {}).get("languages", {})
    unknown = [i for i in choice.language_ids if i not in known]
    if unknown:
        raise HTTPException(422, f"unknown language ids {unknown}")
    return [known[i] for i in choice.language_ids]


def _target(app: str, candidate: dict, choice: ManualImportFileIn) -> dict:
    """The user's pick when there is one, else the arr's own match."""
    picked = choice.movie_id or choice.series_id or choice.episode_ids
    own = {} if picked else _own_target(app, candidate)
    if app == "radarr":
        movie_id = choice.movie_id or own.get("movieId")
        if not movie_id:
            raise HTTPException(422, "a movie must be chosen for each file")
        return {"movieId": movie_id}
    series_id = choice.series_id or own.get("seriesId")
    episode_ids = choice.episode_ids or own.get("episodeIds")
    if not series_id or not episode_ids:
        raise HTTPException(422, "a series and at least one episode must be chosen")
    return {"seriesId": series_id, "episodeIds": episode_ids}


async def _build_files(
    app: str,
    client,
    candidates: list[dict],
    choices: list[ManualImportFileIn],
    download_id: str | None,
) -> list[dict]:
    """ManualImport files for the user's choices, checked against what the arr
    actually found: a path it did not offer is refused, never passed through."""
    by_path = {c.get("path"): c for c in candidates}
    overriding = any(c.quality_id is not None or c.language_ids for c in choices)
    options = await _import_options(app, client) if overriding else None
    files = []
    for choice in choices:
        candidate = by_path.get(choice.path)
        if candidate is None:
            raise HTTPException(404, f"no candidate for {choice.path!r}")
        files.append(
            {
                "path": choice.path,
                "quality": _quality(candidate, choice, options),
                "languages": _languages(candidate, choice, options),
                "releaseGroup": candidate.get("releaseGroup") or "",
                **_tracked(download_id),
                **_target(app, candidate, choice),
            }
        )
    if not files:
        raise HTTPException(422, "nothing to import")
    return files


@router.get("/manual-import/{app}/options", response_model=ImportOptionsOut)
async def manual_import_options(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    """What a file's quality and languages can be set to in an import. Declared
    before /manual-import/{app}/{item_id}, which would otherwise claim it."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    options = await _import_options(app, radarr if app == "radarr" else sonarr)
    return {
        "qualities": [
            {"id": i, "name": q.get("name", "")} for i, q in options["qualities"].items()
        ],
        "languages": sorted(options["languages"].values(), key=lambda lang: lang["name"]),
    }


@router.get("/manual-import/{app}/{item_id}", response_model=list[ImportCandidateOut])
async def manual_import_candidates(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    """Everything the arr found in a stuck download's folder, including the
    files force-import skips, with the reasons it balked."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    candidates = await client.manual_import(await _queue_download_id(client, item_id))
    return [_describe_candidate(app, c) for c in candidates]


@router.post("/manual-import/{app}", response_model=ImportCommandOut)
async def manual_import_run(
    app: str,
    body: ManualImportIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    download_id = await _queue_download_id(client, body.item_id)
    candidates = await client.manual_import(download_id)
    wanted = set(body.paths)
    files = [
        f
        for f in (_import_file(app, c, download_id) for c in candidates if c.get("path") in wanted)
        if f
    ]
    if not files:
        raise HTTPException(409, "none of the selected files could be mapped")
    command = await client.command(
        {"name": "ManualImport", "files": files, "importMode": body.mode}
    )
    return command_out(app, command)


@router.post("/manual-import/{app}/assign", response_model=ImportCommandOut)
async def manual_import_assign(
    app: str,
    body: ManualImportAssignIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    """Import files against targets the user picked, for the ones the arr
    couldn't place itself; a file sent without a target keeps the arr's own
    match, so one request (and one command to follow) covers both. Quality and
    language still come from the arr's own detection — it parses those from
    the filename even when the title is a mystery, and guessing them here
    would be worse than reusing its answer."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    download_id = await _queue_download_id(client, body.item_id)
    candidates = await client.manual_import(download_id)
    files = await _build_files(app, client, candidates, body.files, download_id)
    command = await client.command(
        {"name": "ManualImport", "files": files, "importMode": body.mode}
    )
    return command_out(app, command)


@router.get("/manual-import/{app}/command/{command_id}", response_model=ImportCommandOut)
async def manual_import_command(
    app: str,
    command_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    """How an import the arr accepted went. Poll until `done`; `message` is
    the arr's own words, success or failure."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    return command_out(app, await client.get_command(command_id))


@router.get("/rename/{app}/{item_id}", response_model=list[RenamePreviewOut])
async def rename_preview(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[dict]:
    """Files whose names don't match the arr's naming scheme. Empty means
    everything is already named correctly."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    key = "movieId" if app == "radarr" else "seriesId"
    file_key = "movieFileId" if app == "radarr" else "episodeFileId"
    return [
        {
            "file_id": r.get(file_key, 0),
            "existing_path": r.get("existingPath", ""),
            "new_path": r.get("newPath", ""),
        }
        for r in await client.rename_preview(**{key: item_id})
    ]


@router.post("/rename/{app}", status_code=204)
async def rename_files(
    app: str,
    body: RenameIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    if not body.file_ids:
        raise HTTPException(422, "nothing to rename")
    client = radarr if app == "radarr" else sonarr
    key = "movieId" if app == "radarr" else "seriesId"
    await client.command({"name": "RenameFiles", key: body.id, "files": body.file_ids})


@router.post("/queue/{app}/{item_id}/force-import", response_model=ImportCommandOut)
async def force_import(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> dict:
    """Rescue a stuck import: take the arr's manual-import candidates that
    already have a confident mapping and import them."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    payload = await client.queue()
    rec = next((r for r in payload.get("records", []) if r.get("id") == item_id), None)
    if rec is None or not rec.get("downloadId"):
        raise HTTPException(404, "queue item not found")
    candidates = await client.manual_import(rec["downloadId"])
    files = [f for f in (_import_file(app, c, rec["downloadId"]) for c in candidates) if f]
    if not files:
        raise HTTPException(409, "no importable files could be mapped automatically")
    command = await client.command({"name": "ManualImport", "files": files, "importMode": "auto"})
    return command_out(app, command)
