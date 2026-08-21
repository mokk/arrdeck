"""Artwork proxy: normalises TMDB sizes and caches to disk."""

import hashlib
import re
from urllib.parse import quote, urlparse

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from ...posters import POSTER_DIR
from ...posters import touch as _touch_poster

router = APIRouter(tags=["posters"])

POSTER_HOSTS = {
    "image.tmdb.org",
    "artworks.thetvdb.com",
    "assets.fanart.tv",
    "images.fanart.tv",
    "fanart.tv",
}
TMDB_SIZE_RE = re.compile(r"(https://image\.tmdb\.org/t/p/)([^/]+)(/)")
TMDB_POSTER_SIZE = "w500"
# A cast headshot renders about 44px across. At w500 each one is ~81 KB against
# ~14 KB at w185, and a credits list has a dozen of them.
TMDB_HEADSHOT_SIZE = "w185"
ALLOWED_TMDB_SIZES = {TMDB_HEADSHOT_SIZE, TMDB_POSTER_SIZE}


def normalise_poster_url(url: str, size: str | None = None) -> str:
    match = TMDB_SIZE_RE.search(url)
    if not match:
        return url
    current = match.group(2)
    # A caller-chosen size wins. Otherwise keep a size we already allow, so the
    # endpoint cannot inflate a headshot back to poster width on the way through;
    # anything else — notably the /original the arrs hand out at ~220 KB — is
    # clamped rather than trusted.
    chosen = size or (current if current in ALLOWED_TMDB_SIZES else TMDB_POSTER_SIZE)
    return TMDB_SIZE_RE.sub(rf"\1{chosen}\3", url)


def proxy_poster(url: str | None, size: str | None = None) -> str | None:
    """Rewrite known poster URLs through the caching proxy endpoint."""
    if not url:
        return None
    host = urlparse(url).hostname
    if host not in POSTER_HOSTS:
        return url
    return f"/api/v1/poster?u={quote(normalise_poster_url(url, size), safe='')}"


@router.get("/poster", include_in_schema=False)
async def poster(u: str, request: Request):
    host = urlparse(u).hostname
    if host not in POSTER_HOSTS:
        raise HTTPException(400, "host not allowed")
    u = normalise_poster_url(u)
    POSTER_DIR.mkdir(parents=True, exist_ok=True)
    cached_file = POSTER_DIR / (hashlib.sha1(u.encode()).hexdigest() + ".img")
    if cached_file.exists():
        _touch_poster(cached_file)  # keeps popular posters out of the eviction list
    else:
        try:
            resp = await request.app.state.http.get(u, timeout=15, follow_redirects=True)
            resp.raise_for_status()
        except Exception as exc:
            raise HTTPException(502, "poster fetch failed") from exc
        cached_file.write_bytes(resp.content)
    return FileResponse(
        cached_file,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )
