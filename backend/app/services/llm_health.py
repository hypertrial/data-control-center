"""Probe local LLM (Ollama) reachability for /api/health."""

from __future__ import annotations

import httpx

from app.config import Settings
from app.models.api import LlmHealth
from app.services.ollama_http import parse_ollama_error_detail

_TAGS_PATH = "/api/tags"
_PROBE_TIMEOUT_SEC = 2.0


def check_llm_health(settings: Settings) -> LlmHealth:
    """
    GET {llm_base_url}/api/tags with a short timeout.
    Does not log secrets or local filesystem paths in detail strings.
    """
    base = settings.llm_base_url.rstrip("/")
    url = f"{base}{_TAGS_PATH}"
    model = settings.llm_model
    timeout = httpx.Timeout(_PROBE_TIMEOUT_SEC)
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(url)
    except httpx.TimeoutException:
        return LlmHealth(
            reachable=False,
            model=model,
            detail="Timed out waiting for local LLM.",
        )
    except httpx.RequestError:
        return LlmHealth(
            reachable=False,
            model=model,
            detail="Could not reach local LLM endpoint.",
        )

    if response.status_code == 200:
        return LlmHealth(reachable=True, model=model, detail=None)

    detail = parse_ollama_error_detail(response) or f"HTTP {response.status_code}"
    return LlmHealth(reachable=False, model=model, detail=detail)
