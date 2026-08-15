from app.push import describe_record


def test_movie_title_with_year():
    rec = {"movie": {"title": "Inception", "year": 2010}, "sourceTitle": "Inception.2010.x265"}
    assert describe_record("radarr", rec) == "Inception (2010)"


def test_movie_falls_back_to_source_title():
    rec = {"sourceTitle": "Inception.2010.x265"}
    assert describe_record("radarr", rec) == "Inception.2010.x265"


def test_episode_title():
    rec = {
        "series": {"title": "The Bear"},
        "episode": {"seasonNumber": 3, "episodeNumber": 4, "title": "Violet"},
    }
    assert describe_record("sonarr", rec) == "The Bear S03E04 – Violet"


def test_episode_without_episode_details():
    rec = {"series": {"title": "The Bear"}, "sourceTitle": "The.Bear.S03E04"}
    assert describe_record("sonarr", rec) == "The Bear"
