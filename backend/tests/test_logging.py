import json
import logging

from app.logging_setup import REQUEST_ID, JsonFormatter


def record(message="hello", **extra):
    rec = logging.LogRecord("arrdeck.test", logging.INFO, __file__, 1, message, (), None)
    for key, value in extra.items():
        setattr(rec, key, value)
    return rec


def test_every_line_is_json_with_the_basics():
    out = json.loads(JsonFormatter().format(record()))
    assert out["level"] == "INFO"
    assert out["logger"] == "arrdeck.test"
    assert out["message"] == "hello"
    assert "ts" in out


def test_the_request_id_is_attached_when_one_is_in_flight():
    token = REQUEST_ID.set("abc123")
    try:
        out = json.loads(JsonFormatter().format(record()))
        assert out["request_id"] == "abc123"
    finally:
        REQUEST_ID.reset(token)


def test_no_request_id_key_outside_a_request():
    # background loops log too; an empty id would be noise
    assert "request_id" not in json.loads(JsonFormatter().format(record()))


def test_structured_extras_are_promoted_to_fields():
    out = json.loads(
        JsonFormatter().format(
            record(method="GET", path="/api/v1/queue", status=502, duration_ms=12.5, service="radarr")
        )
    )
    assert out["method"] == "GET" and out["path"] == "/api/v1/queue"
    assert out["status"] == 502 and out["service"] == "radarr"


def test_exceptions_are_captured_as_a_field_not_a_second_line():
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        rec = record("failed")
        rec.exc_info = sys.exc_info()
        out = json.loads(JsonFormatter().format(rec))
    assert "boom" in out["exception"]
    # still one parseable line, which is the whole point
    assert out["message"] == "failed"


def test_unserialisable_values_do_not_break_a_line():
    out = json.loads(JsonFormatter().format(record(service=object())))
    assert "service" in out


# --- the 502 envelope ----------------------------------------------------


def test_a_502_carries_the_request_id_in_body_and_header():
    import asyncio

    from starlette.requests import Request

    from app.clients.base import ServiceUnavailable
    from app.logging_setup import HEADER, REQUEST_ID
    from app.main import service_unavailable_handler

    scope = {"type": "http", "method": "GET", "path": "/api/v1/queue", "headers": []}
    token = REQUEST_ID.set("trace99")
    try:
        response = asyncio.run(
            service_unavailable_handler(Request(scope), ServiceUnavailable("radarr", "unreachable"))
        )
    finally:
        REQUEST_ID.reset(token)

    body = json.loads(response.body)
    assert response.status_code == 502
    assert body["error"]["service"] == "radarr"
    assert body["error"]["request_id"] == "trace99"
    # header too, so a non-JSON-aware client can still quote it
    assert response.headers[HEADER] == "trace99"


def test_a_502_outside_a_request_context_still_renders():
    import asyncio

    from starlette.requests import Request

    from app.clients.base import ServiceUnavailable
    from app.main import service_unavailable_handler

    scope = {"type": "http", "method": "GET", "path": "/x", "headers": []}
    response = asyncio.run(
        service_unavailable_handler(Request(scope), ServiceUnavailable("sonarr", "boom"))
    )
    assert response.status_code == 502
    assert json.loads(response.body)["error"]["request_id"] == ""
