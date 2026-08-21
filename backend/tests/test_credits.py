"""Shaping of Radarr's /credit rows: billing order, crew filtering, headshots."""

import pytest

from app.api.v1.library import CAST_LIMIT, CREW_JOBS, CREW_LIMIT, movie_credits
from app.api.v1.posters import normalise_poster_url
from app.cache import cache


class FakeRadarr:
    def __init__(self, rows: list[dict]) -> None:
        self.rows = rows
        self.calls = 0

    async def credits(self, movie_id: int) -> list[dict]:
        self.calls += 1
        return self.rows


def headshot(name: str) -> dict:
    return {
        "coverType": "headshot",
        "url": f"/MediaCoverProxy/abc/{name}.jpg",
        "remoteUrl": f"https://image.tmdb.org/t/p/original/{name}.jpg",
    }


def cast_row(name: str, order: int, character: str = "Someone", image: bool = True) -> dict:
    return {
        "type": "cast",
        "personName": name,
        "character": character,
        "order": order,
        "personTmdbId": order + 100,
        "images": [headshot(name)] if image else [],
    }


def crew_row(name: str, job: str) -> dict:
    return {"type": "crew", "personName": name, "job": job, "images": [headshot(name)]}


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


async def test_cast_is_returned_in_billing_order():
    """The arr hands rows back unsorted; `order` is what makes "top billed" mean
    anything."""
    radarr = FakeRadarr([cast_row("Third", 2), cast_row("First", 0), cast_row("Second", 1)])
    out = await movie_credits(1, radarr)
    assert [p.name for p in out.cast] == ["First", "Second", "Third"]


async def test_cast_missing_an_order_sorts_last_rather_than_crashing():
    rows = [cast_row("Known", 0), {"type": "cast", "personName": "Unknown", "images": []}]
    out = await movie_credits(2, FakeRadarr(rows))
    assert [p.name for p in out.cast] == ["Known", "Unknown"]


async def test_cast_is_capped():
    radarr = FakeRadarr([cast_row(f"Actor {i}", i) for i in range(40)])
    out = await movie_credits(3, radarr)
    assert len(out.cast) == CAST_LIMIT
    assert out.cast[0].name == "Actor 0"


async def test_only_the_named_crew_jobs_survive():
    """A film's crew is 30 rows including Thanks, Painter and Stunt Double."""
    radarr = FakeRadarr(
        [
            crew_row("Somebody", "Thanks"),
            crew_row("Matt Shakman", "Director"),
            crew_row("A Painter", "Painter"),
            crew_row("A Writer", "Screenplay"),
            crew_row("A Double", "Stunt Double"),
        ]
    )
    out = await movie_credits(4, radarr)
    assert [p.name for p in out.crew] == ["Matt Shakman", "A Writer"]
    assert [p.role for p in out.crew] == ["Director", "Screenplay"]


async def test_the_director_comes_first_whatever_order_the_arr_used():
    radarr = FakeRadarr(
        [crew_row("Composer", "Original Music Composer"), crew_row("Helmer", "Director")]
    )
    out = await movie_credits(5, radarr)
    assert out.crew[0].role == "Director"


async def test_crew_is_capped():
    radarr = FakeRadarr([crew_row(f"P{i}", job) for i, job in enumerate(CREW_JOBS * 3)])
    out = await movie_credits(6, radarr)
    assert len(out.crew) <= CREW_LIMIT


async def test_headshots_are_proxied_and_shrunk():
    """/original is ~220 KB per face; the list shows a dozen of them."""
    radarr = FakeRadarr([cast_row("Star", 0)])
    out = await movie_credits(7, radarr)
    assert out.cast[0].image is not None
    assert out.cast[0].image.startswith("/api/v1/poster?u=")
    assert "w185" in out.cast[0].image
    assert "original" not in out.cast[0].image


async def test_a_person_with_no_photo_still_appears():
    radarr = FakeRadarr([cast_row("Faceless", 0, image=False)])
    out = await movie_credits(8, radarr)
    assert [p.name for p in out.cast] == ["Faceless"]
    assert out.cast[0].image is None


async def test_a_film_with_no_credits_returns_empty_lists():
    """The page renders nothing at all in this case rather than an empty card."""
    out = await movie_credits(9, FakeRadarr([]))
    assert out.cast == []
    assert out.crew == []


async def test_credits_are_cached_so_the_page_reload_costs_nothing():
    radarr = FakeRadarr([cast_row("Star", 0)])
    await movie_credits(10, radarr)
    await movie_credits(10, radarr)
    assert radarr.calls == 1


async def test_cache_is_per_movie():
    a, b = FakeRadarr([cast_row("A", 0)]), FakeRadarr([cast_row("B", 0)])
    assert (await movie_credits(11, a)).cast[0].name == "A"
    assert (await movie_credits(12, b)).cast[0].name == "B"


def test_the_proxy_keeps_a_headshot_size_it_is_handed():
    """Without this the proxy endpoint would re-inflate w185 back to w500."""
    small = "https://image.tmdb.org/t/p/w185/x.jpg"
    assert normalise_poster_url(small) == small


def test_the_proxy_still_clamps_original():
    big = "https://image.tmdb.org/t/p/original/x.jpg"
    assert normalise_poster_url(big) == "https://image.tmdb.org/t/p/w500/x.jpg"


def test_the_proxy_leaves_non_tmdb_urls_alone():
    url = "https://artworks.thetvdb.com/banners/series/1/posters/2.jpg"
    assert normalise_poster_url(url) == url


async def test_a_person_holding_two_credits_is_listed_once():
    """Screenplay + Story is a common pair, and listing the name twice reads as
    a bug. Jobs are in priority order, so the first mention wins."""
    radarr = FakeRadarr(
        [crew_row("Eric Pearson", "Screenplay"), crew_row("Eric Pearson", "Story")]
    )
    out = await movie_credits(13, radarr)
    assert [(p.name, p.role) for p in out.crew] == [("Eric Pearson", "Screenplay")]


async def test_writers_cannot_crowd_out_the_director():
    """The Fantastic 4 carries four Screenplay credits and one Story credit,
    which filled the entire crew list with writers."""
    radarr = FakeRadarr(
        [
            crew_row("W1", "Screenplay"),
            crew_row("W2", "Screenplay"),
            crew_row("W3", "Screenplay"),
            crew_row("W4", "Screenplay"),
            crew_row("Helmer", "Director"),
            crew_row("Composer", "Original Music Composer"),
        ]
    )
    out = await movie_credits(14, radarr)
    roles = [p.role for p in out.crew]
    assert roles[0] == "Director"
    assert roles.count("Screenplay") == 2
    assert "Original Music Composer" in roles
