import httpx
import pytest
import respx

from app.clients.qbittorrent import QbittorrentClient

BASE = "http://qbit.test"


@respx.mock
async def test_relogin_on_403_then_retry():
    calls = {"n": 0}

    def torrents_response(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(403, text="Forbidden")
        return httpx.Response(200, json=[])

    respx.get(f"{BASE}/api/v2/torrents/info").mock(side_effect=torrents_response)
    login = respx.post(f"{BASE}/api/v2/auth/login").mock(
        return_value=httpx.Response(200, text="Ok.")
    )

    async with httpx.AsyncClient() as http:
        client = QbittorrentClient(http, BASE, "admin", "secret")
        assert await client.torrents() == []
    assert login.called
    assert calls["n"] == 2


@respx.mock
async def test_403_without_credentials_raises():
    respx.get(f"{BASE}/api/v2/torrents/info").mock(return_value=httpx.Response(403))
    async with httpx.AsyncClient() as http:
        client = QbittorrentClient(http, BASE, "", "")
        with pytest.raises(Exception, match="no credentials"):
            await client.torrents()
