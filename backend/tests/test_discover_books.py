"""Book search and add go through Readarr's combined /search, whose book
entries carry the author and editions that POST /book needs."""

from app.api.v1.discover import book_search_result, new_book_payload
from app.schemas import AddBookIn

ENTRY = {
    "foreignId": "16777",
    "book": {
        "title": "Neuromancer",
        "foreignBookId": "16777",
        "releaseDate": "1984-07-01T07:00:00Z",
        "overview": "Case was the sharpest data-thief in the matrix.",
        "remoteCover": "https://covers.test/n.jpg",
        "author": {"id": 0, "authorName": "William Gibson", "foreignAuthorId": "9226"},
        "editions": [
            {"foreignEditionId": "1", "monitored": False, "format": "Hardcover"},
            {"foreignEditionId": "14772", "monitored": True, "format": "Paperback"},
        ],
    },
}


def test_author_only_entries_are_skipped():
    assert book_search_result({"foreignId": "9226", "author": {"id": 3}}, {}) is None


def test_book_entry_maps_ids_year_author_and_the_monitored_edition():
    r = book_search_result(ENTRY, {})
    assert r is not None
    assert (r.kind, r.title, r.year, r.author) == ("book", "Neuromancer", 1984, "William Gibson")
    assert (r.remote_id, r.foreign_id, r.foreign_edition_id) == (16777, "16777", "14772")
    assert r.in_library is False and r.poster


def test_library_state_comes_from_the_map():
    r = book_search_result(ENTRY, {16777: {"library_id": 5, "monitored": True, "has_file": False}})
    assert r is not None and r.in_library and r.library_id == 5 and r.monitored is True


BODY = AddBookIn(
    foreign_book_id="16777",
    foreign_edition_id="14772",
    title="Neuromancer",
    quality_profile_id=2,
    root_folder_path="/data/Books",
)


def test_new_author_gets_profiles_folder_and_monitors_only_this_book():
    payload = new_book_payload(ENTRY["book"], BODY, metadata_profile_id=7)
    author = payload["author"]
    assert author["qualityProfileId"] == 2 and author["metadataProfileId"] == 7
    assert author["rootFolderPath"] == "/data/Books" and author["monitored"] is True
    assert author["addOptions"] == {"searchForMissingBooks": False, "booksToMonitor": ["16777"]}
    assert payload["monitored"] is True and payload["addOptions"] == {"searchForNewBook": True}
    assert payload["editions"] == ENTRY["book"]["editions"], "editions pass through untouched"
    assert "qualityProfileId" not in ENTRY["book"]["author"], "the input is not mutated"


def test_existing_author_is_left_alone():
    book = {
        **ENTRY["book"],
        "author": {"id": 3, "authorName": "William Gibson", "qualityProfileId": 1},
    }
    payload = new_book_payload(book, BODY, metadata_profile_id=7)
    assert payload["author"] == book["author"]
