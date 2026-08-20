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
    # this is live on the real stack: unpackerr can't read either arr's queue
    prom = FakePrometheus(fetch={"Radarr": 1, "Sonarr": 1})
    out = asyncio.run(_unpackerr_warnings(prom))
    assert len(out) == 2
    assert any("Radarr" in w["message"] for w in out)
    assert any("Sonarr" in w["message"] for w in out)


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


def test_the_fetch_error_query_uses_the_app_label():
    """unpackerr labels the gauge/counter families with `name` but the per-app
    fetch errors with `app`. Querying `name` there silently collapsed Radarr and
    Sonarr into a single unnamed warning."""
    import inspect

    from app.api.v1 import system

    source = inspect.getsource(system._unpackerr_warnings)
    assert 'unpackerr_app_queue_fetch_errors_total", label="app"' in source


def test_two_apps_failing_produce_two_distinct_warnings():
    prom = FakePrometheus(fetch={"Radarr": 1, "Sonarr": 4})
    messages = [w["message"] for w in asyncio.run(_unpackerr_warnings(prom))]
    assert len(set(messages)) == 2  # not collapsed into one
