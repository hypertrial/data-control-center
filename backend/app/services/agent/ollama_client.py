"""Ollama HTTP client helpers."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx

from app.config import Settings
from app.services.agent.prompts import OLLAMA_SQL_DRAFT_FORMAT
from app.services.ollama_http import parse_ollama_error_detail

_ollama_error_body = parse_ollama_error_detail

def ollama_chat(
    settings: Settings,
    messages: list[dict[str, str]],
    format_schema: dict[str, Any] | None = None,
) -> str:
    """POST /api/chat; return assistant message content."""
    url = f"{settings.llm_base_url.rstrip('/')}/api/chat"
    body: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "stream": False,
        "think": settings.llm_think,
        "options": {
            "temperature": settings.llm_temperature,
            "num_predict": (
                settings.llm_sql_num_predict
                if format_schema == OLLAMA_SQL_DRAFT_FORMAT
                else settings.llm_summary_num_predict
            ),
        },
    }
    if format_schema is not None:
        body["format"] = format_schema

    timeout = httpx.Timeout(settings.llm_timeout_seconds)
    with httpx.Client(timeout=timeout) as client:
        r = client.post(url, json=body)
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            detail = _ollama_error_body(e.response)
            if detail:
                hint = ""
                if e.response.status_code == 404 and "not found" in detail.lower():
                    hint = (
                        f" If the model name is wrong, run `ollama pull {settings.llm_model}` "
                        "or set DCC_LLM_MODEL to a model from `ollama list`."
                    )
                raise httpx.HTTPStatusError(
                    f"{e} — {detail}{hint}",
                    request=e.request,
                    response=e.response,
                ) from e
            raise
        data = r.json()
    msg = data.get("message") if isinstance(data, dict) else None
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content")
    return content if isinstance(content, str) else ""


def ollama_chat_stream(
    settings: Settings,
    messages: list[dict[str, str]],
    format_schema: dict[str, Any] | None = None,
) -> Iterator[str]:
    """Stream assistant content chunks from Ollama /api/chat (stream=True)."""
    url = f"{settings.llm_base_url.rstrip('/')}/api/chat"
    body: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "stream": True,
        "think": settings.llm_think,
        "options": {
            "temperature": settings.llm_temperature,
            "num_predict": settings.llm_summary_num_predict,
        },
    }
    if format_schema is not None:
        body["format"] = format_schema

    timeout = httpx.Timeout(settings.llm_timeout_seconds)
    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", url, json=body) as r:
            try:
                r.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = _ollama_error_body(e.response)
                if detail:
                    raise httpx.HTTPStatusError(
                        f"{e} — {detail}",
                        request=e.request,
                        response=e.response,
                    ) from e
                raise
            for line in r.iter_lines():
                if not line:
                    continue
                try:
                    obj: Any = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(obj, dict):
                    continue
                err = obj.get("error")
                if isinstance(err, str) and err.strip():
                    raise httpx.HTTPError(err.strip())
                msg_obj = obj.get("message")
                if isinstance(msg_obj, dict):
                    c = msg_obj.get("content")
                    if isinstance(c, str) and c:
                        yield c
