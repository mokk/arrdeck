"""Finding music and adding it to Lidarr: an artist with their discography,
or one album (and its artist with it, when Lidarr does not have them)."""

import asyncio
import copy

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache, cached
from ...clients.lidarr import LidarrClient
from ...deps import get_lidarr
from ...schemas import AddAlbumIn, AddArtistIn, SearchResultOut
from .music import ARTISTS_KEY, artist_image, forget_artists, music_cover, year_of
from .posters import proxy_poster

router = APIRouter(tags=["music"])

LIBRARY_KEY = "library_map:music"


async def music_library_map(lidarr: LidarrClient) -> dict[str, dict]:
    """MusicBrainz id -> library summary, artists and albums alike (the ids
    never collide), for the in-library badge on search results."""
    hit = cache.get(LIBRARY_KEY, 60)
    if hit is not None:
        return hit
    artists, albums = await asyncio.gather(cached(ARTISTS_KEY, 60, lidarr.artists), lidarr.albums())
    out: dict[str, dict] = {}
    for a in artists:
        stats = a.get("statistics") or {}
        if a.get("foreignArtistId"):
            out[a["foreignArtistId"]] = {
                "library_id": a["id"],
                "monitored": bool(a.get("monitored")),
                "has_file": (stats.get("trackFileCount") or 0) > 0,
                "quality_profile_id": a.get("qualityProfileId"),
                # Lidarr's search hands back a library artist without artwork
                "poster": artist_image(a),
            }
    for b in albums:
        stats = b.get("statistics") or {}
        if b.get("foreignAlbumId"):
            out[b["foreignAlbumId"]] = {
                "library_id": b["id"],
                "monitored": bool(b.get("monitored")),
                "has_file": (stats.get("trackFileCount") or 0) > 0,
            }
    cache.set(LIBRARY_KEY, out)
    return out


def music_search_result(entry: dict, library: dict[str, dict]) -> SearchResultOut | None:
    """One entry of Lidarr's combined search: an artist or an album."""
    if artist := entry.get("artist"):
        fid = artist.get("foreignArtistId")
        known = dict(library.get(fid or "", {}))
        library_poster = known.pop("poster", None)
        poster = (
            music_cover(artist.get("images"), ("poster",))
            or proxy_poster(artist.get("remotePoster"))
            or library_poster
        )
        return SearchResultOut(
            kind="artist",
            title=artist.get("artistName") or "",
            overview=artist.get("overview") or None,
            remote_id=0,
            foreign_id=fid,
            poster=poster,
            in_library=bool(known),
            **known,
        )
    if album := entry.get("album"):
        fid = album.get("foreignAlbumId")
        known = library.get(fid or "", {})
        return SearchResultOut(
            kind="album",
            title=album.get("title") or "",
            year=year_of(album.get("releaseDate")),
            overview=album.get("overview") or None,
            remote_id=0,
            foreign_id=fid,
            poster=music_cover(album.get("images")) or proxy_poster(album.get("remoteCover")),
            in_library=bool(known),
            artist=(album.get("artist") or {}).get("artistName"),
            album_type=album.get("albumType") or None,
            **known,
        )
    return None


@router.get("/search/music", response_model=list[SearchResultOut])
async def search_music(q: str, lidarr: LidarrClient = Depends(get_lidarr)) -> list:
    """Artists and albums from Lidarr's metadata server, best match first."""
    results, library = await asyncio.gather(lidarr.search(q), music_library_map(lidarr))
    out = [music_search_result(entry, library) for entry in results]
    return [r for r in out if r is not None][:30]


async def default_metadata_profile(lidarr: LidarrClient, chosen: int | None) -> int | None:
    if chosen is not None:
        return chosen
    profiles = await lidarr.metadata_profiles()
    return profiles[0]["id"] if profiles else None


def new_artist(artist: dict, **settings) -> dict:
    payload = copy.deepcopy(artist)
    payload.update({k: v for k, v in settings.items() if k != "addOptions"})
    payload["tags"] = payload.get("tags") or []
    payload["addOptions"] = settings.get("addOptions") or {}
    return payload


@router.post("/artists", status_code=201)
async def add_artist(body: AddArtistIn, lidarr: LidarrClient = Depends(get_lidarr)) -> dict:
    """An artist with the albums their metadata profile allows, monitored as
    `monitor` says. The lookup is repeated by MusicBrainz id because Lidarr
    wants the whole resource back."""
    found = await lidarr.lookup_artist(f"lidarr:{body.foreign_artist_id}")
    artist = next((a for a in found if a.get("foreignArtistId") == body.foreign_artist_id), None)
    if artist is None:
        raise HTTPException(404, "Lidarr no longer finds that artist")
    payload = new_artist(
        artist,
        qualityProfileId=body.quality_profile_id,
        metadataProfileId=await default_metadata_profile(lidarr, body.metadata_profile_id),
        rootFolderPath=body.root_folder_path,
        monitored=body.monitored,
        monitorNewItems=body.monitor_new_items,
        # Lidarr sets the artist's own flag from addOptions.monitored once added
        addOptions={
            "monitor": body.monitor,
            "monitored": body.monitored,
            "searchForMissingAlbums": body.search_now and body.monitored,
        },
    )
    created = await lidarr.add_artist(payload)
    forget_artists()
    return {"id": created.get("id"), "title": created.get("artistName")}


@router.post("/albums", status_code=201)
async def add_album(body: AddAlbumIn, lidarr: LidarrClient = Depends(get_lidarr)) -> dict:
    """One album. When Lidarr does not have its artist it adds them too, the way
    its own Add Album does: with the given profiles and folder, this album
    monitored and nothing else, and later albums left alone."""
    found = await lidarr.lookup_album(f"lidarr:{body.foreign_album_id}")
    album = next((a for a in found if a.get("foreignAlbumId") == body.foreign_album_id), None)
    if album is None:
        raise HTTPException(404, "Lidarr no longer finds that album")
    payload = copy.deepcopy(album)
    artist = payload.get("artist") or {}
    if not artist.get("id"):
        artist = new_artist(
            artist,
            qualityProfileId=body.quality_profile_id,
            metadataProfileId=await default_metadata_profile(lidarr, body.metadata_profile_id),
            rootFolderPath=body.root_folder_path,
            monitored=True,
            monitorNewItems="none",
            # Lidarr applies these once the artist is in. albumsToMonitor wins
            # over `monitor` for the albums, so only this one is monitored;
            # "none" would leave the artist unmonitored too (seen on 3.1),
            # and an unmonitored artist's albums are never searched for
            addOptions={
                "monitor": "all",
                "albumsToMonitor": [body.foreign_album_id],
                "monitored": True,
                "searchForMissingAlbums": False,
            },
        )
    payload["artist"] = artist
    payload["monitored"] = body.monitored
    payload["addOptions"] = {"searchForNewAlbum": body.search_now and body.monitored}
    created = await lidarr.add_album(payload)
    forget_artists()
    return {"id": created.get("id"), "title": created.get("title")}
