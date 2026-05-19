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

def test_run_agent_ask_stream_no_datasets(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "empty.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
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

