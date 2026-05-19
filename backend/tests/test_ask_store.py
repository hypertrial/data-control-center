"""Tests for Ask conversation persistence (Workspace.ask)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.models.api import QueryResult, QueryResultColumn
from app.services.ask_store import AskStore, _ts, cap_result_json
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@pytest.fixture()
def reg(tmp_path: Path) -> DatasetRegistry:
    csv = tmp_path / "x.csv"
    csv.write_text("a\n1\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    reg.register_path(csv)
    return reg


def test_create_list_rename_delete_conversation(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation(title="Hello", dataset_ids=["ds_1"])
    assert c["title"] == "Hello"
    assert c["dataset_ids"] == ["ds_1"]
    lst = ask.list_conversations()
    assert len(lst) == 1
    assert ask.rename_conversation(c["conversation_id"], "Renamed")
    assert ask.get_conversation(c["conversation_id"])["title"] == "Renamed"
    assert ask.delete_conversation(c["conversation_id"])
    assert ask.get_conversation(c["conversation_id"]) is None
    assert ask.list_conversations() == []


def test_rename_conversation_missing_returns_false(reg: DatasetRegistry) -> None:
    assert not reg.workspace.ask.rename_conversation("nope", "x")


def test_delete_conversation_missing_returns_false(reg: DatasetRegistry) -> None:
    assert not reg.workspace.ask.delete_conversation("nope")


def test_append_turn_auto_title_and_list(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    tid, seq = ask.append_turn(
        c["conversation_id"],
        "What is the meaning",
        sql="SELECT 1",
        explanation=None,
        answer="42",
        error=None,
        attempts=[],
        query_result=None,
        model="m",
        elapsed_ms=10,
    )
    assert seq == 1
    conv = ask.get_conversation(c["conversation_id"])
    assert conv["title"] == "What is the meaning"[:60]
    turns = ask.list_turns(c["conversation_id"])
    assert len(turns) == 1
    assert turns[0]["turn_id"] == tid
    assert turns[0]["answer"] == "42"


def test_delete_turn(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    tid, _ = ask.append_turn(
        c["conversation_id"],
        "q",
        sql=None,
        explanation=None,
        answer=None,
        error=None,
        attempts=[],
        query_result=None,
        model=None,
        elapsed_ms=None,
    )
    assert ask.delete_turn(c["conversation_id"], tid)
    assert ask.list_turns(c["conversation_id"]) == []
    assert not ask.delete_turn(c["conversation_id"], tid)


def test_last_turns_and_history_block(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    for i in range(4):
        ask.append_turn(
            c["conversation_id"],
            f"q{i}",
            sql=None,
            explanation=None,
            answer=f"a{i}",
            error=None,
            attempts=[],
            query_result=None,
            model=None,
            elapsed_ms=None,
        )
    hist = ask.last_turns_for_context(c["conversation_id"], n=3)
    assert len(hist) == 3
    block = AskStore.format_history_block(hist)
    assert "Turn 1" in block


def test_cap_result_json_truncates() -> None:
    big = QueryResult(columns=[], rows=[{"x": "y" * 5000}], row_count=1, error=None, truncated=False)
    s = cap_result_json(big)
    assert s is not None
    assert len(s) <= 8000 + 32


def test_get_conversation_row_shape(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation(title="T", dataset_ids=["ds_1", "ds_2"])
    cid = c["conversation_id"]
    row = ask.get_conversation(cid)
    assert row is not None
    assert row["dataset_ids"] == ["ds_1", "ds_2"]


def test_list_turns_order(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    ask.append_turn(
        c["conversation_id"],
        "first",
        sql=None,
        explanation=None,
        answer="1",
        error=None,
        attempts=[],
        query_result=None,
        model=None,
        elapsed_ms=None,
    )
    turns = ask.list_turns(c["conversation_id"])
    assert turns[0]["question"] == "first"


def test_create_conversation_null_dataset_ids(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    cid = c["conversation_id"]
    assert ask.get_conversation(cid)["dataset_ids"] is None


def test_format_history_block_empty() -> None:
    block = AskStore.format_history_block([])
    assert block == ""


def test_ts_string_fallback() -> None:
    assert _ts("2020-01-01T00:00:00") == "2020-01-01T00:00:00"


def test_last_turns_for_context_sql_error_preview(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    ask.append_turn(
        c["conversation_id"],
        "q",
        sql="SELECT 1",
        explanation=None,
        answer=None,
        error="bad",
        attempts=[{"sql": "SELECT 1", "error": "bad", "attempt": 1}],
        query_result=None,
        model="m",
        elapsed_ms=1,
    )
    hist = ask.last_turns_for_context(c["conversation_id"])
    assert hist[0]["error"] == "bad"


def test_get_conversation_invalid_dataset_ids_json(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    con.execute(
        "INSERT INTO dcc_ask_conversations (conversation_id, title, dataset_ids) VALUES (?, ?, ?)",
        ["bad1", "T", "not-json"],
    )
    assert reg.workspace.ask.get_conversation("bad1")["dataset_ids"] is None
    con.execute(
        "INSERT INTO dcc_ask_conversations (conversation_id, title, dataset_ids) VALUES (?, ?, ?)",
        ["bad2", "T", "[1, 2]"],
    )
    assert reg.workspace.ask.get_conversation("bad2")["dataset_ids"] is None


def test_list_turns_ignores_malformed_json_fields(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    tid = "turn_bad_json"
    con = reg.workspace.connection
    con.execute(
        """
        INSERT INTO dcc_ask_turns (
          turn_id, conversation_id, seq, question, sql, explanation, answer, error,
          attempts_json, result_json, model, elapsed_ms
        ) VALUES (?, ?, 1, 'q', NULL, NULL, NULL, NULL, ?, ?, NULL, NULL)
        """,
        [tid, c["conversation_id"], "{not-json", "{also-bad"],
    )
    turns = ask.list_turns(c["conversation_id"])
    row = next(t for t in turns if t["turn_id"] == tid)
    assert row["attempts"] == []
    assert row["query_result"] is None


def test_last_turns_for_context_row_preview_and_bad_blob(reg: DatasetRegistry) -> None:
    ask = reg.workspace.ask
    c = ask.create_conversation()
    qres = QueryResult(
        columns=[QueryResultColumn(name="a"), QueryResultColumn(name="b")],
        rows=[{"a": 1, "b": 2, "c": 3}],
        row_count=1,
        error=None,
        truncated=False,
    )
    ask.append_turn(
        c["conversation_id"],
        "ok",
        sql="SELECT 1",
        explanation=None,
        answer=None,
        error=None,
        attempts=[],
        query_result=qres,
        model=None,
        elapsed_ms=None,
    )
    con = reg.workspace.connection
    con.execute(
        """
        INSERT INTO dcc_ask_turns (
          turn_id, conversation_id, seq, question, sql, explanation, answer, error,
          attempts_json, result_json, model, elapsed_ms
        ) VALUES ('t2', ?, 2, 'q2', NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL)
        """,
        [c["conversation_id"], "not-json"],
    )
    hist = ask.last_turns_for_context(c["conversation_id"], n=2)
    assert hist[0]["row_count"] == 1
    assert "First row" in AskStore.format_history_block(hist)


def test_format_history_block_includes_error_line() -> None:
    block = AskStore.format_history_block(
        [{"question": "why", "sql": "SELECT 1", "error": "nope", "row_count": None, "preview": ""}],
    )
    assert "Error: nope" in block


def test_cap_result_json_small_payload() -> None:
    small = QueryResult(
        columns=[QueryResultColumn(name="x")],
        rows=[{"x": 1}],
        row_count=1,
        error=None,
        truncated=False,
    )
    raw = cap_result_json(small)
    assert raw is not None
    assert "truncated json" not in raw


def test_cap_result_json_truncates_large_payload() -> None:
    huge = QueryResult(
        columns=[QueryResultColumn(name="x")],
        rows=[{"x": "z" * 9000}],
        row_count=1,
        error=None,
        truncated=False,
    )
    raw = cap_result_json(huge)
    assert raw is not None
    assert raw.endswith("... (truncated json)")
