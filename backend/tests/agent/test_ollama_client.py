"""Agent tests."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.models.api import AgentAskRequest, AgentAskResponse
from app.services.agent import (
    OLLAMA_SQL_DRAFT_FORMAT,
    OLLAMA_SUMMARY_FORMAT,
    _empty_result_retry_prompt,
    _ollama_error_body,
    _pragma_column_summaries,
    _result_preview_for_summary,
    _should_retry_empty_result,
    _sql_retry_prompt,
    _system_prompt,
    build_dataset_context,
    ollama_chat,
    ollama_chat_stream,
    parse_sql_draft,
    parse_summary_answer,
    run_agent_ask,
    run_agent_ask_stream,
)
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace

def test_ollama_chat_parses_message(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test")

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"message": {"content": '{"sql":"SELECT 1","explanation":""}'}}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            assert "/api/chat" in url
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    out = ollama_chat(settings, [{"role": "user", "content": "hi"}], None)
    assert '"sql"' in out


def test_ollama_chat_empty_when_bad_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test")

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"message": {"content": None}}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    assert ollama_chat(settings, [{"role": "user", "content": "hi"}], None) == ""


def test_ollama_chat_non_dict_response(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test")

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return []

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    assert ollama_chat(settings, [{"role": "user", "content": "hi"}], None) == ""


def test_ollama_chat_omits_format_when_none(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test")
    captured: dict = {}

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"message": {"content": "{}"}}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            captured["body"] = json or {}
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    ollama_chat(settings, [{"role": "user", "content": "hi"}], None)
    assert "format" not in captured["body"]


def test_ollama_chat_includes_format_when_set(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test")
    captured: dict = {}

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"message": {"content": "{}"}}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            captured["body"] = json or {}
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    fmt = {"type": "object"}
    ollama_chat(settings, [{"role": "user", "content": "hi"}], fmt)
    assert captured["body"].get("format") == fmt


def test_ollama_chat_http_status_error(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test")

    class FakeResp:
        def raise_for_status(self) -> None:
            raise httpx.HTTPStatusError(
                "bad",
                request=httpx.Request("POST", "http://x"),
                response=httpx.Response(500, request=httpx.Request("POST", "http://x")),
            )

        def json(self) -> dict:
            return {}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    with pytest.raises(httpx.HTTPStatusError):
        ollama_chat(settings, [{"role": "user", "content": "hi"}], None)


def test_ollama_error_body_non_json_response_text() -> None:
    req = httpx.Request("POST", "http://x")
    r = httpx.Response(500, request=req, content=b"upstream refused")
    assert _ollama_error_body(r) == "upstream refused"


def test_ollama_chat_model_not_found_includes_hint(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test", llm_model="qwen3:8b")
    req = httpx.Request("POST", "http://ollama.test/api/chat")

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            return httpx.Response(
                404,
                request=req,
                json={"error": "model 'qwen3:8b' not found"},
            )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    with pytest.raises(httpx.HTTPStatusError) as err:
        ollama_chat(settings, [{"role": "user", "content": "hi"}], None)
    msg = str(err.value)
    assert "model 'qwen3:8b' not found" in msg
    assert "ollama pull" in msg
    assert "DCC_LLM_MODEL" in msg


def test_ollama_chat_sends_generation_options(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(
        llm_base_url="http://ollama.test",
        llm_sql_num_predict=123,
        llm_summary_num_predict=45,
        llm_temperature=0.2,
    )
    seen: dict[str, object] = {}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            seen["json"] = json
            req = httpx.Request("POST", url)
            return httpx.Response(
                200,
                request=req,
                json={"message": {"content": "{}"}},
            )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    ollama_chat(settings, [{"role": "user", "content": "hi"}], OLLAMA_SQL_DRAFT_FORMAT)
    body = seen["json"]
    assert isinstance(body, dict)
    assert body["think"] is False
    assert body["options"] == {"temperature": 0.2, "num_predict": 123}


def test_ollama_chat_sends_summary_num_predict(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(llm_base_url="http://ollama.test", llm_summary_num_predict=45)
    seen: dict[str, object] = {}

    class FakeClient:
        def __init__(self, *a, **k) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, json=None):  # noqa: ANN001
            seen["json"] = json
            req = httpx.Request("POST", url)
            return httpx.Response(
                200,
                request=req,
                json={"message": {"content": "{}"}},
            )

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: FakeClient())
    ollama_chat(settings, [{"role": "user", "content": "hi"}], OLLAMA_SUMMARY_FORMAT)
    body = seen["json"]
    assert isinstance(body, dict)
    assert body["options"]["num_predict"] == 45


def test_ollama_chat_stream_yields_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            pass

        def iter_lines(self):
            yield json.dumps({"message": {"content": "x"}})

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    assert list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], None)) == [
        "x",
    ]


def test_ollama_chat_stream_http_no_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            req = httpx.Request("POST", "http://127.0.0.1/x")
            resp = httpx.Response(500, request=req, text="")
            raise httpx.HTTPStatusError("err", request=req, response=resp)

        def iter_lines(self):
            yield ""

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    with pytest.raises(httpx.HTTPStatusError):
        list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], None))


def test_ollama_chat_stream_error_field(monkeypatch: pytest.MonkeyPatch) -> None:
    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            pass

        def iter_lines(self):
            yield json.dumps({"error": "model missing"})

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    with pytest.raises(httpx.HTTPError):
        list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], None))


def test_ollama_chat_stream_skips_garbage_and_non_dict(monkeypatch: pytest.MonkeyPatch) -> None:
    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            pass

        def iter_lines(self):
            yield "not-json"
            yield "[1, 2]"
            yield json.dumps({"message": {"content": "ok"}})

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    assert list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], None)) == ["ok"]


def test_ollama_chat_stream_passes_format_schema(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            pass

        def iter_lines(self):
            yield json.dumps({"message": {"content": "z"}})

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            captured["body"] = json or {}
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    fmt = {"type": "object", "properties": {"answer": {"type": "string"}}}
    assert list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], fmt)) == ["z"]
    assert isinstance(captured["body"], dict)
    assert captured["body"].get("format") == fmt


def test_ollama_chat_stream_http_error_includes_json_detail(monkeypatch: pytest.MonkeyPatch) -> None:
    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            req = httpx.Request("POST", "http://127.0.0.1/x")
            resp = httpx.Response(
                404,
                request=req,
                json={"error": "pull the model first"},
            )
            raise httpx.HTTPStatusError("err", request=req, response=resp)

        def iter_lines(self):
            yield ""

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    with pytest.raises(httpx.HTTPStatusError) as ei:
        list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], None))
    assert "pull the model first" in str(ei.value)


def test_ollama_chat_stream_skips_blank_lines(monkeypatch: pytest.MonkeyPatch) -> None:
    class StreamCtx:
        def __enter__(self) -> StreamCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def raise_for_status(self) -> None:
            pass

        def iter_lines(self):
            yield ""
            yield json.dumps({"message": {"content": "hi"}})

    class ClientCtx:
        def __enter__(self) -> ClientCtx:
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def stream(self, method: str, url: str, json: object | None = None) -> StreamCtx:
            return StreamCtx()

    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ClientCtx())
    settings = Settings()
    assert list(ollama_chat_stream(settings, [{"role": "user", "content": "z"}], None)) == ["hi"]

