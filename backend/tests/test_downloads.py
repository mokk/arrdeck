import asyncio

import pytest
from fastapi import HTTPException

from app.api.v1.downloads import QBIT_PRIORITY, set_speed_limit
from app.schemas import SpeedLimitIn


class FakeQbit:
    """qBittorrent exposes a toggle, not a setter — the endpoint has to read
    the current mode first or 'turn it on' can turn it off."""

    def __init__(self, enabled):
        self.enabled = enabled
        self.toggles = 0

    async def alt_speed_enabled(self):
        return self.enabled

    async def toggle_alt_speed(self):
        self.toggles += 1
        self.enabled = not self.enabled


class FakeTm:
    def __init__(self):
        self.calls = []

    async def set_alt_speed(self, enabled):
        self.calls.append(enabled)


def test_enabling_an_already_throttled_qbit_is_a_no_op():
    qbit = FakeQbit(enabled=True)
    asyncio.run(set_speed_limit("qbittorrent", SpeedLimitIn(enabled=True), qbit, FakeTm()))
    assert qbit.toggles == 0
    assert qbit.enabled is True


def test_enabling_an_unthrottled_qbit_toggles_once():
    qbit = FakeQbit(enabled=False)
    asyncio.run(set_speed_limit("qbittorrent", SpeedLimitIn(enabled=True), qbit, FakeTm()))
    assert qbit.toggles == 1
    assert qbit.enabled is True


def test_disabling_a_throttled_qbit_toggles_once():
    qbit = FakeQbit(enabled=True)
    asyncio.run(set_speed_limit("qbittorrent", SpeedLimitIn(enabled=False), qbit, FakeTm()))
    assert qbit.enabled is False


def test_transmission_takes_the_value_directly():
    tm = FakeTm()
    asyncio.run(set_speed_limit("transmission", SpeedLimitIn(enabled=True), FakeQbit(False), tm))
    assert tm.calls == [True]


def test_an_unknown_client_is_a_404():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(set_speed_limit("deluge", SpeedLimitIn(enabled=True), FakeQbit(False), FakeTm()))
    assert exc.value.status_code == 404


def test_every_ui_position_maps_to_a_qbit_action():
    assert set(QBIT_PRIORITY) == {"top", "bottom", "up", "down"}
    assert QBIT_PRIORITY["top"] == "topPrio"
    assert QBIT_PRIORITY["bottom"] == "bottomPrio"


# --- reading qBittorrent's alt-speed mode --------------------------------


class FakeResponse:
    def __init__(self, text):
        self.text = text


class RecordingQbit:
    """Stands in for the client so the parsing of speedLimitsMode is pinned.

    qBittorrent 5.x stopped returning use_alt_speed_limits from /transfer/info;
    reading it from there silently reported "never throttled", so every toggle
    flipped the real state while the UI showed nothing.
    """

    def __init__(self, body):
        self.body = body
        self.paths = []

    async def request(self, method, path, **kwargs):
        self.paths.append(path)
        return FakeResponse(self.body)


async def _enabled(body):
    from app.clients.qbittorrent import QbittorrentClient

    client = RecordingQbit(body)
    return await QbittorrentClient.alt_speed_enabled(client), client.paths


def test_alt_speed_reads_the_speed_limits_mode_endpoint():
    enabled, paths = asyncio.run(_enabled("1"))
    assert enabled is True
    assert paths == ["/api/v2/transfer/speedLimitsMode"]


def test_alt_speed_off_is_a_plain_zero():
    enabled, _ = asyncio.run(_enabled("0"))
    assert enabled is False


def test_alt_speed_tolerates_surrounding_whitespace():
    assert asyncio.run(_enabled("1\n"))[0] is True
    assert asyncio.run(_enabled(" 0 "))[0] is False
