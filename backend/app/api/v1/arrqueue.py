"""Arr queue maintenance: blocklist-and-retry, and removing an item."""

from fastapi import APIRouter, Depends, HTTPException

from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_readarr, get_sonarr

router = APIRouter(tags=["queue"])


@router.post("/queue/{app}/{item_id}/blocklist-retry", status_code=204)
async def blocklist_retry(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> None:
    clients = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    client = clients[app]
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
    elif app == "readarr" and rec.get("bookId"):
        await client.command({"name": "BookSearch", "bookIds": [rec["bookId"]]})


@router.delete("/queue/{app}/{item_id}", status_code=204)
async def remove_queue_item(
    app: str,
    item_id: int,
    remove_from_client: bool = True,
    blocklist: bool = False,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> None:
    if app == "radarr":
        await radarr.delete_queue_item(item_id, remove_from_client, blocklist)
    elif app == "sonarr":
        await sonarr.delete_queue_item(item_id, remove_from_client, blocklist)
    elif app == "readarr":
        await readarr.delete_queue_item(item_id, remove_from_client, blocklist)
    else:
        raise HTTPException(404, f"unknown app {app!r}")


@router.post("/queue/{app}/{item_id}/grab", status_code=204)
async def grab_now(
    app: str,
    item_id: int,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
) -> None:
    """Send a release a delay profile is holding to the download client now,
    rather than when the delay runs out."""
    clients = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    await clients[app].request("POST", f"/queue/grab/{item_id}")
