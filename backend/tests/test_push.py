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


def test_private_key_b64_roundtrip():
    from py_vapid import Vapid

    from app.push import _private_key_b64

    vapid = Vapid()
    vapid.generate_keys()
    key = _private_key_b64(vapid.private_pem().decode())
    # pywebpush hands this string to Vapid.from_string — must parse and match
    restored = Vapid.from_string(private_key=key)
    assert (
        restored.private_key.private_numbers().private_value
        == vapid.private_key.private_numbers().private_value
    )
