"""Lightweight structured telemetry logging."""

from __future__ import annotations

import json
import logging
import time
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger("dcc.telemetry")


def emit(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, default=str))


@contextmanager
def timed_event(event: str, **base_fields: Any):
    started = time.monotonic()
    try:
        yield
    except Exception as exc:
        emit(
            event,
            **base_fields,
            elapsed_ms=int((time.monotonic() - started) * 1000),
            ok=False,
            error_type=type(exc).__name__,
        )
        raise
    else:
        emit(
            event,
            **base_fields,
            elapsed_ms=int((time.monotonic() - started) * 1000),
            ok=True,
        )
