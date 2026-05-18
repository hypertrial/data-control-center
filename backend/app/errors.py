"""API error helpers and normalized exception handling."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ErrorCode:
    BAD_REQUEST: str = "BAD_REQUEST"
    NOT_FOUND: str = "NOT_FOUND"
    SQL_FORBIDDEN: str = "SQL_FORBIDDEN"
    SQL_TIMEOUT: str = "SQL_TIMEOUT"
    PATH_NOT_ALLOWED: str = "PATH_NOT_ALLOWED"
    JOB_TIMEOUT: str = "JOB_TIMEOUT"
    JOB_NOT_FOUND: str = "JOB_NOT_FOUND"
    JOB_FAILED: str = "JOB_FAILED"
    STALE_PROFILE_CACHE: str = "STALE_PROFILE_CACHE"
    INTERNAL_ERROR: str = "INTERNAL_ERROR"


CODES = ErrorCode()


class AppError(Exception):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def to_http_error(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message, "details": details},
    )


def _to_response_payload(
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None,
    trace_id: str,
) -> dict[str, Any]:
    return {
        "code": code,
        "message": message,
        "details": details,
        "trace_id": trace_id,
    }


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    trace_id = uuid.uuid4().hex[:12]
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": _to_response_payload(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                trace_id=trace_id,
            )
        },
    )


async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    trace_id = uuid.uuid4().hex[:12]
    detail = exc.detail

    if isinstance(detail, dict) and "code" in detail and "message" in detail:
        code = str(detail.get("code") or CODES.BAD_REQUEST)
        message = str(detail.get("message") or "Request failed")
        details = detail.get("details")
    elif isinstance(detail, str):
        code = CODES.BAD_REQUEST if exc.status_code < 500 else CODES.INTERNAL_ERROR
        message = detail
        details = None
    else:
        code = CODES.BAD_REQUEST if exc.status_code < 500 else CODES.INTERNAL_ERROR
        message = "Request failed" if exc.status_code < 500 else "Internal server error"
        details = None

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": _to_response_payload(
                code=code,
                message=message,
                details=details if isinstance(details, dict) else None,
                trace_id=trace_id,
            )
        },
    )


async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    trace_id = uuid.uuid4().hex[:12]
    logger.exception("Unhandled API error trace_id=%s", trace_id, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": _to_response_payload(
                code=CODES.INTERNAL_ERROR,
                message="Internal server error",
                details=None,
                trace_id=trace_id,
            )
        },
    )
