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

def test_run_agent_no_datasets(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
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


def test_run_agent_ask_conversation_not_found(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_summarize_with_llm=False)
    out = run_agent_ask(
        registry_csv,
        settings,
        AgentAskRequest(question="x", conversation_id="bad"),
    )
    assert out.error and "Conversation" in out.error


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

