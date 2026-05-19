"""Tests for local LLM health probe."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx
import pytest

from app.config import Settings
from app.services.llm_health import check_llm_health


def test_check_llm_health_reachable(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://127.0.0.1:11434", llm_model="qwen3:4b")

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def get(self, url: str) -> httpx.Response:
            assert url.endswith("/api/tags")
            return httpx.Response(200, json={"models": []})

    monkeypatch.setattr(httpx, "Client", FakeClient)
    out = check_llm_health(settings)
    assert out.reachable is True
    assert out.model == "qwen3:4b"
    assert out.detail is None


def test_check_llm_health_non_200_json_error(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://127.0.0.1:11434", llm_model="x")

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def get(self, url: str) -> httpx.Response:
            return httpx.Response(500, json={"error": "something failed"})

    monkeypatch.setattr(httpx, "Client", FakeClient)
    out = check_llm_health(settings)
    assert out.reachable is False
    assert out.detail == "something failed"


def test_check_llm_health_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_model="m")

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def get(self, url: str) -> httpx.Response:
            raise httpx.TimeoutException("timeout", request=MagicMock())

    monkeypatch.setattr(httpx, "Client", FakeClient)
    out = check_llm_health(settings)
    assert out.reachable is False
    assert "Timed out" in (out.detail or "")


def test_check_llm_health_request_error(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_model="m")

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def get(self, url: str) -> httpx.Response:
            raise httpx.ConnectError("nope", request=MagicMock())

    monkeypatch.setattr(httpx, "Client", FakeClient)
    out = check_llm_health(settings)
    assert out.reachable is False
    assert out.detail == "Could not reach local LLM endpoint."


def test_check_llm_health_non_json_error_body(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://127.0.0.1:11434", llm_model="x")

    class FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def __enter__(self) -> FakeClient:
            return self

        def __exit__(self, *args: object) -> None:
            pass

        def get(self, url: str) -> httpx.Response:
            return httpx.Response(502, text="upstream failed")

    monkeypatch.setattr(httpx, "Client", FakeClient)
    out = check_llm_health(settings)
    assert out.reachable is False
    assert out.detail == "upstream failed"
