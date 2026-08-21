"""Installing arrdeck's own Connect entry into Radarr and Sonarr.

These tests stand in for the only safe rehearsal this code gets: in production it
writes to two live arrs, and a wrong payload either duplicates the entry or
silently stops every push notification.
"""

import httpx
import pytest

from app import webhooks
from app.clients.base import ServiceUnavailable
from app.db import SettingsDB
from app.webhooks import BASE_URL_KEY, HOOK_APPS, WEBHOOK_NAME


@pytest.fixture
def db(tmp_path) -> SettingsDB:
    return SettingsDB(str(tmp_path / "settings.db"))


DISCORD_SCHEMA = {
    "implementation": "Discord",
    "implementationName": "Discord",
    "fields": [{"name": "webHookUrl", "value": ""}],
    "onGrab": False,
}


def webhook_schema(**overrides) -> dict:
    """A Webhook entry as /notification/schema hands it over: every trigger off,
    empty fields, and a `method` that defaults to PUT rather than POST."""
    schema = {
        "implementation": "Webhook",
        "implementationName": "Webhook",
        "configContract": "WebhookSettings",
        "name": "",
        "tags": [7],
        "fields": [
            {"name": "url", "value": ""},
            {"name": "method", "value": 0},
            {"name": "username", "value": ""},
        ],
        "onGrab": False,
        "onDownload": False,
        "onUpgrade": False,
        "onRename": False,
        "onHealthIssue": False,
        "onHealthRestored": False,
        "includeHealthWarnings": False,
        "onApplicationUpdate": True,
        "onManualInteractionRequired": False,
    }
    schema.update(overrides)
    return schema


def arrdeck_entry(entry_id: int = 3, name: str = WEBHOOK_NAME, url: str | None = None) -> dict:
    return {
        "id": entry_id,
        "name": name,
        "implementation": "Webhook",
        "fields": [
            {"name": "url", "value": url or "http://old:3500/api/v1/hooks/oldtoken/radarr"},
            {"name": "method", "value": 1},
        ],
    }


def http_error(status: int = 400, json_body=None, text: str = "") -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://arr:7878/api/v3/notification")
    if json_body is not None:
        response = httpx.Response(status, json=json_body, request=request)
    else:
        response = httpx.Response(status, text=text, request=request)
    return httpx.HTTPStatusError("bad request", request=request, response=response)


class FakeArr:
    def __init__(self, notifications=None, schemas=None, fails=None) -> None:
        self.entries = list(notifications or [])
        self.schemas = [DISCORD_SCHEMA, webhook_schema()] if schemas is None else schemas
        self.fails = fails or {}
        self.added: list[dict] = []
        self.updated: list[tuple[int, dict]] = []
        self.deleted: list[int] = []

    def _maybe_fail(self, method: str) -> None:
        exc = self.fails.get(method)
        if exc is not None:
            raise exc

    async def notifications(self) -> list:
        self._maybe_fail("notifications")
        return self.entries

    async def notification_schemas(self) -> list:
        self._maybe_fail("notification_schemas")
        return self.schemas

    async def add_notification(self, payload: dict) -> dict:
        self._maybe_fail("add_notification")
        self.added.append(payload)
        return {**payload, "id": 11}

    async def update_notification(self, notification_id: int, payload: dict) -> dict:
        self._maybe_fail("update_notification")
        self.updated.append((notification_id, payload))
        return payload

    async def delete_notification(self, notification_id: int) -> None:
        self._maybe_fail("delete_notification")
        self.deleted.append(notification_id)


class FakeRegistry:
    def __init__(self, **clients) -> None:
        self.clients = {name: c for name, c in clients.items() if c is not None}

    def is_configured(self, name: str) -> bool:
        return name in self.clients

    def get(self, name: str):
        return self.clients[name]


def row_for(rows: list[dict], app_name: str) -> dict:
    return next(r for r in rows if r["app"] == app_name)


# --- token and url derivation ---


async def test_the_token_is_generated_once_and_then_reused(db):
    """Regenerating it would silently invalidate the URL already saved inside
    the arrs, and every event would 404 until the user reinstalled."""
    first = webhooks.token(db)
    assert first
    assert webhooks.token(db) == first


def test_the_hook_url_names_the_app_so_a_payload_can_be_parsed(db):
    url = webhooks.hook_url("http://arrdeck:3500", db, "sonarr")
    assert url == f"http://arrdeck:3500/api/v1/hooks/{webhooks.token(db)}/sonarr"


def test_a_trailing_slash_on_the_base_url_does_not_double_up(db):
    """A doubled slash is a 404 in the arr's eyes, and users paste URLs with a
    trailing slash constantly."""
    assert "//api" not in webhooks.hook_url("http://arrdeck:3500/", db, "radarr")


def test_the_base_url_is_guessed_from_a_configured_arrs_host(db):
    db.upsert("radarr", {"url": "http://10.0.0.5:7878", "api_key": "K"})
    assert webhooks.guess_base_url(db) == f"http://10.0.0.5:{webhooks.DEFAULT_PORT}"


def test_a_stored_base_url_beats_the_guess(db):
    """The guess is wrong whenever arrdeck is not on the arr's host, so once the
    user has corrected it the guess must never override it again."""
    db.upsert("radarr", {"url": "http://10.0.0.5:7878", "api_key": "K"})
    db.kv_set(BASE_URL_KEY, "http://arrdeck.lan:9000")
    assert webhooks.guess_base_url(db) == "http://arrdeck.lan:9000"


def test_sonarrs_host_is_used_when_radarr_is_not_configured(db):
    db.upsert("sonarr", {"url": "https://sonarr.box:8989", "api_key": "K"})
    assert webhooks.guess_base_url(db) == f"http://sonarr.box:{webhooks.DEFAULT_PORT}"


def test_with_no_arr_configured_the_guess_is_localhost(db):
    assert webhooks.guess_base_url(db) == f"http://localhost:{webhooks.DEFAULT_PORT}"


# --- install ---


async def test_installing_adds_a_webhook_when_the_arr_has_none(db):
    radarr, sonarr = FakeArr(), FakeArr()
    rows = await webhooks.install(db, FakeRegistry(radarr=radarr, sonarr=sonarr), "http://a:3500")
    assert [r["installed"] for r in rows] == [True, True]
    assert len(radarr.added) == 1
    assert len(sonarr.added) == 1
    assert radarr.updated == []


async def test_the_installed_entry_is_named_arrdeck_and_posts_to_the_hook_url(db):
    radarr = FakeArr()
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    payload = radarr.added[0]
    fields = {f["name"]: f["value"] for f in payload["fields"]}
    assert payload["name"] == WEBHOOK_NAME
    assert fields["url"] == webhooks.hook_url("http://a:3500", db, "radarr")
    # The schema defaults to method 0; the hook endpoint only accepts POST.
    assert fields["method"] == 1


async def test_the_new_entry_carries_no_tags(db):
    """The schema arrives with the arr's own tag ids on it; keeping them would
    scope arrdeck's notifications to a subset of the library."""
    radarr = FakeArr()
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    assert radarr.added[0]["tags"] == []


async def test_the_schema_is_not_mutated_so_two_apps_cannot_share_a_payload(db):
    """The payload is built from the schema dict; editing it in place would leak
    Radarr's hook url into Sonarr's entry."""
    schema = webhook_schema()
    radarr = FakeArr(schemas=[schema])
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    assert schema["fields"][0]["value"] == ""
    assert schema["name"] == ""


async def test_the_triggers_arrdeck_reacts_to_are_switched_on(db):
    radarr = FakeArr()
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    payload = radarr.added[0]
    assert payload["onGrab"] is True
    assert payload["onDownload"] is True
    assert payload["onHealthIssue"] is True
    assert payload["includeHealthWarnings"] is True
    # Noise, not events arrdeck reports on.
    assert payload["onRename"] is False
    assert payload["onApplicationUpdate"] is False


async def test_sonarrs_import_complete_trigger_stays_off(db):
    """onImportComplete fires alongside onDownload for the same files, so
    enabling it double-counts every episode in a coalesced season notification."""
    sonarr = FakeArr(schemas=[webhook_schema(onImportComplete=False, onSeriesAdd=False)])
    await webhooks.install(db, FakeRegistry(sonarr=sonarr), "http://a:3500")
    payload = sonarr.added[0]
    assert payload["onImportComplete"] is False
    assert payload["onSeriesAdd"] is True


async def test_a_trigger_the_arr_does_not_have_is_skipped_rather_than_invented(db):
    """Radarr and Sonarr name their triggers differently and the set changes
    between releases. Posting a key the arr does not know is a 400 on save, so
    an arr upgrade would break installing entirely."""
    radarr = FakeArr(schemas=[webhook_schema()])
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    payload = radarr.added[0]
    assert "onSeriesAdd" not in payload
    assert "onEpisodeFileDelete" not in payload


async def test_the_webhook_schema_is_picked_out_by_implementation_not_position(db):
    """The schema list is long and unordered; matching on order would install a
    Discord or Pushover connection pointed at arrdeck's URL."""
    radarr = FakeArr(schemas=[DISCORD_SCHEMA, {"implementation": "Pushover"}, webhook_schema()])
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    assert radarr.added[0]["implementation"] == "Webhook"


async def test_an_arr_with_no_webhook_schema_is_reported_not_crashed(db):
    """This is what an arr version that renamed or dropped the Webhook connect
    type looks like. It has to surface as a per-app message on the settings
    page rather than a 500 that hides which app failed."""
    radarr = FakeArr(schemas=[DISCORD_SCHEMA])
    rows = await webhooks.install(db, FakeRegistry(radarr=radarr, sonarr=FakeArr()), "http://a:3500")
    assert row_for(rows, "radarr")["installed"] is False
    assert "Webhook" in row_for(rows, "radarr")["error"]
    assert radarr.added == []
    assert row_for(rows, "sonarr")["installed"] is True


async def test_reinstalling_updates_the_existing_entry_rather_than_adding_a_second(db):
    """Two entries means two pushes for every event, and the arrs happily allow
    duplicates by name."""
    radarr = FakeArr(notifications=[arrdeck_entry(entry_id=42)])
    rows = await webhooks.install(db, FakeRegistry(radarr=radarr), "http://new:3500")
    assert radarr.added == []
    assert [i for i, _ in radarr.updated] == [42]
    assert radarr.updated[0][1]["id"] == 42
    assert row_for(rows, "radarr")["installed"] is True


async def test_reinstalling_rewrites_a_stale_hook_url(db):
    """Changing the base url is the main reason to reinstall; if the update kept
    the old url the reinstall would report success and still not work."""
    radarr = FakeArr(notifications=[arrdeck_entry(url="http://old:3500/api/v1/hooks/t/radarr")])
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://new:3500")
    _, payload = radarr.updated[0]
    fields = {f["name"]: f["value"] for f in payload["fields"]}
    assert fields["url"] == webhooks.hook_url("http://new:3500", db, "radarr")


async def test_an_entry_the_user_renamed_is_still_recognised_by_its_url(db):
    """Renaming arrdeck's connection in the arr UI must not cause a second one
    to appear on the next install."""
    renamed = arrdeck_entry(entry_id=7, name="my media hook")
    radarr = FakeArr(notifications=[renamed])
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    assert radarr.added == []
    assert [i for i, _ in radarr.updated] == [7]


async def test_someone_elses_notification_is_never_overwritten(db):
    """Radarr's Connect list is the user's own; clobbering their Discord entry
    would be unrecoverable from arrdeck."""
    discord = {
        "id": 1,
        "name": "Discord",
        "implementation": "Discord",
        "fields": [{"name": "webHookUrl", "value": "https://discord.com/api/webhooks/1/x"}],
    }
    radarr = FakeArr(notifications=[discord, {"id": 2, "name": "Plex", "fields": None}])
    await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    assert radarr.updated == []
    assert len(radarr.added) == 1


async def test_an_unconfigured_app_is_skipped_without_an_error(db):
    """A user with only Sonarr should not see a permanent red error for Radarr."""
    rows = await webhooks.install(db, FakeRegistry(sonarr=FakeArr()), "http://a:3500")
    radarr_row = row_for(rows, "radarr")
    assert radarr_row["installed"] is False
    assert radarr_row["error"] == ""


async def test_an_unreachable_arr_does_not_stop_the_other_one(db):
    """One arr being down is routine; it must not cost the user the install on
    the arr that is up."""
    down = FakeArr(fails={"notifications": ServiceUnavailable("radarr", "connection refused")})
    up = FakeArr()
    rows = await webhooks.install(db, FakeRegistry(radarr=down, sonarr=up), "http://a:3500")
    assert row_for(rows, "radarr")["error"] == "connection refused"
    assert row_for(rows, "sonarr")["installed"] is True
    assert len(up.added) == 1


async def test_the_arrs_own_validation_message_is_passed_through(db):
    """The arr posts a test payload before saving, so a rejected save usually
    means it cannot reach arrdeck — the user needs that sentence verbatim to fix
    the base url."""
    body = [{"propertyName": "Url", "errorMessage": "Unable to connect to arrdeck"}]
    radarr = FakeArr(fails={"add_notification": http_error(400, json_body=body)})
    rows = await webhooks.install(db, FakeRegistry(radarr=radarr), "http://a:3500")
    assert row_for(rows, "radarr")["error"] == "Unable to connect to arrdeck"
    assert row_for(rows, "radarr")["installed"] is False


async def test_the_base_url_is_persisted_stripped_of_whitespace_and_slash(db):
    """Stored as typed, a trailing slash or stray space would be baked into the
    hook url the arrs post to."""
    await webhooks.install(db, FakeRegistry(radarr=FakeArr()), "  http://a:3500/  ")
    assert db.kv_get(BASE_URL_KEY) == "http://a:3500"
    assert webhooks.guess_base_url(db) == "http://a:3500"


# --- status ---


async def test_status_reports_an_installed_hook_with_its_url(db):
    url = "http://a:3500/api/v1/hooks/tok/radarr"
    registry = FakeRegistry(radarr=FakeArr(notifications=[arrdeck_entry(url=url)]))
    rows = await webhooks.status(db, registry)
    radarr_row = row_for(rows, "radarr")
    assert radarr_row["configured"] is True
    assert radarr_row["installed"] is True
    assert radarr_row["url"] == url


async def test_status_covers_every_hook_app_even_when_unconfigured(db):
    rows = await webhooks.status(db, FakeRegistry())
    assert [r["app"] for r in rows] == list(HOOK_APPS)
    assert all(r["configured"] is False and r["installed"] is False for r in rows)


async def test_status_says_not_installed_when_no_entry_matches(db):
    registry = FakeRegistry(sonarr=FakeArr(notifications=[{"id": 1, "name": "Emby"}]))
    row = row_for(await webhooks.status(db, registry), "sonarr")
    assert row["installed"] is False
    assert row["url"] == ""
    assert row["error"] == ""


async def test_status_shows_a_down_arrs_error_instead_of_failing_the_page(db):
    """status() backs the whole webhook settings panel; one unreachable arr must
    not blank out the other's state."""
    down = FakeArr(fails={"notifications": ServiceUnavailable("radarr")})
    registry = FakeRegistry(radarr=down, sonarr=FakeArr(notifications=[arrdeck_entry()]))
    rows = await webhooks.status(db, registry)
    assert row_for(rows, "radarr")["error"] == "unreachable"
    assert row_for(rows, "radarr")["installed"] is False
    assert row_for(rows, "sonarr")["installed"] is True


# --- uninstall ---


async def test_uninstall_deletes_the_arrdeck_entry_from_each_arr(db):
    radarr = FakeArr(notifications=[arrdeck_entry(entry_id=5)])
    sonarr = FakeArr(notifications=[arrdeck_entry(entry_id=6)])
    rows = await webhooks.uninstall(db, FakeRegistry(radarr=radarr, sonarr=sonarr))
    assert radarr.deleted == [5]
    assert sonarr.deleted == [6]
    assert all(r["installed"] is False and r["error"] == "" for r in rows)


async def test_uninstall_leaves_the_users_other_notifications_alone(db):
    others = [
        {"id": 1, "name": "Discord", "fields": [{"name": "webHookUrl", "value": "https://d/1"}]},
        {"id": 2, "name": "Custom Script", "fields": []},
    ]
    radarr = FakeArr(notifications=others)
    await webhooks.uninstall(db, FakeRegistry(radarr=radarr))
    assert radarr.deleted == []


async def test_uninstall_reports_a_failure_per_app_and_keeps_going(db):
    down = FakeArr(
        notifications=[arrdeck_entry()],
        fails={"delete_notification": http_error(500, text="<html>boom</html>")},
    )
    sonarr = FakeArr(notifications=[arrdeck_entry(entry_id=9)])
    rows = await webhooks.uninstall(db, FakeRegistry(radarr=down, sonarr=sonarr))
    assert row_for(rows, "radarr")["error"] == "HTTP 500"
    assert sonarr.deleted == [9]


async def test_uninstall_skips_an_unconfigured_app(db):
    rows = await webhooks.uninstall(db, FakeRegistry())
    assert [r["error"] for r in rows] == ["", ""]


# --- error message extraction ---


def test_a_json_object_error_body_uses_its_message():
    exc = http_error(400, json_body={"message": "Invalid request"})
    assert webhooks._error_text(exc) == "Invalid request"


def test_a_json_object_error_body_falls_back_to_its_error_key():
    exc = http_error(400, json_body={"error": "nope"})
    assert webhooks._error_text(exc) == "nope"


def test_a_validation_row_without_an_error_message_is_still_shown():
    exc = http_error(400, json_body=[{"propertyName": "Url"}])
    assert "Url" in webhooks._error_text(exc)


def test_a_non_json_error_body_degrades_to_the_status_code():
    """The arrs answer with an nginx or IIS error page on some failures; dumping
    the html into the UI is worse than showing the code."""
    assert webhooks._error_text(http_error(502, text="<html>bad gateway</html>")) == "HTTP 502"


def test_a_json_error_body_of_an_unexpected_shape_degrades_to_the_status_code():
    assert webhooks._error_text(http_error(409, json_body=["surprise"])) == "HTTP 409"


def test_an_exception_with_no_message_is_named_by_its_type():
    """An empty error cell reads as success; the class name at least points at
    the cause."""
    assert webhooks._error_text(TimeoutError()) == "TimeoutError"
    assert webhooks._error_text(ValueError("no Webhook type")) == "no Webhook type"
