"""Needs attention: the queue items across the arrs that wait on a person."""

import asyncio
from types import SimpleNamespace

from app.api.v1.dashboard import _queue_items, needs_attention, queue_attention
from app.clients.base import ServiceUnavailable


def _request(*configured):
    registry = SimpleNamespace(is_configured=lambda name: name in configured)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(registry=registry)))


class FakeArr:
    def __init__(self, records=None, down=False):
        self.records = records or []
        self.down = down

    async def queue(self):
        if self.down:
            raise ServiceUnavailable("radarr", "connection refused")
        return {"records": self.records}


def _rec(id, state="downloading", status="ok", **extra):
    return {
        "id": id,
        "title": f"Release {id}",
        "status": "completed",
        "trackedDownloadState": state,
        "trackedDownloadStatus": status,
        **extra,
    }


def test_blocked_failed_and_flagged_items_need_a_person():
    for state in ("importBlocked", "importPending", "failedPending", "failed"):
        assert needs_attention(state, "ok")
    assert needs_attention("downloading", "warning")
    assert needs_attention("downloading", "error")
    assert not needs_attention("downloading", "ok")
    assert not needs_attention("importing", "ok")
    assert not needs_attention(None, None)


def test_the_arrs_own_reasons_come_through_whole():
    rec = _rec(
        1,
        "importBlocked",
        "warning",
        statusMessages=[
            {"title": "Dune.mkv", "messages": ["Not an upgrade", "Sample"]},
            {"title": "Dune.nfo", "messages": []},
        ],
        errorMessage="qBittorrent is reporting an error",
    )
    item = _queue_items("radarr", {"records": [rec]})[0]
    assert item.needs_attention is True
    assert item.errors == ["Not an upgrade"]
    assert item.status_messages[0].messages == ["Not an upgrade", "Sample"]
    assert item.status_messages[0].title == "Dune.mkv"
    assert item.error_message == "qBittorrent is reporting an error"


def test_one_list_across_the_arrs_with_a_count():
    radarr = FakeArr([_rec(1, "importBlocked"), _rec(2)])
    sonarr = FakeArr([_rec(3, "downloading", "warning")])
    readarr = FakeArr([_rec(4, "failedPending")])
    out = asyncio.run(
        queue_attention(_request("radarr", "sonarr", "readarr"), radarr, sonarr, readarr)
    )
    assert out["count"] == 3
    assert [(i.app, i.id) for i in out["items"]] == [("radarr", 1), ("sonarr", 3), ("readarr", 4)]
    assert out["unavailable"] == []


def test_a_down_arr_is_named_rather_than_failing_the_list():
    out = asyncio.run(
        queue_attention(
            _request("radarr", "sonarr"),
            FakeArr(down=True),
            FakeArr([_rec(3, "importBlocked")]),
            FakeArr([_rec(9, "failed")]),
        )
    )
    # readarr is not configured: absent, not unavailable, and not listed
    assert out["unavailable"] == ["radarr"]
    assert [(i.app, i.id) for i in out["items"]] == [("sonarr", 3)]
