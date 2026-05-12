"""Tests for Ask conversation persistence (ask_store)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.models.api import QueryResult
from app.services import ask_store
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@pytest.fixture()
def reg(tmp_path: Path) -> DatasetRegistry:
    csv = tmp_path / "x.csv"
    csv.write_text("a\n1\n")
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    reg.register_path(csv)
    return reg


def test_create_list_rename_delete_conversation(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    c = ask_store.create_conversation(con, title="Hello", dataset_ids=["ds_1"])
    assert c["title"] == "Hello"
    assert c["dataset_ids"] == ["ds_1"]
    lst = ask_store.list_conversations(con)
    assert len(lst) == 1
    assert ask_store.rename_conversation(con, c["conversation_id"], "Renamed")
    assert ask_store.get_conversation(con, c["conversation_id"])["title"] == "Renamed"
    assert ask_store.delete_conversation(con, c["conversation_id"])
    assert ask_store.get_conversation(con, c["conversation_id"]) is None
    assert ask_store.list_conversations(con) == []


def test_rename_conversation_missing_returns_false(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    assert not ask_store.rename_conversation(con, "nope", "x")


def test_delete_conversation_missing_returns_false(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    assert not ask_store.delete_conversation(con, "nope")


def test_append_turn_auto_title_and_list(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    c = ask_store.create_conversation(con)
    tid, seq = ask_store.append_turn(
        con,
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
    conv = ask_store.get_conversation(con, c["conversation_id"])
    assert conv["title"] == "What is the meaning"[:60]
    turns = ask_store.list_turns(con, c["conversation_id"])
    assert len(turns) == 1
    assert turns[0]["turn_id"] == tid
    assert turns[0]["answer"] == "42"


def test_delete_turn(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    c = ask_store.create_conversation(con)
    tid, _ = ask_store.append_turn(
        con,
        c["conversation_id"],
        "q",
        sql=None,
        explanation=None,
        answer=None,
        error="e",
        attempts=[{"stage": "x", "error": "e"}],
        query_result=None,
        model="m",
        elapsed_ms=1,
    )
    assert ask_store.delete_turn(con, c["conversation_id"], tid)
    assert ask_store.list_turns(con, c["conversation_id"]) == []
    assert not ask_store.delete_turn(con, c["conversation_id"], tid)


def test_last_turns_for_context_and_format(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    c = ask_store.create_conversation(con)
    qr = QueryResult(
        columns=[{"name": "n", "type": "INTEGER"}],
        rows=[{"n": 5}],
        row_count=1,
        truncated=False,
        error=None,
    )
    ask_store.append_turn(
        con,
        c["conversation_id"],
        "count rows",
        "SELECT 1",
        None,
        "ok",
        None,
        [],
        qr,
        "m",
        9,
    )
    hist = ask_store.last_turns_for_context(con, c["conversation_id"], n=3)
    assert len(hist) == 1
    assert hist[0]["question"] == "count rows"
    block = ask_store.format_history_block(hist)
    assert "count rows" in block
    assert "Turn 1" in block


def test_cap_result_json_truncates() -> None:
    big = QueryResult(
        columns=[{"name": "x", "type": "VARCHAR"}],
        rows=[{"x": "y" * 25_000}],
        row_count=1,
        truncated=False,
        error=None,
    )
    s = ask_store.cap_result_json(big)
    assert s is not None
    assert len(s) <= ask_store.RESULT_JSON_CAP
    assert "truncated" in s


def test_decode_dataset_ids_bad_json(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    cid = "abc"
    con.execute(
        "INSERT INTO dcc_ask_conversations (conversation_id, title, dataset_ids) VALUES (?, ?, ?)",
        [cid, "t", "not-json"],
    )
    row = ask_store.get_conversation(con, cid)
    assert row is not None
    assert row["dataset_ids"] is None


def test_list_turns_invalid_attempts_and_result_json(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    c = ask_store.create_conversation(con)
    con.execute(
        """
        INSERT INTO dcc_ask_turns (
          turn_id, conversation_id, seq, question, sql, explanation, answer, error,
          attempts_json, result_json, model, elapsed_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ["t1", c["conversation_id"], 1, "q", None, None, None, None, "not-json", "not-json", None, None],
    )
    turns = ask_store.list_turns(con, c["conversation_id"])
    assert turns[0]["attempts"] == []
    assert turns[0]["query_result"] is None


def test_ts_non_datetime() -> None:
    import app.services.ask_store as ask_mod

    assert ask_mod._ts(42) == "42"


def test_decode_dataset_ids_mixed_types(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    cid = "mix"
    con.execute(
        "INSERT INTO dcc_ask_conversations (conversation_id, title, dataset_ids) VALUES (?, ?, ?)",
        [cid, "t", "[1, \"a\"]"],
    )
    assert ask_store.get_conversation(con, cid)["dataset_ids"] is None


def test_format_history_error_only() -> None:
    block = ask_store.format_history_block(
        [
            {
                "question": "q",
                "sql": "SELECT 1",
                "error": "failed",
                "row_count": None,
                "preview": "",
            },
        ],
    )
    assert "Error: failed" in block


def test_last_turns_ignores_malformed_result_json(reg: DatasetRegistry) -> None:
    con = reg.workspace.connection
    c = ask_store.create_conversation(con)
    ask_store.append_turn(
        con,
        c["conversation_id"],
        "q",
        None,
        None,
        None,
        None,
        [],
        None,
        "m",
        1,
    )
    con.execute(
        "UPDATE dcc_ask_turns SET result_json = 'not-json{' WHERE conversation_id = ?",
        [c["conversation_id"]],
    )
    hist = ask_store.last_turns_for_context(con, c["conversation_id"])
    assert hist[0]["row_count"] is None
    assert hist[0]["preview"] == ""
