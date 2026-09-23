from typing import Any

import httpx

from .base import ArrClient

SEARCH_TIMEOUT = 90.0


class ReadarrClient(ArrClient):
    """Readarr speaks the arr dialect on /api/v1 rather than /api/v3. Books
    hang off authors: the quality and metadata profile live on the author,
    a book carries only its own monitored flag and editions."""

    name = "readarr"
    api_prefix = "/api/v1"

    async def queue(self) -> dict:
        return await self.get(
            "/queue",
            params={
                "pageSize": 50,
                "includeUnknownAuthorItems": "true",
                "includeBook": "true",
                "includeAuthor": "true",
            },
        )

    async def calendar(self, start: str, end: str) -> list:
        return await self.get(
            "/calendar", params={"start": start, "end": end, "includeAuthor": "true"}
        )

    async def books(self) -> list:
        return await self.get("/book")

    async def get_book(self, book_id: int) -> dict:
        return await self.get(f"/book/{book_id}")

    async def book_files(self, book_id: int) -> list:
        return await self.get("/bookfile", params={"bookId": book_id})

    async def fork_features(self) -> list[str]:
        """Capabilities only our Readarr fork advertises (system/status
        `forkFeatures`); empty against an upstream build."""
        status = await self.status()
        return list(status.get("forkFeatures") or [])

    async def open_book_file(self, file_id: int, range_header: str | None = None) -> httpx.Response:
        """Start streaming a book file from the fork's download endpoint. The
        caller owns the response and must close it."""
        headers = {"X-Api-Key": self.api_key}
        if range_header:
            headers["Range"] = range_header
        request = self.http.build_request(
            "GET", f"{self.base_url}{self.api_prefix}/bookfile/{file_id}/download", headers=headers
        )
        return await self.http.send(request, stream=True)

    async def editions(self, book_id: int) -> list:
        return await self.get("/edition", params={"bookId": book_id})

    async def update_book(self, book_id: int, payload: dict) -> dict:
        # PUT /book maps the resource back with `editions.ToModel()`, and GET
        # /book/{id} does not include them — sending the book back as fetched
        # is a 500 (ArgumentNullException). Readarr's own UI always has them
        # loaded; we fetch them when the caller has not.
        if payload.get("editions") is None:
            payload = {**payload, "editions": await self.editions(book_id)}
        return await self.request("PUT", f"/book/{book_id}", json=payload)

    async def delete_book(self, book_id: int, delete_files: bool) -> None:
        await self.request(
            "DELETE",
            f"/book/{book_id}",
            params={"deleteFiles": str(delete_files).lower(), "addImportListExclusion": "false"},
        )

    async def authors(self) -> list:
        return await self.get("/author")

    async def get_author(self, author_id: int) -> dict:
        return await self.get(f"/author/{author_id}")

    async def series(self, author_id: int) -> list:
        """An author's book series, each with (bookId, position) links."""
        return await self.get("/series", params={"authorId": author_id})

    async def update_author(self, author_id: int, payload: dict) -> dict:
        return await self.request("PUT", f"/author/{author_id}", json=payload)

    async def lookup(self, term: str) -> list:
        return await self.get("/book/lookup", params={"term": term})

    async def search(self, term: str) -> list:
        """The combined search: author entries and book entries, where each book
        carries its author and editions — what POST /book needs. /book/lookup
        returns books without either. Understands `edition:<id>` and friends."""
        # A fresh term makes Readarr ask its metadata server and fetch the
        # editions of every hit, which takes over a minute on a slow metadata server, far past the 8 s the other arr
        # calls get; a cached term answers in well under a second.
        return await self.get("/search", params={"term": term}, timeout=SEARCH_TIMEOUT)

    async def add_book(self, payload: dict) -> dict:
        # A new author means Readarr pulls their whole bibliography from the
        # metadata server before it answers — the same slow path as search.
        return await self.request("POST", "/book", json=payload, timeout=SEARCH_TIMEOUT)

    async def quality_profiles(self) -> list:
        return await self.get("/qualityprofile")

    async def metadata_profiles(self) -> list:
        return await self.get("/metadataprofile")

    async def root_folders(self) -> list:
        return await self.get("/rootfolder")

    async def command(self, payload: dict) -> Any:
        return await self.request("POST", "/command", json=payload)

    async def delete_queue_item(
        self, item_id: int, remove_from_client: bool, blocklist: bool
    ) -> None:
        await self.request(
            "DELETE",
            f"/queue/{item_id}",
            params={
                "removeFromClient": str(remove_from_client).lower(),
                "blocklist": str(blocklist).lower(),
            },
        )

    async def history_book(self, book_id: int) -> list:
        # Readarr has no per-book history route like Radarr's /history/movie;
        # the paged endpoint filters on bookId instead.
        payload = await self.get(
            "/history",
            params={
                "pageSize": 50,
                "page": 1,
                "sortKey": "date",
                "sortDirection": "descending",
                "bookId": book_id,
                "includeBook": "true",
            },
        )
        return payload.get("records", [])

    async def wanted(self, kind: str, page: int = 1, page_size: int = 30) -> dict:
        # kind: "missing" | "cutoff"
        return await self.get(
            f"/wanted/{kind}",
            params={
                "page": page,
                "pageSize": page_size,
                "sortKey": "releaseDate",
                "sortDirection": "descending",
                "monitored": "true",
                "includeAuthor": "true",
            },
        )

    async def bulk_edit(self, payload: dict) -> None:
        await self.request("PUT", "/book/editor", json=payload)

    async def bulk_delete(
        self, book_ids: list[int], delete_files: bool, exclude: bool = False
    ) -> None:
        await self.request(
            "DELETE",
            "/book/editor",
            json={
                "bookIds": book_ids,
                "deleteFiles": delete_files,
                "addImportListExclusion": exclude,
            },
        )
