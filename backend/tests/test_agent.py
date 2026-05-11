"""Tests for local LLM agent (Ollama integration points mocked)."""

from __future__ import annotations

from pathlib import Path
import httpx
import pytest

from app.config import Settings
from app.models.api import AgentAskRequest, AgentAskResponse
from app.services.agent import (
    _pragma_column_summaries,
    _result_preview_for_summary,
    build_dataset_context,
    ollama_chat,
    parse_sql_draft,
    parse_summary_answer,
    run_agent_ask,
)
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


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


def test_parse_sql_draft_bad_json() -> None:
    d, err = parse_sql_draft("not-json")
    assert d is None
    assert err and "json" in err.lower()


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
    assert len(calls) == 2


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
        raise httpx.ConnectError("nope")

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
    settings = Settings()
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
    settings = Settings()
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
    settings = Settings()
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
