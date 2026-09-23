"""An OPDS 1.2 catalogue of the books on disk, for e-reader apps.

KOReader, Apple Books' OPDS-capable cousins, Moon+ Reader and the like browse
this and download straight from it. Most of them cannot sign in the way
arrdeck does (passkeys), so the feed lives outside /api under a secret token
in its path — the way the arrs' webhooks do — and the token can be replaced
or switched off in Settings. Files stream through the Readarr fork exactly as
the app's download button does; nothing is mounted into arrdeck.
"""

import asyncio
import hmac
import mimetypes
import os
import secrets
from datetime import UTC, datetime
from urllib.parse import quote, urlparse
from xml.sax.saxutils import escape, quoteattr

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

from .api.v1.books import (
    DOWNLOAD_FEATURE,
    author_map,
    book_cover,
    fork_features,
    stream_book_file,
)
from .api.v1.posters import POSTER_HOSTS
from .api.v1.posters import poster as proxy_image
from .cache import cached
from .clients.readarr import ReadarrClient
from .deps import get_readarr

router = APIRouter(include_in_schema=False)

TOKEN_KEY = "opds.token"
FILES_TTL = 300
RECENT_LIMIT = 50
ACQUISITION = "application/atom+xml;profile=opds-catalog;kind=acquisition"
NAVIGATION = "application/atom+xml;profile=opds-catalog;kind=navigation"
# Readarr's quality names double as formats; fall back on the extension
BOOK_TYPES = {
    ".epub": "application/epub+zip",
    ".mobi": "application/x-mobipocket-ebook",
    ".azw3": "application/vnd.amazon.ebook",
    ".azw": "application/vnd.amazon.ebook",
    ".pdf": "application/pdf",
    ".cbz": "application/vnd.comicbook+zip",
    ".cbr": "application/vnd.comicbook-rar",
    ".fb2": "application/x-fictionbook+xml",
}


def new_token() -> str:
    return secrets.token_urlsafe(24)


def current_token(db) -> str | None:
    return db.kv_get(TOKEN_KEY) or None


def check_token(request: Request, token: str) -> None:
    expected = current_token(request.app.state.db)
    # constant-time, and a disabled feed looks the same as a wrong token
    if not expected or not hmac.compare_digest(expected, token):
        raise HTTPException(404, "not found")


def book_type(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return BOOK_TYPES.get(ext) or mimetypes.guess_type(path)[0] or "application/octet-stream"


async def library(readarr: ReadarrClient) -> dict:
    """Books that have files, with their files and authors. One file call per
    author rather than per book; cached a few minutes."""

    async def build() -> dict:
        books, authors = await asyncio.gather(readarr.books(), author_map(readarr))
        on_disk = [b for b in books if ((b.get("statistics") or {}).get("bookFileCount") or 0) > 0]
        author_ids = sorted({b.get("authorId") for b in on_disk if b.get("authorId")})
        per_author = await asyncio.gather(
            *(readarr.author_book_files(a) for a in author_ids), return_exceptions=True
        )
        files: dict[int, list[dict]] = {}
        for result in per_author:
            if isinstance(result, BaseException):
                continue
            for f in result:
                files.setdefault(f.get("bookId"), []).append(f)
        return {
            "books": [b for b in on_disk if files.get(b["id"])],
            "files": files,
            "authors": authors,
        }

    return await cached("opds:library", FILES_TTL, build)


def iso(value: str | None) -> str:
    if value:
        return value if value.endswith("Z") or "+" in value else value + "Z"
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def feed(base: str, path: str, title: str, kind: str, entries: list[str]) -> Response:
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog"'
        ' xmlns:dc="http://purl.org/dc/terms/">\n'
        f"  <id>urn:arrdeck:opds:{escape(path or 'root')}</id>\n"
        f"  <title>{escape(title)}</title>\n"
        f"  <updated>{iso(None)}</updated>\n"
        "  <author><name>arrdeck</name></author>\n"
        f'  <link rel="self" href={quoteattr(f"{base}/{path}".rstrip("/"))} type="{kind}"/>\n'
        f'  <link rel="start" href={quoteattr(base)} type="{NAVIGATION}"/>\n'
        f'  <link rel="search" href={quoteattr(f"{base}/opensearch.xml")}'
        ' type="application/opensearchdescription+xml"/>\n' + "".join(entries) + "</feed>\n"
    )
    return Response(body, media_type=f"{kind};charset=utf-8")


def nav_entry(base: str, path: str, title: str, content: str) -> str:
    return (
        "  <entry>\n"
        f"    <id>urn:arrdeck:opds:{escape(path)}</id>\n"
        f"    <title>{escape(title)}</title>\n"
        f"    <updated>{iso(None)}</updated>\n"
        f'    <content type="text">{escape(content)}</content>\n'
        f'    <link rel="subsection" href={quoteattr(f"{base}/{path}")} type="{ACQUISITION}"/>\n'
        "  </entry>\n"
    )


def book_entry(base: str, book: dict, files: list[dict], authors: dict) -> str:
    author = (authors.get(book.get("authorId")) or {}).get("authorName") or ""
    links = []
    if book_cover(book.get("images")):
        cover = f"{base}/cover/{book['id']}"
        links.append(
            f'    <link rel="http://opds-spec.org/image" href={quoteattr(cover)} type="image/jpeg"/>\n'
        )
        links.append(
            f'    <link rel="http://opds-spec.org/image/thumbnail" href={quoteattr(cover)} type="image/jpeg"/>\n'
        )
    for f in files:
        path = f.get("path") or ""
        href = f"{base}/download/{book['id']}/{f['id']}"
        links.append(
            f'    <link rel="http://opds-spec.org/acquisition" href={quoteattr(href)}'
            f' type="{book_type(path)}" title={quoteattr(os.path.basename(path))}/>\n'
        )
    summary = book.get("overview") or ""
    return (
        "  <entry>\n"
        f"    <id>urn:arrdeck:book:{book['id']}</id>\n"
        f"    <title>{escape(book.get('title') or '')}</title>\n"
        f"    <author><name>{escape(author)}</name></author>\n"
        f"    <updated>{iso(book.get('added'))}</updated>\n"
        + (
            f"    <dc:issued>{escape(book['releaseDate'][:10])}</dc:issued>\n"
            if book.get("releaseDate")
            else ""
        )
        + (f'    <summary type="text">{escape(summary[:1000])}</summary>\n' if summary else "")
        + "".join(links)
        + "  </entry>\n"
    )


def base_url(request: Request, token: str) -> str:
    # relative to the host the reader used, so a LAN address and a VPN one both work
    return f"{str(request.base_url).rstrip('/')}/opds/{quote(token)}"


async def gate(request: Request, token: str, readarr: ReadarrClient) -> str:
    check_token(request, token)
    if DOWNLOAD_FEATURE not in await fork_features(readarr):
        raise HTTPException(404, "this Readarr cannot serve files")
    return base_url(request, token)


@router.get("/opds/{token}")
async def root(token: str, request: Request, readarr: ReadarrClient = Depends(get_readarr)):
    base = await gate(request, token, readarr)
    data = await library(readarr)
    entries = [
        nav_entry(base, "recent", "Recently added", f"The newest of {len(data['books'])} books"),
        nav_entry(base, "authors", "Authors", "Every author with a book on disk"),
    ]
    reading = reading_ids(request)
    if any(b["id"] in reading for b in data["books"]):
        entries.insert(
            0, nav_entry(base, "reading", "Currently reading", "What you are reading now")
        )
    return feed(base, "", "arrdeck", NAVIGATION, entries)


def reading_ids(request: Request) -> set[int]:
    from .api.v1.reading import load

    return {int(k) for k, v in load(request.app.state.db).items() if v.get("status") == "reading"}


def book_feed(base: str, path: str, title: str, books: list[dict], data: dict) -> Response:
    entries = [book_entry(base, b, data["files"].get(b["id"], []), data["authors"]) for b in books]
    return feed(base, path, title, ACQUISITION, entries)


@router.get("/opds/{token}/recent")
async def recent(token: str, request: Request, readarr: ReadarrClient = Depends(get_readarr)):
    base = await gate(request, token, readarr)
    data = await library(readarr)
    books = sorted(data["books"], key=lambda b: b.get("added") or "", reverse=True)[:RECENT_LIMIT]
    return book_feed(base, "recent", "Recently added", books, data)


@router.get("/opds/{token}/reading")
async def reading(token: str, request: Request, readarr: ReadarrClient = Depends(get_readarr)):
    base = await gate(request, token, readarr)
    data = await library(readarr)
    ids = reading_ids(request)
    return book_feed(
        base, "reading", "Currently reading", [b for b in data["books"] if b["id"] in ids], data
    )


@router.get("/opds/{token}/authors")
async def authors(token: str, request: Request, readarr: ReadarrClient = Depends(get_readarr)):
    base = await gate(request, token, readarr)
    data = await library(readarr)
    counts: dict[int, int] = {}
    for b in data["books"]:
        counts[b.get("authorId")] = counts.get(b.get("authorId"), 0) + 1
    names = {a: (data["authors"].get(a) or {}).get("authorName") or "?" for a in counts}
    entries = [
        nav_entry(
            base, f"authors/{a}", names[a], f"{counts[a]} book{'s' if counts[a] != 1 else ''}"
        )
        for a in sorted(counts, key=lambda a: names[a].lower())
    ]
    return feed(base, "authors", "Authors", NAVIGATION, entries)


@router.get("/opds/{token}/authors/{author_id}")
async def author(
    token: str, author_id: int, request: Request, readarr: ReadarrClient = Depends(get_readarr)
):
    base = await gate(request, token, readarr)
    data = await library(readarr)
    books = sorted(
        (b for b in data["books"] if b.get("authorId") == author_id),
        key=lambda b: b.get("releaseDate") or "",
    )
    name = (data["authors"].get(author_id) or {}).get("authorName") or "Author"
    return book_feed(base, f"authors/{author_id}", name, books, data)


@router.get("/opds/{token}/search")
async def search(
    token: str, request: Request, q: str = "", readarr: ReadarrClient = Depends(get_readarr)
):
    base = await gate(request, token, readarr)
    data = await library(readarr)
    needle = q.strip().lower()

    def hit(b: dict) -> bool:
        author = (data["authors"].get(b.get("authorId")) or {}).get("authorName") or ""
        return needle in (b.get("title") or "").lower() or needle in author.lower()

    books = [b for b in data["books"] if needle and hit(b)]
    return book_feed(base, f"search?q={quote(q)}", f"Search: {q}", books, data)


@router.get("/opds/{token}/opensearch.xml")
async def opensearch(token: str, request: Request, readarr: ReadarrClient = Depends(get_readarr)):
    base = await gate(request, token, readarr)
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">\n'
        "  <ShortName>arrdeck</ShortName>\n"
        "  <Description>Search the books on disk</Description>\n"
        f'  <Url type="{ACQUISITION}" template={quoteattr(f"{base}/search?q={{searchTerms}}")}/>\n'
        "</OpenSearchDescription>\n"
    )
    return Response(body, media_type="application/opensearchdescription+xml")


@router.get("/opds/{token}/cover/{book_id}")
async def cover(
    token: str, book_id: int, request: Request, readarr: ReadarrClient = Depends(get_readarr)
):
    check_token(request, token)
    data = await library(readarr)
    book = next((b for b in data["books"] if b["id"] == book_id), None)
    for img in (book or {}).get("images") or []:
        # the book list carries the remote address as `url`, the detail as `remoteUrl`
        url = img.get("remoteUrl") or img.get("url") or ""
        if img.get("coverType") not in ("cover", "poster") or not url.startswith("http"):
            continue
        if urlparse(url).hostname in POSTER_HOSTS:
            # the same cache and size rules as the app's covers
            return await proxy_image(url, request)
        # Goodreads covers sit on hosts the proxy does not fetch; the app
        # loads those directly too, so the reader is sent there
        return RedirectResponse(url, status_code=302)
    raise HTTPException(404, "no cover")


@router.get("/opds/{token}/download/{book_id}/{file_id}")
async def download(
    token: str,
    book_id: int,
    file_id: int,
    request: Request,
    readarr: ReadarrClient = Depends(get_readarr),
):
    await gate(request, token, readarr)
    return await stream_book_file(readarr, book_id, file_id, request.headers.get("range"))
