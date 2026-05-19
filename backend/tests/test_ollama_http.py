"""Tests for shared Ollama HTTP error parsing."""

from __future__ import annotations

import httpx

from app.services.ollama_http import DETAIL_MAX, parse_ollama_error_detail


def test_parse_ollama_error_detail_json_error() -> None:
    response = httpx.Response(404, json={"error": "model not found"})
    assert parse_ollama_error_detail(response) == "model not found"


def test_parse_ollama_error_detail_json_error_truncated() -> None:
    long_err = "x" * (DETAIL_MAX + 50)
    response = httpx.Response(500, json={"error": long_err})
    out = parse_ollama_error_detail(response)
    assert len(out) == DETAIL_MAX
    assert out == long_err[:DETAIL_MAX]


def test_parse_ollama_error_detail_plain_text() -> None:
    response = httpx.Response(502, text="upstream failed")
    assert parse_ollama_error_detail(response) == "upstream failed"


def test_parse_ollama_error_detail_empty_body() -> None:
    response = httpx.Response(500, text="")
    assert parse_ollama_error_detail(response) == ""


def test_parse_ollama_error_detail_invalid_json_uses_text() -> None:
    response = httpx.Response(500, content=b"not json", headers={"content-type": "text/plain"})
    assert parse_ollama_error_detail(response) == "not json"
