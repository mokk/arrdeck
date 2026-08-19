"""Structured logging and per-request ids.

There was no logging config at all, so a 502 in the browser had nothing on the
server to correlate it with. Every log line is JSON with the request id of
whatever was in flight, and the id is returned to the client so a toast can
quote it.
"""

import json
import logging
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware

REQUEST_ID: ContextVar[str] = ContextVar("request_id", default="")
HEADER = "X-Request-ID"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = REQUEST_ID.get()
        if request_id:
            payload["request_id"] = request_id
        for key in ("method", "path", "status", "duration_ms", "service"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # uvicorn installs its own handlers; route them through this one instead of
    # printing a second, unstructured copy of every line
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    # httpx logs a line per upstream call at INFO; with a poll every few seconds
    # across nine services that buries everything worth reading
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assigns an id, logs one line per request, and echoes it in a header."""

    async def dispatch(self, request, call_next):
        incoming = request.headers.get(HEADER, "")
        request_id = incoming or uuid.uuid4().hex[:12]
        token = REQUEST_ID.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            logging.getLogger("arrdeck.request").exception(
                "request failed",
                extra={"method": request.method, "path": request.url.path},
            )
            raise
        finally:
            REQUEST_ID.reset(token)
        duration = round((time.perf_counter() - started) * 1000, 1)
        response.headers[HEADER] = request_id
        # only the interesting ones: a healthy poll every few seconds is noise
        if response.status_code >= 400 or duration > 2000:
            logging.getLogger("arrdeck.request").warning(
                "slow or failed request",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status": response.status_code,
                    "duration_ms": duration,
                },
            )
        return response
