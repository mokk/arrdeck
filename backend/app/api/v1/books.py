"""The book library: listing, detail, editing, removal.

Readarr hangs books off authors — the quality profile is the author's, a
book has only its own monitored flag and editions — so every row carries the
author's name and profile, and a profile change goes to the author.
"""

import asyncio
import os
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from ...cache import cache, cached
from ...clients.readarr import ReadarrClient
from ...deps import get_readarr
from ...schemas import (
    AuthorDetailOut,
    AuthorOut,
    AuthorUpdateIn,
    BookDetailOut,
    BookEditionOut,
    BookFileOut,
    BookSeriesOut,
    HistoryEventOut,
    LibraryBookOut,
    LibraryUpdateIn,
    ShelfSeriesOut,
)
from .dashboard import EVENT_LABELS
from .posters import proxy_poster

router = APIRouter(tags=["library"])


def book_cover(images: list | None) -> str | None:
    """Readarr calls the poster a cover."""
    for img in images or []:
        if img.get("coverType") in ("cover", "poster"):
            return proxy_poster(img.get("remoteUrl") or img.get("url"))
    return None


def year_of(date: str | None) -> int | None:
    if not date or len(date) < 4 or not date[:4].isdigit():
        return None
    return int(date[:4])


async def author_map(readarr: ReadarrClient) -> dict[int, dict]:
    """Authors by id, cached briefly: the list endpoint needs one name per
    book and Readarr's book rows do not embed the author."""

    async def call() -> dict[int, dict]:
        return {a["id"]: a for a in await readarr.authors()}

    return await cached("readarr:authors", 60, call)


def book_row(book: dict, authors: dict[int, dict]) -> dict:
    author = authors.get(book.get("authorId")) or {}
    stats = book.get("statistics") or {}
    return {
        "id": book["id"],
        "title": book.get("title"),
        "author": author.get("authorName"),
        "author_id": book.get("authorId"),
        "year": year_of(book.get("releaseDate")),
        "series_title": book.get("seriesTitle") or None,
        "monitored": book.get("monitored", False),
        "has_file": (stats.get("bookFileCount") or 0) > 0,
        "size_on_disk": stats.get("sizeOnDisk", 0),
        "added": book.get("added"),
        "quality_profile_id": author.get("qualityProfileId"),
        "poster": book_cover(book.get("images")),
        "page_count": book.get("pageCount") or None,
        "foreign_book_id": book.get("foreignBookId"),
        "genres": book.get("genres") or [],
        "rating": (book.get("ratings") or {}).get("value") or None,
    }


DOWNLOAD_FEATURE = "bookFileDownload"

# Headers the fork sets that the client needs verbatim: the type, the length,
# the range answer. Everything else (server, cookies…) stays with Readarr.
PASSTHROUGH_HEADERS = (
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "last-modified",
    "etag",
)


async def fork_features(readarr: ReadarrClient) -> list[str]:
    """What the connected Readarr can do beyond upstream; empty when it is an
    upstream build or unreachable. Cached: it is asked on every book page."""

    async def call() -> list[str]:
        try:
            return await readarr.fork_features()
        except Exception:  # noqa: BLE001 — a missing feature list is "no features"
            return []

    return await cached("readarr:fork_features", 300, call)


def file_row(bookfile: dict) -> dict:
    quality = ((bookfile.get("quality") or {}).get("quality") or {}).get("name")
    path = bookfile.get("path") or ""
    return {
        "id": bookfile["id"],
        "name": os.path.basename(path) or None,
        "size": bookfile.get("size") or 0,
        "format": quality,
    }


def content_disposition(filename: str) -> str:
    """An attachment header that survives non-ASCII titles: the plain
    `filename` is the ASCII fallback, `filename*` carries the real name."""
    fallback = filename.encode("ascii", "replace").decode("ascii").replace('"', "'")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


def in_library(row: dict) -> bool:
    """Adding an author makes Readarr list their whole bibliography, unmonitored.
    The library is what you asked for or already have: monitored, or on disk."""
    return bool(row.get("monitored")) or bool(row.get("has_file"))


@router.get("/library/books", response_model=list[LibraryBookOut])
async def library_books(
    readarr: ReadarrClient = Depends(get_readarr),
    all: bool = False,
) -> list[dict]:
    books, authors = await asyncio.gather(readarr.books(), author_map(readarr))
    rows = [book_row(b, authors) for b in books]
    if not all:
        rows = [r for r in rows if in_library(r)]
    return sorted(rows, key=lambda r: ((r["author"] or "").lower(), (r["title"] or "").lower()))


@router.get("/library/books/{book_id}/detail", response_model=BookDetailOut)
async def book_detail(book_id: int, readarr: ReadarrClient = Depends(get_readarr)) -> BookDetailOut:
    book = await readarr.get_book(book_id)
    author: dict = {}
    if book.get("authorId"):
        try:
            author = await readarr.get_author(book["authorId"])
        except Exception:  # noqa: BLE001 — the author is decoration on a book page
            author = {}
    try:
        history = await readarr.history_book(book_id)
    except Exception:  # noqa: BLE001 — history is decoration
        history = []
    try:
        files = await readarr.book_files(book_id)
    except Exception:  # noqa: BLE001 — the file list is decoration too
        files = []
    features = await fork_features(readarr)
    try:
        series = await author_series(readarr, book.get("authorId")) if book.get("authorId") else []
    except Exception:  # noqa: BLE001 — series are decoration
        series = []
    stats = book.get("statistics") or {}
    ratings = book.get("ratings") or {}
    goodreads = next(
        (
            link.get("url")
            for link in book.get("links") or []
            if "goodreads" in (link.get("name") or "").lower()
        ),
        None,
    )
    return BookDetailOut(
        id=book["id"],
        title=book.get("title"),
        author=author.get("authorName"),
        author_id=book.get("authorId"),
        overview=book.get("overview"),
        poster=book_cover(book.get("images")),
        release_date=book.get("releaseDate"),
        year=year_of(book.get("releaseDate")),
        page_count=book.get("pageCount") or None,
        genres=book.get("genres") or [],
        series_title=book.get("seriesTitle") or None,
        monitored=book.get("monitored", False),
        has_file=(stats.get("bookFileCount") or 0) > 0,
        size_on_disk=stats.get("sizeOnDisk", 0),
        quality_profile_id=author.get("qualityProfileId"),
        metadata_profile_id=author.get("metadataProfileId"),
        rating=ratings.get("value"),
        rating_votes=ratings.get("votes"),
        goodreads_url=goodreads,
        editions=[
            BookEditionOut(
                title=e.get("title"),
                format=e.get("format"),
                is_ebook=e.get("isEbook"),
                monitored=e.get("monitored", False),
                page_count=e.get("pageCount") or None,
            )
            for e in book.get("editions") or []
        ],
        files=[BookFileOut(**file_row(f)) for f in files],
        downloadable=DOWNLOAD_FEATURE in features and bool(files),
        series=[BookSeriesOut(**x) for x in series_containing(book_id, series)],
        history=[
            HistoryEventOut(
                type=EVENT_LABELS.get(h.get("eventType", ""), h.get("eventType", "")),
                date=h.get("date", ""),
            )
            for h in history[:12]
        ],
    )


@router.patch("/library/books/{book_id}")
async def update_book(
    book_id: int, body: LibraryUpdateIn, readarr: ReadarrClient = Depends(get_readarr)
) -> dict:
    book = await readarr.get_book(book_id)
    if body.monitored is not None:
        book["monitored"] = body.monitored
        book = await readarr.update_book(book_id, book)
    profile = None
    if body.quality_profile_id is not None and book.get("authorId"):
        # Quality is the author's setting; changing it here changes every book of theirs.
        author = await readarr.get_author(book["authorId"])
        author["qualityProfileId"] = body.quality_profile_id
        updated = await readarr.update_author(book["authorId"], author)
        profile = updated.get("qualityProfileId")
        cache.set("readarr:authors", None)
    return {
        "id": book["id"],
        "monitored": book.get("monitored", False),
        "quality_profile_id": profile,
    }


@router.delete("/library/books/{book_id}", status_code=204)
async def delete_book(
    book_id: int, delete_files: bool = False, readarr: ReadarrClient = Depends(get_readarr)
) -> None:
    await readarr.delete_book(book_id, delete_files)


@router.get(
    "/library/books/{book_id}/files/{file_id}",
    response_class=StreamingResponse,
    responses={
        200: {
            "content": {
                "application/octet-stream": {"schema": {"type": "string", "format": "binary"}}
            }
        }
    },
)
async def download_book_file(
    book_id: int, file_id: int, request: Request, readarr: ReadarrClient = Depends(get_readarr)
) -> StreamingResponse:
    """Proxy a book file from our Readarr fork, which serves it from its own
    library mount — arrdeck never touches the files itself. Range requests
    pass through so a client can resume."""
    if DOWNLOAD_FEATURE not in await fork_features(readarr):
        raise HTTPException(404, "this Readarr cannot serve files")
    files = await readarr.book_files(book_id)
    match = next((f for f in files if f.get("id") == file_id), None)
    if match is None:
        raise HTTPException(404, "no such file on this book")
    upstream = await readarr.open_book_file(file_id, request.headers.get("range"))
    if upstream.status_code >= 400:
        await upstream.aclose()
        raise HTTPException(
            upstream.status_code if upstream.status_code in (404, 416) else 502,
            f"Readarr answered HTTP {upstream.status_code}",
        )
    headers = {k: upstream.headers[k] for k in PASSTHROUGH_HEADERS if k in upstream.headers}
    headers["content-disposition"] = content_disposition(
        os.path.basename(match.get("path") or "") or f"book-{book_id}-{file_id}"
    )
    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=headers,
        background=BackgroundTask(upstream.aclose),
    )


# ---------------------------------------------------------------- authors


def author_row(author: dict) -> dict:
    stats = author.get("statistics") or {}
    return {
        "id": author["id"],
        "name": author.get("authorName"),
        "monitored": author.get("monitored", False),
        "monitor_new_items": author.get("monitorNewItems"),
        "poster": book_cover(author.get("images")),
        "quality_profile_id": author.get("qualityProfileId"),
        "metadata_profile_id": author.get("metadataProfileId"),
        "book_count": stats.get("bookCount") or 0,
        "available_count": stats.get("availableBookCount") or 0,
        "size_on_disk": stats.get("sizeOnDisk") or 0,
    }


def series_rows(series: list[dict], books_by_id: dict[int, dict]) -> list[dict]:
    """Readarr's series with their (bookId, position) links, joined with the
    author's books so each entry says what you have. Sorted by position."""
    out = []
    for s in series:
        entries = []
        for link in s.get("links") or []:
            book = books_by_id.get(link.get("bookId"))
            if book is None:
                continue
            stats = book.get("statistics") or {}
            entries.append(
                {
                    "book_id": link["bookId"],
                    "position": link.get("position"),
                    "title": book.get("title"),
                    "monitored": book.get("monitored", False),
                    "has_file": (stats.get("bookFileCount") or 0) > 0,
                    "poster": book_cover(book.get("images")),
                    "year": year_of(book.get("releaseDate")),
                    "_order": link.get("seriesPosition") or 0,
                }
            )
        entries.sort(key=lambda e: e["_order"])
        for e in entries:
            e.pop("_order")
        out.append({"id": s["id"], "title": s.get("title"), "books": entries})
    return out


def series_containing(book_id: int, series: list[dict]) -> list[dict]:
    return [s for s in series if any(b["book_id"] == book_id for b in s["books"])]


async def author_series(readarr: ReadarrClient, author_id: int) -> list[dict]:
    series, books = await asyncio.gather(readarr.series(author_id), readarr.books())
    books_by_id = {b["id"]: b for b in books if b.get("authorId") == author_id}
    return series_rows(series, books_by_id)


# Series lists change when an author is refreshed, which is rare; the shelf asks
# for every library author at once, so each answer is kept for an hour.
SHELF_SERIES_TTL = 3600
SHELF_CONCURRENCY = 4


def shelf_rows(
    series_by_author: dict[int, list[dict]], books: list[dict], authors: dict[int, dict]
) -> list[dict]:
    """Every series with a book in the library, holding all its books so the
    missing ones show as gaps. Sorted by author, then series title."""
    books_by_id = {b["id"]: b for b in books}
    out = []
    for author_id, series in series_by_author.items():
        name = (authors.get(author_id) or {}).get("authorName")
        for row in series_rows(series, books_by_id):
            if not any(in_library(b) for b in row["books"]):
                continue
            out.append({**row, "author": name, "author_id": author_id})
    return sorted(out, key=lambda r: ((r["author"] or "").lower(), (r["title"] or "").lower()))


@router.get("/library/books/shelf", response_model=list[ShelfSeriesOut])
async def book_shelf(readarr: ReadarrClient = Depends(get_readarr)) -> list[dict]:
    books, authors = await asyncio.gather(readarr.books(), author_map(readarr))
    rows = [book_row(b, authors) for b in books]
    author_ids = sorted({r["author_id"] for r in rows if r["author_id"] and in_library(r)})
    gate = asyncio.Semaphore(SHELF_CONCURRENCY)

    async def one(author_id: int) -> list[dict]:
        async with gate:
            try:
                return await cached(
                    f"readarr:series:{author_id}",
                    SHELF_SERIES_TTL,
                    lambda: readarr.series(author_id),
                )
            except Exception:  # noqa: BLE001 — one author's series must not sink the shelf
                return []

    series = await asyncio.gather(*(one(a) for a in author_ids))
    return shelf_rows(dict(zip(author_ids, series, strict=True)), books, authors)


@router.get("/library/authors", response_model=list[AuthorOut])
async def library_authors(readarr: ReadarrClient = Depends(get_readarr)) -> list[dict]:
    authors = await readarr.authors()
    return sorted((author_row(a) for a in authors), key=lambda a: (a["name"] or "").lower())


@router.get("/library/authors/{author_id}", response_model=AuthorDetailOut)
async def author_detail(author_id: int, readarr: ReadarrClient = Depends(get_readarr)) -> dict:
    author, books, series = await asyncio.gather(
        readarr.get_author(author_id), readarr.books(), readarr.series(author_id)
    )
    mine = [b for b in books if b.get("authorId") == author_id]
    row = author_row(author)
    row["overview"] = author.get("overview")
    row["books"] = sorted(
        (book_row(b, {author_id: author}) for b in mine),
        key=lambda b: ((b.get("year") or 0), (b.get("title") or "").lower()),
    )
    row["series"] = series_rows(series, {b["id"]: b for b in mine})
    return row


@router.patch("/library/authors/{author_id}", response_model=AuthorOut)
async def update_author(
    author_id: int, body: AuthorUpdateIn, readarr: ReadarrClient = Depends(get_readarr)
) -> dict:
    author = await readarr.get_author(author_id)
    if body.monitored is not None:
        author["monitored"] = body.monitored
    if body.monitor_new_items is not None:
        author["monitorNewItems"] = body.monitor_new_items
    if body.quality_profile_id is not None:
        author["qualityProfileId"] = body.quality_profile_id
    if body.metadata_profile_id is not None:
        author["metadataProfileId"] = body.metadata_profile_id
    updated = await readarr.update_author(author_id, author)
    cache.set("readarr:authors", None)
    cache.set("library_map:book", None)
    return author_row(updated)
