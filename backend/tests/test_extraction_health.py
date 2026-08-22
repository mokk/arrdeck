"""Unpackerr and download-client checks folded into the health card.

A download that completes and never imports is usually unpackerr failing
quietly, or an arr with no enabled download client. Neither surfaced anywhere.
"""

import asyncio

from app.api.v1.system import _download_client_warnings, _unpackerr_warnings


class FakePrometheus:
    def __init__(self, gauges=None, counters=None, fetch=None, fail=False):
        self._gauges, self._counters, self._fetch, self._fail = gauges or {}, counters or {}, fetch or {}, fail

    async def scalars(self, expr, label="name"):
        if self._fail:
            raise RuntimeError("prometheus down")
        if "gauges" in expr:
            return self._gauges
        if "counters" in expr:
            return self._counters
        return self._fetch

    # counters must be read through increase(), not raw, or a blip at startup
    # warns forever
    windowed = True


class FakeArr:
    def __init__(self, clients):
        self._clients = clients

    async def download_clients(self):
        if self._clients is None:
            raise RuntimeError("arr down")
        return self._clients


def test_a_healthy_unpackerr_produces_no_warnings():
    prom = FakePrometheus(gauges={"failed": 0, "extracted": 5}, counters={"cmd_fail": 0})
    assert asyncio.run(_unpackerr_warnings(prom)) == []


def test_failed_extractions_are_reported_as_errors():
    prom = FakePrometheus(gauges={"failed": 3})
    out = asyncio.run(_unpackerr_warnings(prom))
    assert len(out) == 1
    assert out[0]["level"] == "error"
    assert "3 extraction(s) failed" in out[0]["message"]


def test_command_and_hook_failures_are_warnings():
    prom = FakePrometheus(counters={"cmd_fail": 2, "hook_fail": 1, "cmd_ok": 99})
    out = asyncio.run(_unpackerr_warnings(prom))
    assert {w["level"] for w in out} == {"warning"}
    assert len(out) == 2  # cmd_ok is a success counter, not a problem


def test_queue_fetch_errors_name_the_app():
    prom = FakePrometheus(fetch={"Radarr": 5, "Sonarr": 4})
    out = asyncio.run(_unpackerr_warnings(prom))
    assert len(out) == 2
    assert any("Radarr" in w["message"] for w in out)
    assert any("Sonarr" in w["message"] for w in out)


def test_a_single_queue_timeout_is_weather_not_a_fault():
    """host.docker.internal stalls briefly under load, so unpackerr logs an
    occasional timeout — seven in sixty hours on the real stack — that recovers
    within a couple of minutes. Warning on one meant warning for a full hour
    about something already fixed."""
    prom = FakePrometheus(fetch={"Radarr": 1, "Sonarr": 1})
    assert asyncio.run(_unpackerr_warnings(prom)) == []


def test_two_timeouts_are_still_below_the_threshold():
    prom = FakePrometheus(fetch={"Radarr": 2})
    assert asyncio.run(_unpackerr_warnings(prom)) == []


def test_the_threshold_is_reached_not_merely_approached():
    """Guards the boundary in both directions, so a change to >= or > is caught
    rather than silently shifting when the warning appears."""
    from app.api.v1.system import QUEUE_FETCH_THRESHOLD

    below = FakePrometheus(fetch={"Radarr": QUEUE_FETCH_THRESHOLD - 1})
    at = FakePrometheus(fetch={"Radarr": QUEUE_FETCH_THRESHOLD})
    assert asyncio.run(_unpackerr_warnings(below)) == []
    assert len(asyncio.run(_unpackerr_warnings(at))) == 1


def test_a_sustained_failure_still_warns():
    """The point of the threshold is to ignore blips, not to go quiet on a real
    outage — an arr that is genuinely unreachable produces one every 30s."""
    prom = FakePrometheus(fetch={"Radarr": 40})
    out = asyncio.run(_unpackerr_warnings(prom))
    assert len(out) == 1
    assert "40 errors" in out[0]["message"]


def test_an_extraction_failure_is_not_subject_to_the_threshold():
    """A failed extraction is a fact about a file, not a transient network
    condition, so one is worth reporting immediately."""
    out = asyncio.run(_unpackerr_warnings(FakePrometheus(gauges={"failed": 1})))
    assert len(out) == 1
    assert out[0]["level"] == "error"


def test_a_missing_prometheus_yields_no_warnings_rather_than_failing():
    # the health card must still render its other sources
    assert asyncio.run(_unpackerr_warnings(FakePrometheus(fail=True))) == []


def test_an_arr_with_no_enabled_client_is_an_error():
    out = asyncio.run(_download_client_warnings(
        FakeArr([{"name": "rTorrent", "enable": False}]),
        FakeArr([{"name": "qBittorrent", "enable": True}]),
    ))
    assert len(out) == 1
    assert out[0]["app"] == "radarr" and out[0]["level"] == "error"


def test_one_enabled_client_among_several_is_fine():
    out = asyncio.run(_download_client_warnings(
        FakeArr([{"enable": True}, {"enable": False}]),
        FakeArr([{"enable": True}]),
    ))
    assert out == []


def test_an_unreachable_arr_is_skipped_not_reported_as_misconfigured():
    # /status already says the arr is down; claiming "no download client" too
    # would be a second, misleading warning
    assert asyncio.run(_download_client_warnings(FakeArr(None), FakeArr([{"enable": True}]))) == []


def test_counters_are_read_over_a_window_not_as_lifetime_totals():
    """unpackerr's fetch-error and cmd/hook counters are lifetime totals. Read
    raw, a single failure during a restart produced a permanent warning even
    though the service had been healthy for hours."""
    import inspect

    from app.api.v1 import system

    source = inspect.getsource(system._unpackerr_warnings)
    assert "increase(unpackerr_counters[" in source
    assert "increase(unpackerr_app_queue_fetch_errors_total[" in source
    # the gauge is current state and must NOT be wrapped
    assert 'scalars("unpackerr_gauges")' in source


def test_a_fractional_increase_is_not_reported_as_a_whole_error():
    # increase() interpolates, so a long-settled counter can read as 0.3
    prom = FakePrometheus(fetch={"Radarr": 0.4}, counters={"cmd_fail": 0.7})
    assert asyncio.run(_unpackerr_warnings(prom)) == []


def test_the_fetch_error_query_uses_the_app_label():
    """unpackerr labels the gauge/counter families with `name` but the per-app
    fetch errors with `app`. Querying `name` there silently collapsed Radarr and
    Sonarr into a single unnamed warning."""
    import inspect

    from app.api.v1 import system

    source = inspect.getsource(system._unpackerr_warnings)
    assert 'label="app"' in source and "unpackerr_app_queue_fetch_errors_total" in source


def test_two_apps_failing_produce_two_distinct_warnings():
    # Both above the threshold: the point here is that the two series are not
    # collapsed into one key, which is what the wrong Prometheus label caused.
    prom = FakePrometheus(fetch={"Radarr": 3, "Sonarr": 4})
    messages = [w["message"] for w in asyncio.run(_unpackerr_warnings(prom))]
    assert len(set(messages)) == 2  # not collapsed into one
