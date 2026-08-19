import asyncio
import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from ...clients.qbittorrent import QbittorrentClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...clients.transmission import TransmissionClient
from ...deps import get_qbit, get_radarr, get_sonarr, get_transmission
from ...schemas import (
    ImportCandidateOut,
    ManualImportIn,
    RenameIn,
    RenamePreviewOut,
    SpeedLimitIn,
    SpeedLimitOut,
    TorrentActionIn,
    TorrentCategoryIn,
    TorrentDeleteIn,
    TorrentDetailsOut,
    TorrentFileOut,
    TorrentFileToggleIn,
    TorrentForceStartIn,
    TorrentLimitsIn,
    TorrentPriorityIn,
    TorrentTagsIn,
    TrackerOut,
)

router = APIRouter(tags=["downloads"])


def _tm_ids(ids: list[str]) -> list[int]:
    try:
        return [int(i) for i in ids]
    except ValueError as exc:
        raise HTTPException(422, "transmission ids must be integers") from exc


@router.post("/torrents/qbittorrent/pause", status_code=204)
async def qbit_pause(body: TorrentActionIn, qbit: QbittorrentClient = Depends(get_qbit)) -> None:
    await qbit.pause(body.ids)


@router.post("/torrents/qbittorrent/resume", status_code=204)
async def qbit_resume(body: TorrentActionIn, qbit: QbittorrentClient = Depends(get_qbit)) -> None:
    await qbit.resume(body.ids)


@router.post("/torrents/qbittorrent/delete", status_code=204)
async def qbit_delete(body: TorrentDeleteIn, qbit: QbittorrentClient = Depends(get_qbit)) -> None:
    await qbit.delete(body.ids, body.delete_data)


@router.post("/torrents/transmission/pause", status_code=204)
async def tm_pause(body: TorrentActionIn, tm: TransmissionClient = Depends(get_transmission)) -> None:
    await tm.stop(_tm_ids(body.ids))


@router.post("/torrents/transmission/resume", status_code=204)
async def tm_resume(body: TorrentActionIn, tm: TransmissionClient = Depends(get_transmission)) -> None:
    await tm.start(_tm_ids(body.ids))


@router.post("/torrents/transmission/delete", status_code=204)
async def tm_delete(body: TorrentDeleteIn, tm: TransmissionClient = Depends(get_transmission)) -> None:
    await tm.remove(_tm_ids(body.ids), body.delete_data)


class AddTorrentIn(BaseModel):
    url: str
    category: str = ""
    paused: bool = False


@router.get("/torrents/qbittorrent/categories", response_model=list[str])
async def qbit_categories(qbit: QbittorrentClient = Depends(get_qbit)) -> list[str]:
    return sorted((await qbit.categories()).keys())


@router.post("/torrents/{client}/add", status_code=204)
async def add_torrent(
    client: str,
    body: AddTorrentIn,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    if client == "qbittorrent":
        await qbit.add_torrent(url=body.url, category=body.category, paused=body.paused)
    elif client == "transmission":
        await tm.add_torrent(url=body.url, paused=body.paused)
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.post("/torrents/{client}/add-file", status_code=204)
async def add_torrent_file(
    client: str,
    file: UploadFile = File(...),
    category: str = Form(""),
    paused: bool = Form(False),
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    content = await file.read()
    if client == "qbittorrent":
        await qbit.add_torrent(
            file=(file.filename or "upload.torrent", content),
            category=category,
            paused=paused,
        )
    elif client == "transmission":
        await tm.add_torrent(
            metainfo_b64=base64.b64encode(content).decode(), paused=paused
        )
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.get("/torrents/{client}/{torrent_id}/details", response_model=TorrentDetailsOut)
async def torrent_details(
    client: str,
    torrent_id: str,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> TorrentDetailsOut:
    if client == "qbittorrent":
        files, info, categories, trackers = await asyncio.gather(
            qbit.files(torrent_id),
            qbit.torrents([torrent_id]),
            qbit.categories(),
            qbit.trackers(torrent_id),
        )
        torrent = info[0] if info else {}
        # status 4 = not working; skip the DHT/PEX/LSD pseudo entries
        tracker_out = [
            TrackerOut(
                host=tr.get("url", ""),
                ok=tr.get("status") != 4,
                message=(tr.get("msg") or None),
            )
            for tr in trackers
            if not str(tr.get("url", "")).startswith("**")
        ]
        return TorrentDetailsOut(
            files=[
                TorrentFileOut(
                    name=f.get("name", ""),
                    size=f.get("size", 0),
                    progress=f.get("progress", 0.0),
                    index=f.get("index", i),
                    wanted=f.get("priority", 1) > 0,
                )
                for i, f in enumerate(files)
            ],
            dl_limit_kib=max(torrent.get("dl_limit", 0), 0) // 1024,
            ul_limit_kib=max(torrent.get("up_limit", 0), 0) // 1024,
            category=torrent.get("category") or None,
            categories=sorted(categories.keys()),
            trackers=tracker_out,
        )
    if client == "transmission":
        detail = await tm.torrent_details(_tm_ids([torrent_id])[0])
        files = detail.get("files", [])
        return TorrentDetailsOut(
            files=[
                TorrentFileOut(
                    name=f.get("name", ""),
                    size=f.get("length", 0),
                    progress=(f.get("bytesCompleted", 0) / f["length"]) if f.get("length") else 0.0,
                    index=i,
                    wanted=bool((detail.get("fileStats") or [{}] * len(files))[i].get("wanted", True)),
                )
                for i, f in enumerate(files)
            ],
            dl_limit_kib=detail.get("downloadLimit", 0) if detail.get("downloadLimited") else 0,
            ul_limit_kib=detail.get("uploadLimit", 0) if detail.get("uploadLimited") else 0,
            trackers=[
                TrackerOut(
                    host=tr.get("host") or tr.get("announce", ""),
                    ok=bool(tr.get("lastAnnounceSucceeded", True)),
                    message=(
                        tr.get("lastAnnounceResult")
                        if not tr.get("lastAnnounceSucceeded", True)
                        else None
                    ),
                )
                for tr in detail.get("trackerStats", [])
            ],
        )
    raise HTTPException(404, f"unknown client {client!r}")


@router.post("/torrents/{client}/recheck", status_code=204)
async def torrent_recheck(
    client: str,
    body: TorrentActionIn,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    if client == "qbittorrent":
        await qbit.recheck(body.ids)
    elif client == "transmission":
        await tm.verify(_tm_ids(body.ids))
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.post("/torrents/{client}/{torrent_id}/limits", status_code=204)
async def torrent_limits(
    client: str,
    torrent_id: str,
    body: TorrentLimitsIn,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    if client == "qbittorrent":
        await qbit.set_limits([torrent_id], body.dl_kib * 1024, body.ul_kib * 1024)
    elif client == "transmission":
        await tm.set_limits(_tm_ids([torrent_id]), body.dl_kib, body.ul_kib)
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.post("/torrents/{client}/{torrent_id}/files", status_code=204)
async def torrent_file_toggle(
    client: str,
    torrent_id: str,
    body: TorrentFileToggleIn,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    if client == "qbittorrent":
        await qbit.set_file_priority(torrent_id, [body.index], 1 if body.wanted else 0)
    elif client == "transmission":
        await tm.set_files_wanted(_tm_ids([torrent_id])[0], [body.index], body.wanted)
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.post("/torrents/qbittorrent/{torrent_id}/category", status_code=204)
async def torrent_category(
    torrent_id: str, body: TorrentCategoryIn, qbit: QbittorrentClient = Depends(get_qbit)
) -> None:
    await qbit.set_category([torrent_id], body.category)


QBIT_PRIORITY = {
    "top": "topPrio",
    "bottom": "bottomPrio",
    "up": "increasePrio",
    "down": "decreasePrio",
}


@router.post("/torrents/{client}/priority", status_code=204)
async def torrent_priority(
    client: str,
    body: TorrentPriorityIn,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    if client == "qbittorrent":
        await qbit.set_priority(body.ids, QBIT_PRIORITY[body.position])
    elif client == "transmission":
        await tm.queue_move(_tm_ids(body.ids), body.position)
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.post("/torrents/qbittorrent/force-start", status_code=204)
async def torrent_force_start(
    body: TorrentForceStartIn, qbit: QbittorrentClient = Depends(get_qbit)
) -> None:
    await qbit.set_force_start(body.ids, body.value)


@router.get("/torrents/qbittorrent/tags", response_model=list[str])
async def qbit_tags(qbit: QbittorrentClient = Depends(get_qbit)) -> list[str]:
    return await qbit.tags()


@router.post("/torrents/qbittorrent/tags", status_code=204)
async def qbit_set_tags(
    body: TorrentTagsIn, qbit: QbittorrentClient = Depends(get_qbit)
) -> None:
    if body.remove:
        await qbit.remove_tags(body.ids, body.tags)
    else:
        await qbit.add_tags(body.ids, body.tags)


@router.get("/torrents/speed-limit", response_model=SpeedLimitOut)
async def speed_limit(
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> dict:
    """Alternate ("throttled") speed mode, per client. None where the client
    isn't configured or didn't answer — a missing client shouldn't hide the
    toggle for the one that is there."""
    results = await asyncio.gather(
        qbit.alt_speed_enabled(), tm.alt_speed_enabled(), return_exceptions=True
    )
    return {
        name: None if isinstance(value, BaseException) else value
        for name, value in zip(("qbittorrent", "transmission"), results)
    }


@router.post("/torrents/{client}/speed-limit", status_code=204)
async def set_speed_limit(
    client: str,
    body: SpeedLimitIn,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> None:
    if client == "qbittorrent":
        # qBittorrent only offers a toggle, so read first and no-op when it
        # already matches — otherwise a "turn on" could turn it off
        if await qbit.alt_speed_enabled() != body.enabled:
            await qbit.toggle_alt_speed()
    elif client == "transmission":
        await tm.set_alt_speed(body.enabled)
    else:
        raise HTTPException(404, f"unknown client {client!r}")


@router.post("/queue/{app}/{item_id}/blocklist-retry", status_code=204)
async def blocklist_retry(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app not in ("radarr", "sonarr"):
        raise HTTPException(404, f"unknown app {app!r}")
    client = radarr if app == "radarr" else sonarr
    payload = await client.queue()
    rec = next((r for r in payload.get("records", []) if r.get("id") == item_id), None)
    if rec is None:
        raise HTTPException(404, "queue item not found")
    await client.delete_queue_item(item_id, remove_from_client=True, blocklist=True)
    # immediately hunt for a replacement release
    if app == "radarr" and rec.get("movieId"):
        await client.command({"name": "MoviesSearch", "movieIds": [rec["movieId"]]})
    elif app == "sonarr":
        if rec.get("episodeId"):
            await client.command({"name": "EpisodeSearch", "episodeIds": [rec["episodeId"]]})
        elif rec.get("seriesId"):
            await client.command({"name": "SeriesSearch", "seriesId": rec["seriesId"]})


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


@router.delete("/queue/{app}/{item_id}", status_code=204)
async def remove_queue_item(
    app: str,
    item_id: int,
    remove_from_client: bool = True,
    blocklist: bool = False,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> None:
    if app == "radarr":
        await radarr.delete_queue_item(item_id, remove_from_client, blocklist)
    elif app == "sonarr":
        await sonarr.delete_queue_item(item_id, remove_from_client, blocklist)
    else:
        raise HTTPException(404, f"unknown app {app!r}")
