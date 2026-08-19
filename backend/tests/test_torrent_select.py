from app.api.v1.torrents import _select, _sorted_rows

ROWS = [
    {"name": "Alpha", "state": "seeding", "added_on": 300, "size": None},
    {"name": "beta", "state": "downloading", "added_on": 100, "size": 20},
    {"name": "Gamma", "state": "seeding", "added_on": 200, "size": 10},
]


def test_sorting_matches_the_clients_rules():
    # nulls last in both directions, strings case-insensitive
    assert [r["size"] for r in _sorted_rows(ROWS, "size", "asc")] == [10, 20, None]
    # the client keeps nulls last when descending too; a plain reverse would not
    assert [r["size"] for r in _sorted_rows(ROWS, "size", "desc")] == [20, 10, None]
    assert [r["name"] for r in _sorted_rows(ROWS, "name", "asc")] == ["Alpha", "beta", "Gamma"]


def test_state_filter_and_reported_states():
    out = _select(ROWS, "", "seeding", "added_on", "desc", 100)
    assert [r["name"] for r in out["torrents"]] == ["Alpha", "Gamma"]
    assert out["total"] == 2
    # states are computed before filtering, so the dropdown keeps every option
    assert out["states"] == ["downloading", "seeding"]


def test_name_filter_is_case_insensitive():
    assert _select(ROWS, "GAMM", "", "added_on", "desc", 100)["total"] == 1


def test_all_is_treated_as_no_state_filter():
    assert _select(ROWS, "", "all", "added_on", "desc", 100)["total"] == 3
    assert _select(ROWS, "", "", "added_on", "desc", 100)["total"] == 3


def test_limit_caps_rows_but_total_reports_the_real_count():
    out = _select(ROWS, "", "", "added_on", "desc", 2)
    assert len(out["torrents"]) == 2
    assert out["total"] == 3
    # the newest two, so a client merging two capped lists still sees the right top
    assert [r["added_on"] for r in out["torrents"]] == [300, 200]


def test_a_zero_or_negative_limit_still_returns_something():
    # a bad query param shouldn't produce an empty screen
    assert len(_select(ROWS, "", "", "added_on", "desc", 0)["torrents"]) == 1


def test_merging_two_capped_lists_preserves_the_global_top():
    left = [{"name": f"l{i}", "state": "seeding", "added_on": i} for i in range(0, 20, 2)]
    right = [{"name": f"r{i}", "state": "seeding", "added_on": i} for i in range(1, 20, 2)]
    limit = 3
    a = _select(left, "", "", "added_on", "desc", limit)["torrents"]
    b = _select(right, "", "", "added_on", "desc", limit)["torrents"]
    merged = _sorted_rows(a + b, "added_on", "desc")[:limit]
    everything = _sorted_rows(left + right, "added_on", "desc")[:limit]
    assert [r["name"] for r in merged] == [r["name"] for r in everything]
