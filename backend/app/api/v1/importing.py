"""Rescuing a stuck download: manual import, hand-picked targets, renaming;
and importing a finished torrent that no arr is tracking."""

import posixpath
import re

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cached
from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...clients.transmission import TransmissionClient
from ...deps import get_qbit, get_radarr, get_readarr, get_sonarr, get_transmission
from ...schemas import (
    ImportCandidateOut,
    ImportCommandOut,
    ImportOptionsOut,
    ManualImportAssignIn,
    ManualImportFileIn,
    ManualImportIn,
    RenameIn,
    RenamePreviewOut,
    TorrentImportIn,
)

router = APIRouter(tags=["importing"])

LABELS = {
    "radarr": "Radarr",
    "sonarr": "Sonarr",
    "readarr": "Readarr",
    "qbittorrent": "qBittorrent",
    "transmission": "Transmission",
}

FINISHED = {"completed", "failed", "aborted", "cancelled", "orphaned"}
# a v1 or v2 info hash; Transmission also takes its own numeric id
HASH_RE = re.compile(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}")
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
    if app == "readarr":
        author_id = (candidate.get("author") or {}).get("id")
        book_id = (candidate.get("book") or {}).get("id")
        edition = candidate.get("foreignEditionId")
        if author_id and book_id and edition:
            return {"authorId": author_id, "bookId": book_id, "foreignEditionId": edition}
        return {}
    series_id = (candidate.get("series") or {}).get("id")
    episode_ids = [e["id"] for e in candidate.get("episodes") or [] if e.get("id")]
    if series_id and episode_ids:
        return {"seriesId": series_id, "episodeIds": episode_ids}
    return {}


def _file_payload(
    app: str, candidate: dict, quality: dict, languages: list, download_id: str | None
) -> dict:
    """One ManualImport file, minus its target, in the arr's own shape."""
    if app == "readarr":
        # Readarr's ManualImportFile has no languages or release group
        return {
            "path": candidate["path"],
            "quality": quality,
            "indexerFlags": candidate.get("indexerFlags") or 0,
            **_tracked(download_id),
        }
    return {
        "path": candidate["path"],
        "quality": quality,
        "languages": languages,
        "releaseGroup": candidate.get("releaseGroup") or "",
        **_tracked(download_id),
    }


def _import_file(app: str, candidate: dict, download_id: str | None = None) -> dict | None:
    """The ManualImport command payload for one candidate, or None when the arr
    didn't work out what it is."""
    target = _own_target(app, candidate)
    if not candidate.get("quality") or not target:
        return None
    languages = candidate.get("languages", [])
    return {**_file_payload(app, candidate, candidate["quality"], languages, download_id), **target}


def _tracked(download_id: str | None) -> dict:
    """Ties an imported file to the arr's tracked download. Without it the arr
    has no download client item, and importMode "auto" then means *move* — the
    torrent loses its files and stops seeding. With it, auto copies/hardlinks
    until the client says the files may be moved."""
    return {"downloadId": download_id} if download_id else {}


def _client(app: str, radarr, sonarr, readarr):
    clients = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    return clients[app]


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
    elif app == "readarr":
        book = candidate.get("book") or {}
        title = book.get("title", "")
        subtitle = (candidate.get("author") or {}).get("authorName")
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
        # Readarr's files carry no language, so there is nothing to offer
        languages = [] if app == "readarr" else await client.languages()
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


async def _target(app: str, client, candidate: dict, choice: ManualImportFileIn) -> dict:
    """The user's pick when there is one, else the arr's own match."""
    picked = choice.movie_id or choice.series_id or choice.episode_ids or choice.book_id
    own = {} if picked else _own_target(app, candidate)
    if app == "radarr":
        movie_id = choice.movie_id or own.get("movieId")
        if not movie_id:
            raise HTTPException(422, "a movie must be chosen for each file")
        return {"movieId": movie_id}
    if app == "readarr":
        if choice.book_id:
            return await _book_target(client, choice.book_id)
        if not own:
            raise HTTPException(422, "a book must be chosen for each file")
        return own
    series_id = choice.series_id or own.get("seriesId")
    episode_ids = choice.episode_ids or own.get("episodeIds")
    if not series_id or not episode_ids:
        raise HTTPException(422, "a series and at least one episode must be chosen")
    return {"seriesId": series_id, "episodeIds": episode_ids}


async def _book_target(client, book_id: int) -> dict:
    """Readarr imports into an edition, not just a book: a picked book goes to
    its monitored edition, the one Readarr's own import screen would use."""
    book = await client.get_book(book_id)
    editions = await client.editions(book_id)
    edition = next((e for e in editions if e.get("monitored")), None)
    if not book.get("authorId") or edition is None or not edition.get("foreignEditionId"):
        raise HTTPException(409, "Readarr has no monitored edition for that book")
    return {
        "authorId": book["authorId"],
        "bookId": book_id,
        "foreignEditionId": edition["foreignEditionId"],
    }


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
        quality = _quality(candidate, choice, options)
        languages = _languages(candidate, choice, options)
        files.append(
            {
                **_file_payload(app, candidate, quality, languages, download_id),
                **await _target(app, client, candidate, choice),
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
    readarr: ReadarrClient = Depends(get_readarr),
) -> dict:
    """What a file's quality and languages can be set to in an import. Declared
    before /manual-import/{app}/{item_id}, which would otherwise claim it."""
    options = await _import_options(app, _client(app, radarr, sonarr, readarr))
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
    readarr: ReadarrClient = Depends(get_readarr),
) -> list[dict]:
    """Everything the arr found in a stuck download's folder, including the
    files force-import skips, with the reasons it balked."""
    client = _client(app, radarr, sonarr, readarr)
    candidates = await client.manual_import(await _queue_download_id(client, item_id))
    return [_describe_candidate(app, c) for c in candidates]


@router.post("/manual-import/{app}", response_model=ImportCommandOut)
async def manual_import_run(
    app: str,
    body: ManualImportIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> dict:
    client = _client(app, radarr, sonarr, readarr)
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
    readarr: ReadarrClient = Depends(get_readarr),
) -> dict:
    """Import files against targets the user picked, for the ones the arr
    couldn't place itself; a file sent without a target keeps the arr's own
    match, so one request (and one command to follow) covers both. Quality and
    language still come from the arr's own detection — it parses those from
    the filename even when the title is a mystery, and guessing them here
    would be worse than reusing its answer."""
    client = _client(app, radarr, sonarr, readarr)
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
    readarr: ReadarrClient = Depends(get_readarr),
) -> dict:
    """How an import the arr accepted went. Poll until `done`; `message` is
    the arr's own words, success or failure."""
    client = _client(app, radarr, sonarr, readarr)
    return command_out(app, await client.get_command(command_id))


# --- a finished torrent no arr is tracking ----------------------------------


def _inside(save_path: str, path: str) -> str:
    """`path`, normalised, provided it lies strictly under `save_path`; the
    torrent client is the only source of both, but a renamed torrent can
    still carry "../" in its name."""
    root = posixpath.normpath(save_path)
    full = posixpath.normpath(path)
    if not root.startswith("/") or posixpath.commonpath([root, full]) != root or full == root:
        raise HTTPException(409, f"{path!r} is not inside the torrent's save path {save_path!r}")
    return full


async def _torrent_content(client_name: str, torrent_id: str, qbit, transmission) -> dict:
    """Where a finished torrent's content lives, from the torrent client
    itself: {folder, save_path, hash}. Nothing here comes from the request
    except which torrent."""
    numeric = client_name == "transmission" and torrent_id.isdigit()
    if not (HASH_RE.fullmatch(torrent_id) or numeric):
        raise HTTPException(404, "torrent not found")
    if client_name == "qbittorrent":
        found = await qbit.torrents(hashes=[torrent_id])
        torrent = next(
            (t for t in found if (t.get("hash") or "").lower() == torrent_id.lower()), None
        )
        if torrent is None:
            raise HTTPException(404, "torrent not found")
        done = (torrent.get("progress") or 0) >= 1
        save_path = torrent.get("save_path") or ""
        # root_path is the torrent's top folder; a single-file torrent has
        # none, and content_path is then the file itself
        content = (
            torrent.get("root_path")
            or torrent.get("content_path")
            or posixpath.join(save_path, torrent.get("name") or "")
        )
        torrent_hash = torrent.get("hash") or torrent_id
    else:
        torrent = await transmission.torrent(
            int(torrent_id) if torrent_id.isdigit() else torrent_id
        )
        if torrent is None:
            raise HTTPException(404, "torrent not found")
        done = (torrent.get("percentDone") or 0) >= 1
        save_path = torrent.get("downloadDir") or ""
        content = posixpath.join(save_path, torrent.get("name") or "")
        torrent_hash = torrent.get("hashString") or ""
    if not done:
        raise HTTPException(409, "the torrent has not finished downloading")
    return {"folder": _inside(save_path, content), "save_path": save_path, "hash": torrent_hash}


async def _tracked_by(torrent_hash: str, arrs: dict) -> str | None:
    """The arr that already has this download in its queue, if any. Those are
    fixed from their queue item, where the arr keeps its own bookkeeping."""
    for app, client in arrs.items():
        try:
            records = (await client.queue()).get("records", [])
        except Exception:  # noqa: BLE001 — an arr that is down tracks nothing we can see
            continue
        if any((r.get("downloadId") or "").lower() == torrent_hash.lower() for r in records):
            return app
    return None


async def _torrent_candidates(
    app: str, client, client_name: str, content: dict, arrs: dict
) -> list[dict]:
    if content["hash"]:
        tracker = await _tracked_by(content["hash"], arrs)
        if tracker:
            raise HTTPException(
                409,
                f"{LABELS[tracker]} is already tracking this download; "
                "fix it from its queue item (Needs attention) instead",
            )
    folder = content["folder"]
    candidates = await client.manual_import_folder(folder)
    if candidates:
        return candidates
    # Empty can mean "nothing importable" or "that path does not exist where
    # the arr runs". Ask the arr to list the parent rather than guess at a
    # path mapping.
    parent, name = posixpath.split(folder)
    listing = await client.filesystem(parent.rstrip("/") + "/")
    seen = {
        e.get("name")
        for e in (listing or {}).get("directories", []) + (listing or {}).get("files", [])
    }
    if name not in seen:
        raise HTTPException(
            409,
            f"{LABELS[app]} can't see {folder}: {LABELS[client_name]} saved it to a folder "
            f"that isn't mounted at the same path in {LABELS[app]}. Mount it there, or add "
            f"a remote path mapping in {LABELS[app]}.",
        )
    return []


@router.get(
    "/manual-import/{app}/torrent/{client_name}/{torrent_id}",
    response_model=list[ImportCandidateOut],
)
async def torrent_import_candidates(
    app: str,
    client_name: str,
    torrent_id: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    qbit: QbittorrentClient = Depends(get_qbit),
    transmission: TransmissionClient = Depends(get_transmission),
) -> list[dict]:
    """What the arr makes of a finished torrent's folder, in the same shape as
    a queue item's candidates."""
    client = _client(app, radarr, sonarr, readarr)
    if client_name not in ("qbittorrent", "transmission"):
        raise HTTPException(404, f"unknown torrent client {client_name!r}")
    content = await _torrent_content(client_name, torrent_id, qbit, transmission)
    arrs = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    candidates = await _torrent_candidates(app, client, client_name, content, arrs)
    return [_describe_candidate(app, c) for c in candidates]


@router.post("/manual-import/{app}/torrent", response_model=ImportCommandOut)
async def torrent_import(
    app: str,
    body: TorrentImportIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
    qbit: QbittorrentClient = Depends(get_qbit),
    transmission: TransmissionClient = Depends(get_transmission),
) -> dict:
    """Import picked files from a finished torrent's folder. The folder is
    worked out again here and every path must be one the arr found in it."""
    client = _client(app, radarr, sonarr, readarr)
    content = await _torrent_content(body.client, body.torrent_id, qbit, transmission)
    arrs = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    candidates = await _torrent_candidates(app, client, body.client, content, arrs)
    files = await _build_files(app, client, candidates, body.files, None)
    # No tracked download here, and for the arr that turns auto into a move:
    # copy keeps the torrent's files (a hardlink when the arr is set to use them)
    mode = "copy" if body.mode == "auto" else body.mode
    command = await client.command({"name": "ManualImport", "files": files, "importMode": mode})
    return command_out(app, command)


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


@router.post("/queue/{app}/{item_id}/force-import", status_code=204)
async def force_import(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> None:
    """Rescue a stuck import: take the arr's manual-import candidates that
    already have a confident mapping and import them. Answers 204 with no body,
    as it always has: installed iOS builds treat anything else as a failure."""
    client = _client(app, radarr, sonarr, readarr)
    payload = await client.queue()
    rec = next((r for r in payload.get("records", []) if r.get("id") == item_id), None)
    if rec is None or not rec.get("downloadId"):
        raise HTTPException(404, "queue item not found")
    candidates = await client.manual_import(rec["downloadId"])
    files = [f for f in (_import_file(app, c, rec["downloadId"]) for c in candidates) if f]
    if not files:
        raise HTTPException(409, "no importable files could be mapped automatically")
    await client.command({"name": "ManualImport", "files": files, "importMode": "auto"})
