"""Agent tests."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from app.config import Settings
from app.models.api import AgentAskRequest
from app.services.agent import (
    OLLAMA_SQL_DRAFT_FORMAT,
    run_agent_ask_stream,
)
from app.services.agent.workflow_run import (
    _append_parse_retry,
    _draft_sql_once,
    _prepare_ask_preflight,
    _query_retry_reason,
    _summary_answer_events,
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


def test_ask_preflight_builds_messages_and_limit(registry_csv: DatasetRegistry) -> None:
    settings = Settings(agent_max_rows=50, query_max_rows=25)
    preflight, err = _prepare_ask_preflight(registry_csv, settings, AgentAskRequest(question="q"))
    assert err is None
    assert preflight is not None
    assert preflight.limit == 25
    assert [m["role"] for m in preflight.messages] == ["system", "user"]


def test_draft_sql_once_and_parse_retry_message() -> None:
    messages = [{"role": "user", "content": "q"}]

    result = _draft_sql_once(
        Settings(),
        messages,
        lambda *_args: json.dumps({"sql": "SELECT 1", "explanation": "ok"}),
    )
    assert result.draft is not None
    assert result.error is None

    _append_parse_retry(messages, "bad", "not json")
    assert messages[-2] == {"role": "assistant", "content": "bad"}
    assert "not json" in messages[-1]["content"]


def test_query_retry_reason_empty_and_sql_error() -> None:
    from app.models.api import QueryResult

    empty = QueryResult(columns=[], rows=[], row_count=0, truncated=False, error=None)
    assert _query_retry_reason(empty, "SELECT * FROM t WHERE x = 1", 0, 2)
    assert _query_retry_reason(empty, "SELECT * FROM t", 0, 2) is None
    failed = QueryResult(columns=[], rows=[], row_count=0, truncated=False, error="bad sql")
    assert _query_retry_reason(failed, "SELECT * FROM t", 0, 2) == "bad sql"


def test_summary_answer_events_streams_tokens_and_answer() -> None:
    from app.models.api import AgentSqlDraft, QueryResult

    qres = QueryResult(columns=[], rows=[{"x": 1}], row_count=1, truncated=False, error=None)
    draft = AgentSqlDraft(sql="SELECT 1", explanation="")

    events = list(
        _summary_answer_events(
            req=AgentAskRequest(question="q"),
            settings=Settings(),
            llm_settings=Settings(),
            draft=draft,
            qres=qres,
            emit_summary_tokens=True,
            ollama_call=lambda *_args: '{"answer":"unused"}',
            ollama_stream=lambda *_args: iter(['{"answer":"streamed"}']),
        )
    )

    assert [e["type"] for e in events] == ["token", "summary_answer"]
    assert events[-1]["data"]["answer"] == "streamed"


def test_summary_answer_events_falls_back_on_http_error() -> None:
    from app.models.api import AgentSqlDraft, QueryResult

    qres = QueryResult(columns=[], rows=[{"x": 1}], row_count=1, truncated=False, error=None)
    draft = AgentSqlDraft(sql="SELECT 1", explanation="")

    def fail(*_args):  # noqa: ANN202
        raise httpx.ReadTimeout("slow")

    events = list(
        _summary_answer_events(
            req=AgentAskRequest(question="q"),
            settings=Settings(),
            llm_settings=Settings(),
            draft=draft,
            qres=qres,
            emit_summary_tokens=False,
            ollama_call=fail,
            ollama_stream=lambda *_args: iter(()),
        )
    )
    assert events == [{"type": "summary_answer", "data": {"answer": "x: 1."}}]


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
    assert "unavailable" not in ev[-3]["data"]["answer"]
    assert ev[-3]["data"]["answer"]


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
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    turns = registry_csv.workspace.ask.list_turns( cid)
    assert len(turns) == 1
    assert turns[0]["question"] == "hello"


def test_run_agent_ask_stream_connect_error_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    turns = registry_csv.workspace.ask.list_turns( cid)
    assert len(turns) == 1
    assert turns[0]["error"]


def test_run_agent_ask_stream_http_error_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    assert registry_csv.workspace.ask.list_turns( cid)[0]["error"]


def test_run_agent_ask_stream_generic_error_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    assert registry_csv.workspace.ask.list_turns( cid)[0]["error"]


def test_run_agent_ask_stream_bad_json_persists_with_conversation(registry_csv: DatasetRegistry) -> None:
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    assert registry_csv.workspace.ask.list_turns( cid)[0]["error"]


def test_run_agent_ask_stream_sql_error_persists_turn(registry_csv: DatasetRegistry) -> None:
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    assert registry_csv.workspace.ask.list_turns( cid)[0]["error"]


def test_run_agent_ask_stream_summary_emits_turn_with_conversation(registry_csv: DatasetRegistry) -> None:
    
    conv = registry_csv.workspace.ask.create_conversation()
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
    assert registry_csv.workspace.ask.list_turns( cid)[0]["answer"] == "hi"
