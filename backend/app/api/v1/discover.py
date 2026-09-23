"""Finding and adding titles: discovery, search, collections, quality options."""

import asyncio
import copy

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cache
from ...clients.overseerr import OverseerrClient
from ...clients.radarr import RadarrClient
from ...clients.readarr import ReadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_overseerr, get_radarr, get_readarr, get_sonarr
from ...schemas import (
    AddBookIn,
    AddMovieIn,
    AddSeriesIn,
    CollectionDetailOut,
    CollectionOut,
    OptionsOut,
    SearchResultOut,
)
from .posters import proxy_poster

router = APIRouter(tags=["discover"])

TMDB_IMG = "https://image.tmdb.org/t/p/w342"
WESTERN_LANGUAGES = {"en", "da", "sv", "no", "nb", "nn", "fi", "is"}
DISCOVER_TARGET = 48  # items to aim for after filtering
DISCOVER_MAX_PAGES = 8


async def _fetch_discover(overseerr: OverseerrClient, kind: str) -> list:
    """Accumulate popular items across pages, keeping only western-language
    titles, until we have DISCOVER_TARGET or run out of pages."""
    fetch = overseerr.discover_movies if kind == "movies" else overseerr.discover_tv
    out: list = []
    seen: set[int] = set()  # rankings shift between page fetches -> dupes
    for page in range(1, DISCOVER_MAX_PAGES + 1):
        results = await fetch(page)
        if not results:
            break
        for r in results:
            if r.get("id") in seen:
                continue
            if (r.get("originalLanguage") or "en") not in WESTERN_LANGUAGES:
                continue
            seen.add(r.get("id"))
            out.append(r)
        if len(out) >= DISCOVER_TARGET:
            break
    return out[:DISCOVER_TARGET]


def _poster(images: list | None) -> str | None:
    for img in images or []:
        if img.get("coverType") == "poster":
            return proxy_poster(img.get("remoteUrl") or img.get("url"))
    return None


async def _library_map(client, kind: str) -> dict[int, dict]:
    """Map remote id (tmdb/tvdb) -> library item summary, for in_library
    badges and in-place editing from the Add page."""
    key = f"library_map:{kind}"
    hit = cache.get(key, 60)
    if hit is not None:
        return hit
    items = await (client.movies() if kind == "movie" else client.series())
    id_field = "tmdbId" if kind == "movie" else "tvdbId"

    def downloaded(item: dict) -> bool:
        if kind == "movie":
            return item.get("hasFile", False)
        stats = item.get("statistics") or {}
        return stats.get("episodeCount", 0) > 0 and stats.get("percentOfEpisodes", 0) >= 100

    mapping = {
        i[id_field]: {
            "library_id": i["id"],
            "monitored": i.get("monitored", False),
            "quality_profile_id": i.get("qualityProfileId"),
            "has_file": downloaded(i),
        }
        for i in items
        if i.get(id_field)
    }
    cache.set(key, mapping)
    return mapping


@router.get("/discover/movies", response_model=list[SearchResultOut])
async def discover_movies(
    page: int = 1,
    overseerr: OverseerrClient = Depends(get_overseerr),
    radarr: RadarrClient = Depends(get_radarr),
) -> list[SearchResultOut]:
    key = "discover:movies:filtered"
    results = cache.get(key, 600)
    if results is None:
        results = await _fetch_discover(overseerr, "movies")
        cache.set(key, results)
    library = await _library_map(radarr, "movie")
    return [
        SearchResultOut(
            kind="movie",
            title=m.get("title", ""),
            year=int(m["releaseDate"][:4]) if m.get("releaseDate") else None,
            overview=m.get("overview"),
            remote_id=m.get("id", 0),
            poster=proxy_poster(f"{TMDB_IMG}{m['posterPath']}") if m.get("posterPath") else None,
            in_library=m.get("id") in library,
            tmdb_id=m.get("id"),
            **library.get(m.get("id"), {}),
        )
        for m in results
    ]


@router.get("/discover/series", response_model=list[SearchResultOut])
async def discover_series(
    page: int = 1,
    overseerr: OverseerrClient = Depends(get_overseerr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> list[SearchResultOut]:
    key = "discover:series:filtered"
    items = cache.get(key, 600)
    if items is None:
        results = await _fetch_discover(overseerr, "series")

        # Sonarr needs tvdb ids; resolve each TMDB id via Overseerr details
        # (cached individually — a page costs 20 calls once, then it's free).
        async def resolve(t: dict) -> dict | None:
            dkey = f"tvdetails:{t['id']}"
            details = cache.get(dkey, 86400)
            if details is None:
                try:
                    details = await overseerr.tv_details(t["id"])
                except Exception:  # noqa: BLE001 — drop items that fail to resolve
                    return None
                cache.set(dkey, details)
            external = details.get("externalIds") or {}
            tvdb = external.get("tvdbId")
            if not tvdb:
                return None
            return {
                "title": t.get("name", ""),
                "year": int(t["firstAirDate"][:4]) if t.get("firstAirDate") else None,
                "overview": t.get("overview"),
                "tvdb_id": tvdb,
                "imdb_id": external.get("imdbId"),
                "tmdb_id": t.get("id"),
                "poster": proxy_poster(f"{TMDB_IMG}{t['posterPath']}")
                if t.get("posterPath")
                else None,
            }

        resolved = await asyncio.gather(*(resolve(t) for t in results or []))
        items = [r for r in resolved if r]
        cache.set(key, items)
    library = await _library_map(sonarr, "series")
    return [
        SearchResultOut(
            kind="series",
            title=i["title"],
            year=i["year"],
            overview=i["overview"],
            remote_id=i["tvdb_id"],
            poster=i["poster"],
            in_library=i["tvdb_id"] in library,
            imdb_id=i.get("imdb_id"),
            tmdb_id=i.get("tmdb_id"),
            **library.get(i["tvdb_id"], {}),
        )
        for i in items
    ]


@router.get("/search/movies", response_model=list[SearchResultOut])
async def search_movies(
    q: str, radarr: RadarrClient = Depends(get_radarr)
) -> list[SearchResultOut]:
    results, library = await asyncio.gather(radarr.lookup(q), _library_map(radarr, "movie"))
    return [
        SearchResultOut(
            kind="movie",
            title=m.get("title", ""),
            year=m.get("year"),
            overview=m.get("overview"),
            remote_id=m.get("tmdbId", 0),
            poster=_poster(m.get("images")),
            in_library=m.get("tmdbId") in library,
            imdb_id=m.get("imdbId"),
            tmdb_id=m.get("tmdbId"),
            **library.get(m.get("tmdbId"), {}),
        )
        for m in results[:30]
    ]


async def _book_library_map(readarr: ReadarrClient) -> dict[int, dict]:
    """Numeric foreign book id -> library summary, for the in_library badge on
    book search results. Readarr's own foreign ids are numeric strings."""
    key = "library_map:book"
    hit = cache.get(key, 60)
    if hit is not None:
        return hit
    out: dict[int, dict] = {}
    for b in await readarr.books():
        fid = _numeric(b.get("foreignBookId"))
        if fid is None:
            continue
        stats = b.get("statistics") or {}
        out[fid] = {
            "library_id": b["id"],
            "monitored": b.get("monitored", False),
            "has_file": (stats.get("bookFileCount") or 0) > 0,
        }
    cache.set(key, out)
    return out


def _numeric(value: str | None) -> int | None:
    return int(value) if value and value.isdigit() else None


def book_search_result(entry: dict, library: dict[int, dict]) -> SearchResultOut | None:
    """One combined-search entry as a search result; author-only entries give
    None. The monitored edition is the one Readarr would add."""
    book = entry.get("book")
    if not book:
        return None
    author = book.get("author") or {}
    edition = (
        next((e for e in book.get("editions") or [] if e.get("monitored")), None)
        or ((book.get("editions") or [None])[0])
    )
    fid = _numeric(book.get("foreignBookId"))
    release = book.get("releaseDate") or ""
    return SearchResultOut(
        kind="book",
        title=book.get("title", ""),
        year=int(release[:4]) if release[:4].isdigit() else None,
        overview=book.get("overview") or (edition or {}).get("overview"),
        remote_id=fid or 0,
        poster=_cover(book),
        in_library=fid in library,
        foreign_id=book.get("foreignBookId"),
        foreign_edition_id=(edition or {}).get("foreignEditionId") or book.get("foreignEditionId"),
        author=author.get("authorName"),
        editions=[
            edition_choice(e) for e in book.get("editions") or [] if e.get("foreignEditionId")
        ],
        **library.get(fid or -1, {}),
    )


def edition_choice(e: dict) -> dict:
    release = e.get("releaseDate") or ""
    return {
        "foreign_edition_id": e["foreignEditionId"],
        "title": e.get("title"),
        "format": e.get("format"),
        "language": e.get("language"),
        "year": int(release[:4]) if release[:4].isdigit() else None,
        "page_count": e.get("pageCount") or None,
        "monitored": bool(e.get("monitored")),
    }


def _cover(book: dict) -> str | None:
    if book.get("remoteCover"):
        return proxy_poster(book["remoteCover"])
    for img in book.get("images") or []:
        if img.get("coverType") in ("cover", "poster"):
            return proxy_poster(img.get("remoteUrl") or img.get("url"))
    return None


@router.get("/search/books", response_model=list[SearchResultOut])
async def search_books(
    q: str, readarr: ReadarrClient = Depends(get_readarr)
) -> list[SearchResultOut]:
    results, library = await asyncio.gather(readarr.search(q), _book_library_map(readarr))
    out = [book_search_result(entry, library) for entry in results]
    return [r for r in out if r is not None][:30]


@router.get("/search/series", response_model=list[SearchResultOut])
async def search_series(
    q: str, sonarr: SonarrClient = Depends(get_sonarr)
) -> list[SearchResultOut]:
    results, library = await asyncio.gather(sonarr.lookup(q), _library_map(sonarr, "series"))
    return [
        SearchResultOut(
            kind="series",
            title=s.get("title", ""),
            year=s.get("year"),
            overview=s.get("overview"),
            remote_id=s.get("tvdbId", 0),
            poster=_poster(s.get("images")),
            in_library=s.get("tvdbId") in library,
            imdb_id=s.get("imdbId"),
            **library.get(s.get("tvdbId"), {}),
        )
        for s in results[:30]
    ]


@router.get("/collections", response_model=list[CollectionOut])
async def collections(radarr: RadarrClient = Depends(get_radarr)) -> list[CollectionOut]:
    cols, library = await asyncio.gather(radarr.collections(), _library_map(radarr, "movie"))
    out = []
    for c in cols:
        movies = c.get("movies", [])
        out.append(
            CollectionOut(
                id=c["id"],
                title=c.get("title"),
                monitored=c.get("monitored", False),
                movie_count=len(movies),
                missing_count=sum(1 for m in movies if m.get("tmdbId") not in library),
                poster=_poster(c.get("images")),
            )
        )
    return sorted(out, key=lambda c: (c.title or "").lower())


@router.get("/collections/{collection_id}", response_model=CollectionDetailOut)
async def collection_detail(
    collection_id: int, radarr: RadarrClient = Depends(get_radarr)
) -> CollectionDetailOut:
    cols, library = await asyncio.gather(radarr.collections(), _library_map(radarr, "movie"))
    full = next((c for c in cols if c["id"] == collection_id), None)
    if full is None:
        raise HTTPException(404, "collection not found")
    movies = [
        SearchResultOut(
            kind="movie",
            title=m.get("title", ""),
            year=m.get("year"),
            overview=m.get("overview"),
            remote_id=m.get("tmdbId", 0),
            poster=_poster(m.get("images")),
            in_library=m.get("tmdbId") in library,
            imdb_id=m.get("imdbId"),
            tmdb_id=m.get("tmdbId"),
            **library.get(m.get("tmdbId"), {}),
        )
        for m in full.get("movies", [])
    ]
    return CollectionDetailOut(
        id=full["id"],
        title=full.get("title"),
        monitored=full.get("monitored", False),
        overview=full.get("overview"),
        poster=_poster(full.get("images")),
        movies=movies,
    )


@router.patch("/collections/{collection_id}")
async def toggle_collection(
    collection_id: int, monitored: bool, radarr: RadarrClient = Depends(get_radarr)
) -> dict:
    cols = await radarr.collections()
    full = next((c for c in cols if c["id"] == collection_id), None)
    if full is None:
        raise HTTPException(404, "collection not found")
    full["monitored"] = monitored
    updated = await radarr.update_collection(collection_id, full)
    return {"id": updated["id"], "monitored": updated.get("monitored", False)}


@router.get("/options/{app}", response_model=OptionsOut)
async def options(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
    readarr: ReadarrClient = Depends(get_readarr),
):
    clients = {"radarr": radarr, "sonarr": sonarr, "readarr": readarr}
    if app not in clients:
        raise HTTPException(404, f"unknown app {app!r}")
    client = clients[app]
    key = f"options:{app}"
    hit = cache.get(key, 300)
    if hit is not None:
        return hit
    profiles, folders = await asyncio.gather(client.quality_profiles(), client.root_folders())
    data = {
        "quality_profiles": [{"id": p["id"], "name": p["name"]} for p in profiles],
        "root_folders": [
            {"id": f["id"], "path": f["path"], "free_space": f.get("freeSpace")} for f in folders
        ],
    }
    if app == "readarr":
        # Readarr matches authors against a metadata profile as well.
        data["metadata_profiles"] = [
            {"id": p["id"], "name": p["name"]} for p in await readarr.metadata_profiles()
        ]
    cache.set(key, data)
    return data


@router.post("/movies", status_code=201)
async def add_movie(body: AddMovieIn, radarr: RadarrClient = Depends(get_radarr)) -> dict:
    payload = {
        "tmdbId": body.tmdb_id,
        "title": body.title,
        "qualityProfileId": body.quality_profile_id,
        "rootFolderPath": body.root_folder_path,
        "monitored": body.monitored,
        "addOptions": {"searchForMovie": body.search_now},
    }
    created = await radarr.add_movie(payload)
    cache.set("library_map:movie", None)
    return {"id": created.get("id"), "title": created.get("title")}


@router.post("/series", status_code=201)
async def add_series(body: AddSeriesIn, sonarr: SonarrClient = Depends(get_sonarr)) -> dict:
    payload = {
        "tvdbId": body.tvdb_id,
        "title": body.title,
        "qualityProfileId": body.quality_profile_id,
        "rootFolderPath": body.root_folder_path,
        "monitored": body.monitored,
        "seasonFolder": body.season_folder,
        "addOptions": {"searchForMissingEpisodes": body.search_now},
    }
    created = await sonarr.add_series(payload)
    cache.set("library_map:series", None)
    return {"id": created.get("id"), "title": created.get("title")}


def new_book_payload(book: dict, body: AddBookIn, metadata_profile_id: int | None) -> dict:
    """Shape a combined-search book into what POST /book wants, the way
    Readarr's own Add dialog does: a new author gets the profiles, the root
    folder and "monitor just this book"; an existing author is left alone."""
    payload = copy.deepcopy(book)
    author = payload.get("author") or {}
    if not author.get("id"):
        author.update(
            {
                "monitored": True,
                "monitorNewItems": "none",
                "qualityProfileId": body.quality_profile_id,
                "metadataProfileId": metadata_profile_id,
                "rootFolderPath": body.root_folder_path,
                "tags": [],
                "addOptions": {
                    "searchForMissingBooks": False,
                    "booksToMonitor": [payload.get("foreignBookId")],
                },
            }
        )
    payload["author"] = author
    payload["monitored"] = body.monitored
    payload["addOptions"] = {"searchForNewBook": body.search_now}
    # The picked edition is the one Readarr monitors (and names the book by);
    # without a pick, Readarr's own choice stands.
    if body.foreign_edition_id and any(
        e.get("foreignEditionId") == body.foreign_edition_id for e in payload.get("editions") or []
    ):
        for e in payload["editions"]:
            e["monitored"] = e.get("foreignEditionId") == body.foreign_edition_id
        payload["foreignEditionId"] = body.foreign_edition_id
    return payload


@router.post("/books", status_code=201)
async def add_book(body: AddBookIn, readarr: ReadarrClient = Depends(get_readarr)) -> dict:
    # Look the book up again by edition: the search result only carried ids,
    # and Readarr needs the whole resource with author and editions.
    term = f"edition:{body.foreign_edition_id}" if body.foreign_edition_id else body.title
    entries = await readarr.search(term)
    book = next(
        (
            e["book"]
            for e in entries
            if e.get("book") and e["book"].get("foreignBookId") == body.foreign_book_id
        ),
        None,
    )
    if book is None:
        raise HTTPException(404, "Readarr no longer finds that book")
    metadata_profile_id = body.metadata_profile_id
    if metadata_profile_id is None and not (book.get("author") or {}).get("id"):
        profiles = await readarr.metadata_profiles()
        metadata_profile_id = profiles[0]["id"] if profiles else None
    created = await readarr.add_book(new_book_payload(book, body, metadata_profile_id))
    cache.set("library_map:book", None)
    cache.set("readarr:authors", None)
    return {"id": created.get("id"), "title": created.get("title")}
