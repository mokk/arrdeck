import time

import pytest

from app import posters


@pytest.fixture
def cache(tmp_path, monkeypatch):
    monkeypatch.setattr(posters, "POSTER_DIR", tmp_path)
    return tmp_path


def write(cache, name: str, size: int, age_seconds: float = 0.0):
    path = cache / f"{name}.img"
    path.write_bytes(b"x" * size)
    if age_seconds:
        old = time.time() - age_seconds
        import os

        os.utime(path, (old, old))
    return path


def test_an_empty_or_missing_cache_is_fine(cache, tmp_path):
    assert posters.prune()["removed"] == 0
    posters.POSTER_DIR = tmp_path / "nope"
    assert posters.prune()["removed"] == 0


def test_nothing_is_removed_below_the_cap(cache):
    write(cache, "a", 100)
    write(cache, "b", 100)
    out = posters.prune(max_bytes=1000, max_age=1000)
    assert out["removed"] == 0 and out["kept"] == 2


def test_expired_posters_go_regardless_of_size(cache):
    write(cache, "old", 10, age_seconds=200)
    write(cache, "new", 10)
    out = posters.prune(max_bytes=10_000, max_age=100)
    assert out["removed"] == 1
    assert (cache / "new.img").exists()
    assert not (cache / "old.img").exists()


def test_the_oldest_go_first_when_over_the_size_cap(cache):
    write(cache, "oldest", 100, age_seconds=30)
    write(cache, "middle", 100, age_seconds=20)
    write(cache, "newest", 100, age_seconds=10)
    out = posters.prune(max_bytes=250, max_age=10_000)
    assert out["removed"] == 1
    assert not (cache / "oldest.img").exists()
    assert (cache / "newest.img").exists()
    assert out["bytes"] == 200


def test_it_keeps_dropping_until_actually_under_the_cap(cache):
    for i in range(5):
        write(cache, f"f{i}", 100, age_seconds=50 - i)
    out = posters.prune(max_bytes=150, max_age=10_000)
    assert out["bytes"] <= 150
    assert out["kept"] == 1


def test_non_poster_files_are_left_alone(cache):
    (cache / "notes.txt").write_text("keep me")
    write(cache, "a", 100, age_seconds=10_000)
    posters.prune(max_bytes=0, max_age=1)
    assert (cache / "notes.txt").exists()


def test_touch_refreshes_only_stale_entries(cache):
    path = write(cache, "a", 10, age_seconds=posters.TOUCH_INTERVAL + 10)
    before = path.stat().st_mtime
    posters.touch(path)
    assert path.stat().st_mtime > before

    fresh = write(cache, "b", 10)
    unchanged = fresh.stat().st_mtime
    posters.touch(fresh)  # within the interval: no write
    assert fresh.stat().st_mtime == unchanged


# --- url normalisation ---------------------------------------------------


def test_tmdb_originals_are_downsized():
    from app.api.v1.media import normalise_poster_url

    # the arrs hand out /original: 2000x3000 and over 1 MB for a 40px thumbnail
    assert (
        normalise_poster_url("https://image.tmdb.org/t/p/original/abc.jpg")
        == "https://image.tmdb.org/t/p/w500/abc.jpg"
    )


def test_any_tmdb_size_is_normalised_to_one_variant():
    from app.api.v1.media import normalise_poster_url

    # one variant means one cache entry per poster, not one per source size
    for size in ("w92", "w342", "w780", "original"):
        assert (
            normalise_poster_url(f"https://image.tmdb.org/t/p/{size}/abc.jpg")
            == "https://image.tmdb.org/t/p/w500/abc.jpg"
        )


def test_other_artwork_hosts_are_untouched():
    from app.api.v1.media import normalise_poster_url

    for url in (
        "https://artworks.thetvdb.com/banners/posters/x.jpg",
        "https://assets.fanart.tv/fanart/movies/1/movieposter/x.jpg",
    ):
        assert normalise_poster_url(url) == url
