import asyncio

from fastapi import APIRouter, Depends, HTTPException

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


@router.get("/torrents/{client}/{torrent_id}/details", response_model=TorrentDetailsOut)
async def torrent_details(
    client: str,
    torrent_id: str,
    qbit: QbittorrentClient = Depends(get_qbit),
    tm: TransmissionClient = Depends(get_transmission),
) -> TorrentDetailsOut:
    if client == "qbittorrent":
        files, info, categories = await asyncio.gather(
            qbit.files(torrent_id), qbit.torrents([torrent_id]), qbit.categories()
        )
        torrent = info[0] if info else {}
        return TorrentDetailsOut(
            files=[
                TorrentFileOut(name=f.get("name", ""), size=f.get("size", 0), progress=f.get("progress", 0.0))
                for f in files
            ],
            dl_limit_kib=max(torrent.get("dl_limit", 0), 0) // 1024,
            ul_limit_kib=max(torrent.get("up_limit", 0), 0) // 1024,
            category=torrent.get("category") or None,
            categories=sorted(categories.keys()),
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
