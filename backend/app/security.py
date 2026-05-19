"""Local-only request guard and API token helpers."""

from __future__ import annotations

import ipaddress
import secrets
from urllib.parse import urlsplit

from fastapi import Request
from starlette.responses import JSONResponse, Response

from app.config import Settings
from app.errors import CODES
from app.telemetry import emit

LOCAL_TOKEN_HEADER = "X-DCC-Local-Token"
_TEST_HOSTS = {"testserver", "testclient"}


def generate_local_api_token(settings: Settings) -> str:
    configured = settings.local_api_token
    if configured and configured.strip():
        return configured.strip()
    return secrets.token_urlsafe(32)


def _host_without_port(raw: str) -> str:
    value = raw.strip()
    if not value:
        return ""
    if value.startswith("["):
        end = value.find("]")
        return value[1:end] if end >= 0 else value
    if value.count(":") == 1:
        return value.rsplit(":", 1)[0]
    return value


def _is_loopback_host(raw: str | None) -> bool:
    if not raw:
        return True
    host = _host_without_port(raw).lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain", *_TEST_HOSTS}:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _origin_host(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    return parsed.hostname or ""


def _security_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": None,
                "trace_id": "security",
            }
        },
    )


def _path_requires_token(path: str) -> bool:
    if not path.startswith("/api"):
        return False
    if path in {"/api/health", "/api/local-session"}:
        return False
    return True


async def local_security_middleware(request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
    settings: Settings = request.app.state.settings
    path = request.url.path

    if request.method == "OPTIONS":
        return await call_next(request)

    if settings.local_only and not settings.allow_non_local_host:
        client_host = request.client.host if request.client else None
        host_header = request.headers.get("host")
        origin_host = _origin_host(request.headers.get("origin"))
        referer_host = _origin_host(request.headers.get("referer"))
        checks = {
            "client": client_host,
            "host": host_header,
            "origin": origin_host,
            "referer": referer_host,
        }
        bad = {name: value for name, value in checks.items() if not _is_loopback_host(value)}
        if bad:
            emit("security.local_reject", path=path, reason="non_loopback", fields=sorted(bad))
            return _security_response(
                403,
                CODES.BAD_REQUEST,
                "Data Control Center only accepts local loopback requests.",
            )
    elif settings.allow_non_local_host:
        emit("security.unsafe_override", setting="allow_non_local_host", path=path)

    if settings.require_local_api_token and _path_requires_token(path):
        expected = getattr(request.app.state, "local_api_token", "")
        supplied = request.headers.get(LOCAL_TOKEN_HEADER, "")
        if not expected or not secrets.compare_digest(supplied, expected):
            emit("security.token_reject", path=path, reason="missing_or_invalid")
            return _security_response(
                403,
                CODES.BAD_REQUEST,
                "Missing or invalid local API token.",
            )

    return await call_next(request)
