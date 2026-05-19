"""Sanitize background job failure messages for workspace/API surfaces."""

from __future__ import annotations

import re
from collections.abc import Sequence

_ERROR_MESSAGE_MAX = 240
_WS_RE = re.compile(r"\s+")


def sanitized_job_error_detail(
    exc: BaseException,
    *,
    redact_paths: Sequence[str] = (),
    redact_secrets: Sequence[str] = (),
) -> str:
    """Build a short, user-safe error string from an exception."""
    raw = str(exc).strip()
    raw = _WS_RE.sub(" ", raw.replace("\n", " ").replace("\r", " "))
    for fragment in redact_paths:
        if fragment:
            raw = raw.replace(fragment, "<path>")
    for secret in redact_secrets:
        if secret:
            raw = raw.replace(secret, "<redacted>")
    if raw:
        detail = f"{type(exc).__name__}: {raw}"
    else:
        detail = type(exc).__name__
    return detail[:_ERROR_MESSAGE_MAX]
