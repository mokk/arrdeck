"""Rescuing a stuck download: manual import, hand-picked targets, renaming."""

from fastapi import APIRouter, Depends, HTTPException

from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_sonarr
from ...schemas import (
    ImportCandidateOut,
    ManualImportAssignIn,
    ManualImportIn,
    RenameIn,
    RenamePreviewOut,
)

router = APIRouter(tags=["importing"])


def _import_file(app: str, candidate: dict) -> dict | None:
    """The ManualImport command payload for one candidate, or None when the arr
    didn't work out what it is."""
    if not candidate.get("quality"):
        return None
    common = {
        "path": candidate["path"],
        "quality": candidate["quality"],
        "languages": candidate.get("languages", []),
        "releaseGroup": candidate.get("releaseGroup") or "",
    }
    # an id can be missing even when the arr returned a stub match; that is
    # still "couldn't place it", not a crash
    if app == "radarr":
        movie_id = (candidate.get("movie") or {}).get("id")
        return {**common, "movieId": movie_id} if movie_id else None
    series_id = (candidate.get("series") or {}).get("id")
    episode_ids = [e["id"] for e in candidate.get("episodes") or [] if e.get("id")]
    if series_id and episode_ids:
        return {**common, "seriesId": series_id, "episodeIds": episode_ids}
    return None


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
        "languages": [x.get("name", "") for x in candidate.get("languages") or []],
        "rejections": [
            r.get("reason", "") if isinstance(r, dict) else str(r)
            for r in candidate.get("rejections") or []
        ],
        "importable": _import_file(app, candidate) is not None,
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


@router.post("/manual-import/{app}", status_code=204)
async def manual_import_run(
    app: str,
    body: ManualImportIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    candidates = await client.manual_import(await _queue_download_id(client, body.item_id))
    wanted = set(body.paths)
    files = [
        f
        for f in (_import_file(app, c) for c in candidates if c.get("path") in wanted)
        if f
    ]
    if not files:
        raise HTTPException(409, "none of the selected files could be mapped")
    await client.command({"name": "ManualImport", "files": files, "importMode": body.mode})


@router.post("/manual-import/{app}/assign", status_code=204)
async def manual_import_assign(
    app: str,
    body: ManualImportAssignIn,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    """Import files against targets the user picked, for the ones the arr
    couldn't place itself. Quality and language still come from the arr's own
    detection — it parses those from the filename even when the title is a
    mystery, and guessing them here would be worse than reusing its answer."""
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    candidates = await client.manual_import(await _queue_download_id(client, body.item_id))
    by_path = {c.get("path"): c for c in candidates}

    files = []
    for choice in body.files:
        candidate = by_path.get(choice.path)
        if candidate is None:
            raise HTTPException(404, f"no candidate for {choice.path!r}")
        if not candidate.get("quality"):
            raise HTTPException(409, f"the arr could not determine a quality for {choice.path!r}")
        entry = {
            "path": choice.path,
            "quality": candidate["quality"],
            "languages": candidate.get("languages", []),
            "releaseGroup": candidate.get("releaseGroup") or "",
        }
        if app == "radarr":
            if not choice.movie_id:
                raise HTTPException(422, "a movie must be chosen for each file")
            entry["movieId"] = choice.movie_id
        else:
            if not choice.series_id or not choice.episode_ids:
                raise HTTPException(422, "a series and at least one episode must be chosen")
            entry["seriesId"] = choice.series_id
            entry["episodeIds"] = choice.episode_ids
        files.append(entry)

    if not files:
        raise HTTPException(422, "nothing to import")
    await client.command({"name": "ManualImport", "files": files, "importMode": body.mode})


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
) -> None:
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
    files = [f for f in (_import_file(app, c) for c in candidates) if f]
    if not files:
        raise HTTPException(409, "no importable files could be mapped automatically")
    await client.command({"name": "ManualImport", "files": files, "importMode": "auto"})
