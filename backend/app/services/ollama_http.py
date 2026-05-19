"""Shared helpers for Ollama-compatible HTTP responses."""

from __future__ import annotations

import httpx

DETAIL_MAX = 500


def parse_ollama_error_detail(response: httpx.Response, *, max_len: int = DETAIL_MAX) -> str:
    """Best-effort parse of Ollama JSON error; never raises."""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            err = payload.get("error")
            if isinstance(err, str) and err.strip():
                return err.strip()[:max_len]
    except Exception:
        pass
    text = (response.text or "").strip()
    return text[:max_len] if text else ""
