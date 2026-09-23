"""The book library: listing, detail, editing, removal.

Readarr hangs books off authors — the quality profile is the author's, a
book has only its own monitored flag and editions — so every row carries the
author's name and profile, and a profile change goes to the author.
"""

import asyncio

from fastapi import APIRouter, Depends

from ...cache import cache, cached
from ...clients.readarr import ReadarrClient
from ...deps import get_readarr
from ...schemas import (
    BookDetailOut,
    BookEditionOut,
    HistoryEventOut,
    LibraryBookOut,
    LibraryUpdateIn,
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
        "quality_profile_id": author.get("qualityProfileId"),
        "poster": book_cover(book.get("images")),
        "page_count": book.get("pageCount") or None,
        "foreign_book_id": book.get("foreignBookId"),
    }


@router.get("/library/books", response_model=list[LibraryBookOut])
async def library_books(readarr: ReadarrClient = Depends(get_readarr)) -> list[dict]:
    books, authors = await asyncio.gather(readarr.books(), author_map(readarr))
    rows = [book_row(b, authors) for b in books]
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
    stats = book.get("statistics") or {}
    ratings = book.get("ratings") or {}
    goodreads = next(
        (link.get("url") for link in book.get("links") or [] if "goodreads" in (link.get("name") or "").lower()),
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
