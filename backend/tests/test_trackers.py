from app.api.v1.torrents import _registered_domain, _tracker_host


def test_tracker_host_strips_common_prefixes():
    assert _tracker_host("https://tracker.torrentleech.org:443/announce") == "torrentleech.org"
    assert _tracker_host("https://www.example.com/a") == "example.com"
    assert _tracker_host(None) is None


def test_registered_domain_takes_last_two_labels():
    assert _registered_domain("t.nordicbytes.org") == "nordicbytes.org"
    assert _registered_domain("example.com") == "example.com"
