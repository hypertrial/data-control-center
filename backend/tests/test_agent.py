"""Tests for local LLM agent (Ollama integration points mocked)."""

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


def test_system_prompt_discourages_any_value_without_group_for_frequency() -> None:
    p = _system_prompt()
    assert "Most common" in p
    assert "GROUP BY the dimension column" in p
    assert "ANY_VALUE alone" in p


@pytest.fixture()
def registry_csv(tmp_path: Path) -> DatasetRegistry:
    csv = tmp_path / "rows.csv"
    csv.write_text("id,val\n1,10\n2,20\n")
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    reg.register_path(csv)
    return reg


def test_build_dataset_context_no_datasets(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "empty.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    ctx, err = build_dataset_context(reg, ws, None)
    assert ctx is None
    assert err and "No datasets are registered" in err


def test_build_dataset_context_filter_miss(registry_csv: DatasetRegistry) -> None:
    ws = registry_csv.workspace
    ctx, err = build_dataset_context(registry_csv, ws, ["ds_999"])
    assert ctx is None
    assert "dataset_ids filter" in (err or "")


def test_build_dataset_context_uses_profile_cache(registry_csv: DatasetRegistry) -> None:
    ds = registry_csv.list_all()[0]
    prof = {
        "column_profiles": [
            {"name": "id", "physical_type": "INT32"},
            {"name": "val", "physical_type": "FLOAT64"},
        ],
        "narrative": "Test narrative\nline2",
    }
    registry_csv.workspace.save_profile_cache(ds.dataset_id, prof)
    ctx, err = build_dataset_context(registry_csv, registry_csv.workspace, None)
    assert err is None
    assert ctx
    assert "id:INT32" in ctx
    assert "Test narrative" in ctx


def test_parse_sql_draft_ok() -> None:
    d, err = parse_sql_draft('{"sql":"SELECT 1","explanation":"x"}')
    assert err is None
    assert d and d.sql == "SELECT 1"


def test_parse_sql_draft_extracts_wrapped_json() -> None:
    d, err = parse_sql_draft(
        '<think>skip this</think>\n{"sql":"SELECT 1","explanation":"x"}'
    )
    assert err is None
    assert d and d.sql == "SELECT 1"


def test_parse_sql_draft_bad_json() -> None:
    d, err = parse_sql_draft("not-json")
    assert d is None
    assert err and "json" in err.lower()


def test_parse_sql_draft_empty_response() -> None:
    d, err = parse_sql_draft("")
    assert d is None
    assert err and "empty response" in err


def test_parse_sql_draft_not_object() -> None:
    d, err = parse_sql_draft('"string"')
    assert d is None
    assert err and "object" in err.lower()


def test_parse_sql_draft_validation_error() -> None:
    d, err = parse_sql_draft('{"sql":1}')
    assert d is None
    assert err and "Invalid SQL draft" in err


def test_parse_summary_answer_ok() -> None:
    a, err = parse_summary_answer('{"answer":"hello"}')
    assert err is None
    assert a == "hello"


def test_parse_summary_answer_extracts_wrapped_json() -> None:
    a, err = parse_summary_answer('text before {"answer":"hello"}')
    assert err is None
    assert a == "hello"


def test_parse_summary_answer_bad() -> None:
    a, err = parse_summary_answer("{}")
    assert a is None
    assert err


def test_parse_summary_answer_not_object() -> None:
    a, err = parse_summary_answer("[1]")
    assert a is None
    assert err and "object" in err.lower()


def test_result_preview_for_summary_truncates() -> None:
    big = {"x": "y" * 5000}
    s = _result_preview_for_summary(big, max_chars=50)
    assert "truncated" in s
    assert len(s) <= 50


def test_sql_retry_prompt_explains_group_by_aggregate_error() -> None:
    prompt = _sql_retry_prompt("Binder Error: GROUP BY clause cannot contain aggregates!")
    assert "aggregate functions in GROUP BY" in prompt
    assert "raw dimension columns" in prompt


def test_empty_result_retry_helpers() -> None:
    assert _should_retry_empty_result("SELECT * FROM t WHERE x IS NOT NULL")
    assert _should_retry_empty_result("SELECT x FROM t HAVING COUNT(*) > 1")
    assert not _should_retry_empty_result("SELECT * FROM t")
    assert "remove them" in _empty_result_retry_prompt()


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


def test_pragma_column_summaries_truncates(registry_csv: DatasetRegistry) -> None:
    cols = [f"c{i}" for i in range(85)]
    header = ",".join(cols)
    row = ",".join(["1"] * 85)
    p = registry_csv.list_all()[0].source_path.parent / "wide85.csv"
    p.write_text(f"{header}\n{row}\n")
    registry_csv.register_path(p)
    ds = registry_csv.list_all()[-1]
    out = _pragma_column_summaries(registry_csv.workspace.connection, ds.view_name, max_cols=80)
    assert any("more columns" in x for x in out)


def test_build_dataset_context_profile_column_overflow(registry_csv: DatasetRegistry) -> None:
    ds = registry_csv.list_all()[0]
    prof = {
        "column_profiles": [{"name": f"c{i}", "physical_type": "INT32"} for i in range(85)],
    }
    registry_csv.workspace.save_profile_cache(ds.dataset_id, prof)
    ctx, err = build_dataset_context(registry_csv, registry_csv.workspace, None)
    assert err is None
    assert ctx and "more columns" in ctx


def test_build_dataset_context_no_columns_resolved(
    registry_csv: DatasetRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.agent._pragma_column_summaries",
        lambda *a, **k: [],
    )
    registry_csv.workspace.delete_profile_cache(registry_csv.list_all()[0].dataset_id)
    ctx, err = build_dataset_context(registry_csv, registry_csv.workspace, None)
    assert err is None
    assert ctx and "(no columns resolved)" in ctx


def test_run_agent_no_datasets(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    out = run_agent_ask(reg, settings, AgentAskRequest(question="x"), ollama_call=lambda *a, **k: "")
    assert out.error and "No datasets" in out.error


def test_run_agent_ollama_connection_error_has_hint(registry_csv: DatasetRegistry) -> None:
    settings = Settings(llm_base_url="http://ollama.test", llm_model="qwen3:4b")

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        raise httpx.ConnectError("refused")

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=fake_ollama,
    )
    assert out.error
    assert "not reachable" in out.error
    assert "ollama pull qwen3:4b" in out.error


def test_run_agent_happy_path(registry_csv: DatasetRegistry) -> None:
    settings = Settings()
    vw = registry_csv.list_all()[0].view_name
    calls: list[int] = []

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        calls.append(len(messages))
        if len(calls) == 1:
            return f'{{"sql":"SELECT COUNT(*) AS n FROM {vw}","explanation":"count rows"}}'
        return '{"answer":"There are 2 rows."}'

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="How many rows?"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.answer and "2" in out.answer
    assert out.sql and vw in (out.sql or "")
    assert out.query_result and out.query_result.row_count >= 1
    assert len(calls) == 1


def test_run_agent_sql_retry_then_success(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2)

    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return '{"sql":"INSERT INTO foo SELECT 1","explanation":"bad"}'
        return f'{{"sql":"SELECT COUNT(*) AS n FROM {vw}","explanation":"fixed"}}'

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="count"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.query_result and not out.query_result.error


def test_run_agent_sql_fails_exhausted(registry_csv: DatasetRegistry) -> None:
    settings = Settings()
    vw = registry_csv.list_all()[0].view_name

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        return f'{{"sql":"SELECT not_a_column FROM {vw}","explanation":"x"}}'

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=fake_ollama,
    )
    assert out.error
    assert out.query_result and out.query_result.error


def test_run_agent_retries_empty_filtered_result(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return (
                f'{{"sql":"SELECT val FROM {vw} WHERE id IS NULL",'
                '"explanation":"filtered"}}'
            )
        assert "returned 0 rows" in messages[-1]["content"]
        return f'{{"sql":"SELECT val FROM {vw}","explanation":"unfiltered"}}'

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="show values"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.sql == f"SELECT val FROM {vw}"
    assert out.query_result and out.query_result.row_count == 2


def test_run_agent_does_not_retry_empty_unfiltered_result(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2)
    vw = registry_csv.list_all()[0].view_name
    calls = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal calls
        calls += 1
        return f'{{"sql":"SELECT val FROM {vw} LIMIT 0","explanation":"empty"}}'

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="show no rows"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.query_result and out.query_result.row_count == 0
    assert calls == 1


def test_run_agent_invalid_json_retries(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return "NOT JSON"
        return f'{{"sql":"SELECT 1 AS x FROM {vw}","explanation":"ok"}}'

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.answer


def test_run_agent_invalid_json_gives_up(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=1)

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=lambda *a, **k: "NOT JSON",
    )
    assert out.error and "json" in out.error.lower()


def test_run_agent_http_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings()

    def boom(*a, **k):  # noqa: ANN001
        raise httpx.ReadTimeout("slow")

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=boom,
    )
    assert out.error and "Ollama" in out.error


def test_run_agent_generic_exception(registry_csv: DatasetRegistry) -> None:
    settings = Settings()

    def boom(*a, **k):  # noqa: ANN001
        raise RuntimeError("x")

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=boom,
    )
    assert out.error and "Ollama request failed" in out.error


def test_run_agent_summary_bad_json(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=True)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return f'{{"sql":"SELECT COUNT(*) AS n FROM {vw}","explanation":"e"}}'
        return "not-summary-json"

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.answer and "Summarization issue" in out.answer


def test_run_agent_summary_http_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=True)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return f'{{"sql":"SELECT COUNT(*) AS n FROM {vw}","explanation":"e"}}'
        raise httpx.ReadTimeout("t")

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.answer and "Summarization unavailable" in out.answer


def test_run_agent_summary_oserror_fallback(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=True)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, messages, format_schema=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return f'{{"sql":"SELECT COUNT(*) AS n FROM {vw}","explanation":"e"}}'
        raise OSError("sum")

    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x"),
        ollama_call=fake_ollama,
    )
    assert not out.error
    assert out.answer and "Summarization unavailable" in out.answer


def test_agent_ask_http_endpoint(client, tmp_path, monkeypatch) -> None:
    def fake_run(r, s, b):  # noqa: ANN001
        return AgentAskResponse(model="m", answer="ok")

    monkeypatch.setattr("app.api.agent.run_agent_ask", fake_run)
    r = client.post("/api/agent/ask", json={"question": "hello"})
    assert r.status_code == 200
    assert r.json()["answer"] == "ok"


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


def test_run_agent_ask_stream_no_datasets(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "empty.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    events = list(
        run_agent_ask_stream(reg, settings, AgentAskRequest(question="q")),
    )
    assert [e["type"] for e in events] == ["meta", "stage", "error", "timing", "done"]


def test_run_agent_ask_stream_happy(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=False)
    vw = registry_csv.list_all()[0].view_name

    def fake_ollama(s, m, f=None):  # noqa: ANN001
        return json.dumps(
            {"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "e"},
        )

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=fake_ollama,
        ),
    )
    assert [e["type"] for e in ev] == [
        "meta",
        "stage",
        "stage",
        "stage",
        "sql",
        "query_result",
        "answer",
        "timing",
        "done",
    ]


def test_run_agent_ask_stream_summary_tokens(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=True)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, m, f=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if f == OLLAMA_SQL_DRAFT_FORMAT:
            return json.dumps(
                {"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "e"},
            )
        return '{"answer": "fallback"}'

    def fake_stream(s, m, f=None):  # noqa: ANN001
        yield '{"answer": "fromstream"}'

    evty = [e["type"] for e in run_agent_ask_stream(
        registry_csv,
        settings,
        AgentAskRequest(question="q"),
        ollama_call=fake_ollama,
        ollama_stream=fake_stream,
    )]
    assert "token" in evty
    assert "answer" in evty


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


def test_run_agent_ask_stream_connect_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings()

    def boom(*a, **k):  # noqa: ANN001
        raise httpx.ConnectError("nope")

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=boom,
        ),
    )
    err_ev = next(e for e in ev if e["type"] == "error")
    assert "Ollama" in err_ev["data"]["message"]
    assert ev[-1]["type"] == "done"
    assert ev[-2]["type"] == "timing"


def test_run_agent_ask_stream_http_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings()

    def boom(*a, **k):  # noqa: ANN001
        raise httpx.ReadTimeout("slow")

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=boom,
        ),
    )
    err_ev = next(e for e in ev if e["type"] == "error")
    assert "Ollama" in err_ev["data"]["message"]


def test_run_agent_ask_stream_generic_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings()

    def boom(*a, **k):  # noqa: ANN001
        raise RuntimeError("boom")

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=boom,
        ),
    )
    err_ev = next(e for e in ev if e["type"] == "error")
    assert "boom" in err_ev["data"]["message"]


def test_run_agent_ask_stream_bad_json_final(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=1)

    def bad(*a, **k):  # noqa: ANN001
        return "not-json"

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=bad,
        ),
    )
    assert ev[-1]["type"] == "done"
    assert ev[-2]["type"] == "timing"
    assert ev[-3]["type"] == "error"


def test_run_agent_ask_stream_sql_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=1)

    def bad(*a, **k):  # noqa: ANN001
        return json.dumps({"sql": "SELECT * FROM totally_missing_view LIMIT 1", "explanation": ""})

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=bad,
        ),
    )
    assert ev[-1]["type"] == "done"
    assert ev[-2]["type"] == "timing"
    assert ev[-3]["type"] == "error"
    assert "message" in ev[-3]["data"]


def test_run_agent_ask_stream_empty_then_ok(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2, agent_summarize_with_llm=False)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake(s, m, f=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return json.dumps(
                {"sql": f"SELECT * FROM {vw} WHERE 1 = 0", "explanation": ""},
            )
        return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": ""})

    evty = [e["type"] for e in run_agent_ask_stream(
        registry_csv,
        settings,
        AgentAskRequest(question="q"),
        ollama_call=fake,
    )]
    assert evty[0] == "meta"
    assert "sql_attempt" in evty
    assert evty[-2:] == ["timing", "done"]
    assert evty[-3] == "answer"


def test_run_agent_ask_stream_summary_http_error(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=True)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, m, f=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if f == OLLAMA_SQL_DRAFT_FORMAT:
            return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "e"})
        return '{"answer": "x"}'

    def bad_stream(*a, **k):  # noqa: ANN001
        raise httpx.ReadTimeout("s")

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q"),
            ollama_call=fake_ollama,
            ollama_stream=bad_stream,
        ),
    )
    assert ev[-3]["type"] == "answer"
    assert "unavailable" in ev[-3]["data"]["answer"]


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


def test_run_agent_ask_stream_parse_retry_then_ok(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2, agent_summarize_with_llm=False)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake(s, m, f=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return "not-json"
        return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": ""})

    evty = [e["type"] for e in run_agent_ask_stream(
        registry_csv,
        settings,
        AgentAskRequest(question="q"),
        ollama_call=fake,
    )]
    assert evty[:2] == ["meta", "stage"]
    assert evty[-2:] == ["timing", "done"]


def test_run_agent_ask_stream_sql_retry_then_ok(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_sql_attempts=2, agent_summarize_with_llm=False)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake(s, m, f=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if n == 1:
            return json.dumps(
                {"sql": "SELECT * FROM totally_missing_view LIMIT 1", "explanation": ""},
            )
        return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "fixed"})

    evty = [e["type"] for e in run_agent_ask_stream(
        registry_csv,
        settings,
        AgentAskRequest(question="q"),
        ollama_call=fake,
    )]
    assert "sql_attempt" in evty
    assert evty[-2:] == ["timing", "done"]


def test_run_agent_ask_stream_conversation_not_found(registry_csv: DatasetRegistry) -> None:
    settings = Settings()
    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q", conversation_id="nope"),
        ),
    )
    assert ev[1]["type"] == "error"
    assert "Conversation" in ev[1]["data"]["message"]


def test_run_agent_ask_conversation_not_found(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=False)
    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x", conversation_id="bad"),
    )
    assert out.error and "Conversation" in out.error


def test_run_agent_ask_stream_emits_turn_when_persisting(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]
    settings = Settings(agent_summarize_with_llm=False)
    vw = registry_csv.list_all()[0].view_name

    def fake_ollama(s, m, f=None):  # noqa: ANN001
        return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "e"})

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="hello", conversation_id=cid),
            ollama_call=fake_ollama,
        ),
    )
    assert any(e["type"] == "turn" for e in ev)
    turns = ask_store.list_turns(con, cid)
    assert len(turns) == 1
    assert turns[0]["question"] == "hello"


def test_run_agent_ask_second_turn_includes_history(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    settings = Settings(agent_summarize_with_llm=False)
    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]
    vw = registry_csv.list_all()[0].view_name

    def r1(s, m, f=None):  # noqa: ANN001
        return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "a"})

    out1 = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="first question", conversation_id=cid),
        ollama_call=r1,
    )
    assert not out1.error

    captured: list[list[dict[str, str]]] = []

    def r2(s, m, f=None):  # noqa: ANN001
        captured.append(list(m))
        return json.dumps({"sql": f"SELECT COUNT(*) AS n FROM {vw}", "explanation": "b"})

    out2 = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="second question", conversation_id=cid),
        ollama_call=r2,
    )
    assert not out2.error
    user_contents = [x["content"] for x in captured[0] if x["role"] == "user"]
    assert any("first question" in uc for uc in user_contents)
    assert any("Recent conversation" in uc or "Turn 1" in uc for uc in user_contents)


def test_run_agent_ask_skips_history_when_disabled(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    settings = Settings(agent_summarize_with_llm=False)
    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]
    vw = registry_csv.list_all()[0].view_name

    def r1(s, m, f=None):  # noqa: ANN001
        return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "a"})

    run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="only turn", conversation_id=cid),
        ollama_call=r1,
    )

    captured: list[list[dict[str, str]]] = []

    def r2(s, m, f=None):  # noqa: ANN001
        captured.append(list(m))
        return json.dumps({"sql": f"SELECT COUNT(*) AS n FROM {vw}", "explanation": "b"})

    run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="next", conversation_id=cid, use_history=False),
        ollama_call=r2,
    )
    last_user = next(c["content"] for c in reversed(captured[0]) if c["role"] == "user")
    assert "Recent conversation" not in last_user


def test_run_agent_ask_stream_connect_error_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]

    def boom(*a, **k):  # noqa: ANN001
        raise httpx.ConnectError("nope")

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            Settings(),
            AgentAskRequest(question="q", conversation_id=cid),
            ollama_call=boom,
        ),
    )
    assert any(e["type"] == "turn" for e in ev)
    turns = ask_store.list_turns(con, cid)
    assert len(turns) == 1
    assert turns[0]["error"]


def test_run_agent_ask_stream_http_error_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]

    def boom(*a, **k):  # noqa: ANN001
        raise httpx.ReadTimeout("slow")

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            Settings(),
            AgentAskRequest(question="q", conversation_id=cid),
            ollama_call=boom,
        ),
    )
    assert any(e["type"] == "turn" for e in ev)
    assert ask_store.list_turns(con, cid)[0]["error"]


def test_run_agent_ask_stream_generic_error_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]

    def boom(*a, **k):  # noqa: ANN001
        raise RuntimeError("x")

    list(
        run_agent_ask_stream(
            registry_csv,
            Settings(),
            AgentAskRequest(question="q", conversation_id=cid),
            ollama_call=boom,
        ),
    )
    assert ask_store.list_turns(con, cid)[0]["error"]


def test_run_agent_ask_stream_bad_json_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]

    def bad(*a, **k):  # noqa: ANN001
        return "not-json"

    list(
        run_agent_ask_stream(
            registry_csv,
            Settings(agent_sql_attempts=1),
            AgentAskRequest(question="q", conversation_id=cid),
            ollama_call=bad,
        ),
    )
    assert ask_store.list_turns(con, cid)[0]["error"]


def test_run_agent_ask_stream_sql_error_persists_turn(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]

    def bad(*a, **k):  # noqa: ANN001
        return json.dumps({"sql": "SELECT * FROM totally_missing_view LIMIT 1", "explanation": ""})

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            Settings(agent_sql_attempts=1),
            AgentAskRequest(question="q", conversation_id=cid),
            ollama_call=bad,
        ),
    )
    assert any(e["type"] == "turn" for e in ev)
    assert ask_store.list_turns(con, cid)[0]["error"]


def test_run_agent_ask_stream_summary_emits_turn_with_conversation(registry_csv: DatasetRegistry) -> None:
    from app.services import ask_store

    con = registry_csv.workspace.connection
    conv = ask_store.create_conversation(con)
    cid = conv["conversation_id"]
    settings = Settings(agent_summarize_with_llm=True)
    vw = registry_csv.list_all()[0].view_name
    n = 0

    def fake_ollama(s, m, f=None):  # noqa: ANN001
        nonlocal n
        n += 1
        if f == OLLAMA_SQL_DRAFT_FORMAT:
            return json.dumps({"sql": f"SELECT * FROM {vw} LIMIT 1", "explanation": "e"})
        return '{"answer": "hi"}'

    def fake_stream(s, m, f=None):  # noqa: ANN001
        yield '{"answer": "hi"}'

    ev = list(
        run_agent_ask_stream(
            registry_csv,
            settings,
            AgentAskRequest(question="q", conversation_id=cid),
            ollama_call=fake_ollama,
            ollama_stream=fake_stream,
        ),
    )
    assert any(e["type"] == "turn" for e in ev)
    assert ask_store.list_turns(con, cid)[0]["answer"] == "hi"