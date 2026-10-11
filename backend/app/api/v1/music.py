"""Lidarr's library, as far as choosing an artist and album needs: the import
sheet points a file nobody could place at one of these."""

from fastapi import APIRouter, Depends

from ...cache import cached
from ...clients.lidarr import LidarrClient
from ...deps import get_lidarr
from ...schemas import LibraryAlbumOut, LibraryArtistOut
from .posters import proxy_poster

router = APIRouter(tags=["music"])


def music_cover(images: list | None, kinds: tuple[str, ...] = ("cover", "poster")) -> str | None:
    """Lidarr's artwork, when it has an address a browser can load: an album's
    cover, an artist's poster. Lidarr reports its own copies as container
    paths (/config/MediaCover/…), which are no use outside it."""
    for kind in kinds:
        for img in images or []:
            url = img.get("remoteUrl") or ""
            if img.get("coverType") == kind and url.startswith(("http://", "https://")):
                return proxy_poster(url)
    return None


def year_of(date: str | None) -> int | None:
    if not date or len(date) < 4 or not date[:4].isdigit():
        return None
    year = int(date[:4])
    return year if year > 1 else None  # Lidarr's "no date" is 0001-01-01


def album_row(album: dict, artist_name: str | None = None) -> dict:
    stats = album.get("statistics") or {}
    artist = album.get("artist") or {}
    return {
        "id": album["id"],
        "title": album.get("title") or "",
        "artist_id": album.get("artistId"),
        "artist": artist.get("artistName") or artist_name,
        "year": year_of(album.get("releaseDate")),
        "release_date": album.get("releaseDate"),
        "album_type": album.get("albumType"),
        "monitored": bool(album.get("monitored")),
        "track_count": stats.get("totalTrackCount") or stats.get("trackCount") or 0,
        "track_file_count": stats.get("trackFileCount") or 0,
        "poster": music_cover(album.get("images")),
    }


@router.get("/library/artists", response_model=list[LibraryArtistOut])
async def library_artists(lidarr: LidarrClient = Depends(get_lidarr)) -> list[dict]:
    """Every artist Lidarr tracks, by its own sort name."""

    async def call() -> list[dict]:
        return await lidarr.artists()

    artists = await cached("lidarr:artists", 60, call)
    rows = [
        {
            "id": a["id"],
            "name": a.get("artistName") or "",
            "sort_name": a.get("sortName"),
            "monitored": bool(a.get("monitored")),
            "album_count": (a.get("statistics") or {}).get("albumCount") or 0,
            "track_file_count": (a.get("statistics") or {}).get("trackFileCount") or 0,
            "poster": music_cover(a.get("images"), ("poster",)),
        }
        for a in artists
    ]
    return sorted(rows, key=lambda r: (r["sort_name"] or r["name"]).lower())


@router.get("/library/artists/{artist_id}/albums", response_model=list[LibraryAlbumOut])
async def artist_albums(artist_id: int, lidarr: LidarrClient = Depends(get_lidarr)) -> list[dict]:
    """One artist's albums, newest first."""
    albums = await lidarr.albums(artist_id)
    rows = [album_row(a) for a in albums]
    return sorted(rows, key=lambda r: r["release_date"] or "", reverse=True)
