from app.api.v1.dashboard import release_info

START, END = "2026-08-01", "2026-08-31"


def test_prefers_in_window_date():
    movie = {"inCinemas": "2026-03-01T00:00:00Z", "digitalRelease": "2026-08-10T00:00:00Z"}
    assert release_info(movie, START, END) == ("2026-08-10T00:00:00Z", "digital")


def test_physical_dates_are_ignored():
    movie = {"physicalRelease": "2026-08-15T00:00:00Z"}
    assert release_info(movie, START, END) == (None, None)


def test_no_fallback_to_past_dates():
    movie = {"inCinemas": "2026-03-01T00:00:00Z"}  # outside window
    assert release_info(movie, START, END) == (None, None)


def test_earliest_in_window_wins():
    movie = {"inCinemas": "2026-08-05T00:00:00Z", "digitalRelease": "2026-08-20T00:00:00Z"}
    assert release_info(movie, START, END) == ("2026-08-05T00:00:00Z", "cinema")
