"""Lidarr's library: artists and their albums, an album's tracks and files,
editing and removing them, and the artwork Lidarr keeps for itself.

Lidarr hangs albums off artists the way Readarr hangs books off authors: the
quality and metadata profile are the artist's, an album has its own monitored
flag and the releases (pressings) it can be matched to.
"""

import hashlib
import re
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ...cache import cache, cached
from ...clients.lidarr import LidarrClient
from ...deps import get_lidarr
from ...posters import POSTER_DIR
from ...posters import touch as touch_poster
from ...schemas import (
    AlbumDetailOut,
    ArtistDetailOut,
    ArtistUpdateIn,
    HistoryEventOut,
    LibraryAlbumOut,
    LibraryArtistOut,
    LibraryUpdateIn,
    RatingOut,
)
from .posters import proxy_poster

router = APIRouter(tags=["music"])

ARTISTS_KEY = "lidarr:artists"
# what a Music tab card shows: Lidarr's 250px copy, a twentieth of the original
GRID_SIZE = "250"
DETAIL_SIZE = "500"
# the artwork names Lidarr serves for an artist: poster-250.jpg, fanart.jpg…
IMAGE_NAME = re.compile(r"^(poster|fanart|banner)(-\d{2,4})?\.jpg$")


def music_cover(images: list | None, kinds: tuple[str, ...] = ("cover", "poster")) -> str | None:
    """Artwork with an address a browser can load: an album's cover, a looked-up
    artist's poster. Lidarr reports its own copies of a library artist's
    pictures as container paths (/config/MediaCover/…); artist_image serves those."""
    for kind in kinds:
        for img in images or []:
            url = img.get("remoteUrl") or img.get("url") or ""
            if img.get("coverType") == kind and url.startswith(("http://", "https://")):
                return proxy_poster(url)
    return None


def artist_image(artist: dict, kind: str = "poster", size: str | None = GRID_SIZE) -> str | None:
    """A library artist's poster or fanart. Lidarr's own copy goes through
    arrdeck (the browser has no key for Lidarr), versioned by Lidarr's
    lastWrite so a new picture is not hidden behind the cache."""
    remote = music_cover(artist.get("images"), (kind,))
    if remote:
        return remote
    for img in artist.get("images") or []:
        if img.get("coverType") != kind or not artist.get("id"):
            continue
        version = parse_qs(urlparse(img.get("url") or "").query).get("lastWrite", [""])[0]
        # fanart has no size Lidarr scales to for a backdrop; take the original
        name = f"{kind}-{size}.jpg" if size and kind == "poster" else f"{kind}.jpg"
        suffix = f"?v={version}" if version.isdigit() else ""
        return f"/api/v1/library/artists/{artist['id']}/image/{name}{suffix}"
    return None


def year_of(date: str | None) -> int | None:
    if not date or len(date) < 4 or not date[:4].isdigit():
        return None
    year = int(date[:4])
    return year if year > 1 else None  # Lidarr's "no date" is 0001-01-01


def rating_of(item: dict) -> float | None:
    """Lidarr's single score, out of 10. It sends 0 when there are no votes."""
    ratings = item.get("ratings") or {}
    return ratings.get("value") if ratings.get("value") and ratings.get("votes") else None


def ratings_of(item: dict) -> list[RatingOut]:
    """The same score as the chips the movie and series pages show. Lidarr's
    metadata takes it from MusicBrainz's community ratings."""
    value = rating_of(item)
    if value is None:
        return []
    votes = (item.get("ratings") or {}).get("votes") or None
    return [RatingOut(source="musicbrainz", value=value, votes=votes)]


def links_of(item: dict) -> list[dict]:
    """Lidarr's links, one per site: an artist lists Apple Music four times."""
    out, seen = [], set()
    for link in item.get("links") or []:
        name, url = (link.get("name") or "").strip(), link.get("url") or ""
        if not name or not url.startswith(("http://", "https://")) or name in seen:
            continue
        seen.add(name)
        out.append({"name": name, "url": url})
    return out


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
        "size_on_disk": stats.get("sizeOnDisk") or 0,
        "secondary_types": album.get("secondaryTypes") or [],
        "rating": rating_of(album),
    }


def artist_row(artist: dict) -> dict:
    stats = artist.get("statistics") or {}
    return {
        "id": artist["id"],
        "name": artist.get("artistName") or "",
        "sort_name": artist.get("sortName"),
        "monitored": bool(artist.get("monitored")),
        "album_count": stats.get("albumCount") or 0,
        "track_file_count": stats.get("trackFileCount") or 0,
        "poster": artist_image(artist),
        "track_count": stats.get("totalTrackCount") or stats.get("trackCount") or 0,
        "size_on_disk": stats.get("sizeOnDisk") or 0,
        "added": artist.get("added"),
        "quality_profile_id": artist.get("qualityProfileId"),
        "metadata_profile_id": artist.get("metadataProfileId"),
        "monitor_new_items": artist.get("monitorNewItems"),
        "tags": artist.get("tags") or [],
        "genres": artist.get("genres") or [],
        "rating": rating_of(artist),
        "status": artist.get("status"),
        "disambiguation": artist.get("disambiguation") or None,
        "slug": artist.get("foreignArtistId"),
    }


def forget_artists() -> None:
    """After a change: the tab, the picker and the search badges re-read."""
    cache.set(ARTISTS_KEY, None)
    cache.set("library_map:music", None)


@router.get("/library/artists", response_model=list[LibraryArtistOut])
async def library_artists(lidarr: LidarrClient = Depends(get_lidarr)) -> list[dict]:
    """Every artist Lidarr tracks, by its own sort name."""

    async def call() -> list[dict]:
        return await lidarr.artists()

    artists = await cached(ARTISTS_KEY, 60, call)
    rows = [artist_row(a) for a in artists]
    return sorted(rows, key=lambda r: (r["sort_name"] or r["name"]).lower())


@router.get("/library/artists/{artist_id}/albums", response_model=list[LibraryAlbumOut])
async def artist_albums(artist_id: int, lidarr: LidarrClient = Depends(get_lidarr)) -> list[dict]:
    """One artist's albums, newest first."""
    albums = await lidarr.albums(artist_id)
    rows = [album_row(a) for a in albums]
    return sorted(rows, key=lambda r: r["release_date"] or "", reverse=True)


@router.get("/library/artists/{artist_id}", response_model=ArtistDetailOut)
async def artist_detail(artist_id: int, lidarr: LidarrClient = Depends(get_lidarr)) -> dict:
    """An artist with every album Lidarr knows for them, monitored or not:
    this is where an album gets monitored."""
    artist = await lidarr.get_artist(artist_id)
    albums = await lidarr.albums(artist_id)
    row = artist_row(artist)
    row["poster"] = artist_image(artist, size=DETAIL_SIZE)
    return {
        **row,
        "overview": artist.get("overview") or None,
        "artist_type": artist.get("artistType") or None,
        "path": artist.get("path"),
        "root_folder_path": artist.get("rootFolderPath"),
        "fanart": artist_image(artist, "fanart"),
        "links": links_of(artist),
        "ratings": ratings_of(artist),
        "albums": sorted(
            (album_row(a, row["name"]) for a in albums),
            key=lambda r: r["release_date"] or "",
            reverse=True,
        ),
    }


@router.patch("/library/artists/{artist_id}", response_model=LibraryArtistOut)
async def update_artist(
    artist_id: int, body: ArtistUpdateIn, lidarr: LidarrClient = Depends(get_lidarr)
) -> dict:
    """Monitoring, profiles, folder and tags. Lidarr takes the whole artist
    back, so it is read, changed and returned."""
    artist = await lidarr.get_artist(artist_id)
    changes = {
        "monitored": body.monitored,
        "monitorNewItems": body.monitor_new_items,
        "qualityProfileId": body.quality_profile_id,
        "metadataProfileId": body.metadata_profile_id,
        "tags": body.tags,
    }
    artist.update({k: v for k, v in changes.items() if v is not None})
    move = False
    if body.path is not None:
        path = body.path.strip()
        if not path.startswith("/"):
            raise HTTPException(422, "path must be absolute")
        move = body.move_files and path != artist.get("path")
        artist["path"] = path
    updated = await lidarr.update_artist(artist_id, artist, move_files=move)
    forget_artists()
    return artist_row(updated)


@router.delete("/library/artists/{artist_id}", status_code=204)
async def delete_artist(
    artist_id: int, delete_files: bool = False, lidarr: LidarrClient = Depends(get_lidarr)
) -> None:
    await lidarr.delete_artist(artist_id, delete_files)
    forget_artists()


@router.post("/library/artists/{artist_id}/refresh", status_code=204)
async def refresh_artist(artist_id: int, lidarr: LidarrClient = Depends(get_lidarr)) -> None:
    """Have Lidarr fetch the artist's albums and artwork again and rescan the folder."""
    await lidarr.command({"name": "RefreshArtist", "artistId": artist_id})
    forget_artists()


@router.get("/library/artists/{artist_id}/image/{name}", include_in_schema=False)
async def artist_artwork(
    artist_id: int, name: str, v: str = "", lidarr: LidarrClient = Depends(get_lidarr)
):
    """Lidarr's own copy of an artist's poster or fanart, cached like /poster.
    ?v= is Lidarr's lastWrite, so a replaced picture is fetched afresh."""
    if not IMAGE_NAME.match(name):
        raise HTTPException(404, "no such artwork")
    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    key = f"lidarr:{lidarr.base_url}:{artist_id}:{name}:{v}"
    cached_file = POSTER_DIR / (hashlib.sha1(key.encode()).hexdigest() + ".img")
    if cached_file.exists():
        touch_poster(cached_file)
    else:
        try:
            resp = await lidarr.open_media_cover(f"artist/{artist_id}/{name}")
        except Exception as exc:
            raise HTTPException(502, "artwork fetch failed") from exc
        if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
            raise HTTPException(404, "Lidarr has no such artwork")
        cached_file.write_bytes(resp.content)
    return FileResponse(
        cached_file,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


# ---------------------------------------------------------------- albums


def history_rows(records: list[dict], limit: int = 12) -> list[HistoryEventOut]:
    """An album's history as events. Lidarr records an import per track, so
    one download is collapsed to one event of each kind."""
    from .dashboard import EVENT_LABELS  # dashboard imports this module

    out: list[HistoryEventOut] = []
    seen: set[tuple] = set()
    for rec in records:
        label = EVENT_LABELS.get(rec.get("eventType", ""), rec.get("eventType", ""))
        key = (label, rec.get("downloadId") or (rec.get("date") or "")[:16])
        if key in seen:
            continue
        seen.add(key)
        out.append(HistoryEventOut(type=label, date=rec.get("date", "")))
    return out[:limit]


def track_rows(tracks: list[dict], files: list[dict]) -> list[dict]:
    by_id = {f["id"]: f for f in files if "id" in f}
    rows = []
    for t in tracks:
        f = by_id.get(t.get("trackFileId")) if t.get("trackFileId") else None
        duration = t.get("duration") or 0
        rows.append(
            {
                "id": t["id"],
                "medium": t.get("mediumNumber") or 1,
                "number": t.get("trackNumber") or None,
                "absolute": t.get("absoluteTrackNumber") or 0,
                "title": t.get("title"),
                "duration": round(duration / 1000) if duration else None,
                "has_file": bool(t.get("hasFile")),
                "file_id": f["id"] if f else None,
                "quality": ((f.get("quality") or {}).get("quality") or {}).get("name")
                if f
                else None,
                "size": f.get("size") if f else None,
            }
        )
    return sorted(rows, key=lambda r: (r["medium"], r["absolute"]))


def chosen_release(album: dict) -> dict:
    releases = album.get("releases") or []
    return next((r for r in releases if r.get("monitored")), releases[0] if releases else {})


@router.get("/library/albums/{album_id}/detail", response_model=AlbumDetailOut)
async def album_detail(album_id: int, lidarr: LidarrClient = Depends(get_lidarr)) -> dict:
    album = await lidarr.get_album(album_id)
    tracks = await lidarr.tracks(album_id)
    try:
        files = await lidarr.track_files(album_id)
    except Exception:  # noqa: BLE001 — without files the tracks still say what is there
        files = []
    try:
        history = await lidarr.history_album(album_id)
    except Exception:  # noqa: BLE001 — history is decoration
        history = []
    artist = album.get("artist") or {}
    stats = album.get("statistics") or {}
    release = chosen_release(album)
    release_bits = [release.get("format"), ", ".join(release.get("label") or []) or None]
    return {
        "id": album["id"],
        "title": album.get("title") or "",
        "disambiguation": album.get("disambiguation") or None,
        "artist": artist.get("artistName"),
        "artist_id": album.get("artistId"),
        "overview": album.get("overview") or None,
        "poster": music_cover(album.get("images")),
        "release_date": album.get("releaseDate"),
        "year": year_of(album.get("releaseDate")),
        "album_type": album.get("albumType"),
        "secondary_types": album.get("secondaryTypes") or [],
        "genres": album.get("genres") or [],
        "monitored": bool(album.get("monitored")),
        "track_count": stats.get("totalTrackCount") or stats.get("trackCount") or len(tracks),
        "track_file_count": stats.get("trackFileCount") or 0,
        "size_on_disk": stats.get("sizeOnDisk") or 0,
        "duration": round(album["duration"] / 1000) if album.get("duration") else None,
        "quality_profile_id": artist.get("qualityProfileId"),
        "ratings": ratings_of(album),
        "links": links_of(album),
        "slug": album.get("foreignAlbumId"),
        "artist_slug": artist.get("foreignArtistId"),
        "release": " · ".join(b for b in release_bits if b) or None,
        "media": [
            {
                "number": m.get("mediumNumber") or 0,
                "name": m.get("mediumName") or None,
                "format": m.get("mediumFormat") or None,
            }
            for m in release.get("media") or []
        ],
        "tracks": track_rows(tracks, files),
        "history": history_rows(history),
    }


@router.patch("/library/albums/{album_id}")
async def update_album(
    album_id: int, body: LibraryUpdateIn, lidarr: LidarrClient = Depends(get_lidarr)
) -> dict:
    """An album's monitored flag. Its quality profile is the artist's, which
    the artist page edits."""
    if body.quality_profile_id is not None:
        raise HTTPException(422, "an album's quality profile is its artist's")
    if body.monitored is not None:
        await lidarr.monitor_albums([album_id], body.monitored)
        forget_artists()
    album = await lidarr.get_album(album_id)
    return {"id": album["id"], "monitored": bool(album.get("monitored"))}


@router.delete("/library/albums/{album_id}/files", status_code=204)
async def delete_album_files(album_id: int, lidarr: LidarrClient = Depends(get_lidarr)) -> None:
    """Every track file of the album, from disk. The album stays, so a
    monitored one is searched for again."""
    files = await lidarr.track_files(album_id)
    if files:
        await lidarr.delete_track_files([f["id"] for f in files])
    forget_artists()


@router.delete("/library/albums/{album_id}/files/{file_id}", status_code=204)
async def delete_track_file(
    album_id: int, file_id: int, lidarr: LidarrClient = Depends(get_lidarr)
) -> None:
    """One track file, from disk; it must belong to the album."""
    files = await lidarr.track_files(album_id)
    if not any(f.get("id") == file_id for f in files):
        raise HTTPException(404, "no such file on this album")
    await lidarr.delete_track_files([file_id])
    forget_artists()
