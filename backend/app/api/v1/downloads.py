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
    TorrentActionIn,
    TorrentCategoryIn,
    TorrentDeleteIn,
    TorrentDetailsOut,
    TorrentFileOut,
    TorrentLimitsIn,
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
                TorrentFileOut(name=f.get("name", ""), size=f.get("size", 0), progress=f.get("progress", 0.0))
                for f in files
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
                )
                for f in files
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


@router.post("/torrents/qbittorrent/{torrent_id}/category", status_code=204)
async def torrent_category(
    torrent_id: str, body: TorrentCategoryIn, qbit: QbittorrentClient = Depends(get_qbit)
) -> None:
    await qbit.set_category([torrent_id], body.category)


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
    files = []
    for c in candidates:
        if not c.get("quality"):
            continue
        if app == "radarr" and c.get("movie"):
            files.append(
                {
                    "path": c["path"],
                    "movieId": c["movie"]["id"],
                    "quality": c["quality"],
                    "languages": c.get("languages", []),
                    "releaseGroup": c.get("releaseGroup") or "",
                }
            )
        elif app == "sonarr" and c.get("series") and c.get("episodes"):
            files.append(
                {
                    "path": c["path"],
                    "seriesId": c["series"]["id"],
                    "episodeIds": [e["id"] for e in c["episodes"]],
                    "quality": c["quality"],
                    "languages": c.get("languages", []),
                    "releaseGroup": c.get("releaseGroup") or "",
                }
            )
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
