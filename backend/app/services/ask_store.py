"""Persistent Ask conversations and turns (workspace DuckDB)."""

from __future__ import annotations

import json
import uuid
from typing import Any

import duckdb

from app.models.api import QueryResult

RESULT_JSON_CAP = 8000
_DEFAULT_TITLE = "New conversation"


def _encode_dataset_ids(dataset_ids: list[str] | None) -> str | None:
    if dataset_ids is None:
        return None
    return json.dumps(dataset_ids)


def _decode_dataset_ids(raw: str | None) -> list[str] | None:
    if raw is None or raw == "":
        return None
    try:
        v = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if isinstance(v, list) and all(isinstance(x, str) for x in v):
        return v
    return None


def _ts(row_val: Any) -> str:
    if hasattr(row_val, "isoformat"):
        return row_val.isoformat()
    return str(row_val)


def cap_result_json(qres: QueryResult | None) -> str | None:
    if qres is None:
        return None
    raw = json.dumps(qres.model_dump(mode="json"), default=str)
    if len(raw) <= RESULT_JSON_CAP:
        return raw
    return raw[: RESULT_JSON_CAP - 24] + '\n... (truncated json)'


def create_conversation(
    con: duckdb.DuckDBPyConnection,
    title: str | None = None,
    dataset_ids: list[str] | None = None,
) -> dict[str, Any]:
    cid = uuid.uuid4().hex
    t = (title or _DEFAULT_TITLE).strip() or _DEFAULT_TITLE
    did = _encode_dataset_ids(dataset_ids)
    con.execute(
        """
        INSERT INTO dcc_ask_conversations (conversation_id, title, dataset_ids)
        VALUES (?, ?, ?)
        """,
        [cid, t, did],
    )
    row = con.execute(
        """
        SELECT conversation_id, title, dataset_ids, created_at, updated_at
        FROM dcc_ask_conversations WHERE conversation_id = ?
        """,
        [cid],
    ).fetchone()
    assert row is not None
    return {
        "conversation_id": row[0],
        "title": row[1],
        "dataset_ids": _decode_dataset_ids(row[2]),
        "created_at": _ts(row[3]),
        "updated_at": _ts(row[4]),
    }


def get_conversation(con: duckdb.DuckDBPyConnection, conversation_id: str) -> dict[str, Any] | None:
    row = con.execute(
        """
        SELECT conversation_id, title, dataset_ids, created_at, updated_at
        FROM dcc_ask_conversations WHERE conversation_id = ?
        """,
        [conversation_id],
    ).fetchone()
    if not row:
        return None
    return {
        "conversation_id": row[0],
        "title": row[1],
        "dataset_ids": _decode_dataset_ids(row[2]),
        "created_at": _ts(row[3]),
        "updated_at": _ts(row[4]),
    }


def list_conversations(con: duckdb.DuckDBPyConnection, limit: int = 100) -> list[dict[str, Any]]:
    lim = max(1, min(limit, 500))
    rows = con.execute(
        f"""
        SELECT conversation_id, title, dataset_ids, created_at, updated_at
        FROM dcc_ask_conversations
        ORDER BY updated_at DESC
        LIMIT {lim}
        """
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "conversation_id": r[0],
                "title": r[1],
                "dataset_ids": _decode_dataset_ids(r[2]),
                "created_at": _ts(r[3]),
                "updated_at": _ts(r[4]),
            }
        )
    return out


def rename_conversation(con: duckdb.DuckDBPyConnection, conversation_id: str, title: str) -> bool:
    cur = con.execute(
        "SELECT conversation_id FROM dcc_ask_conversations WHERE conversation_id = ?",
        [conversation_id],
    ).fetchone()
    if not cur:
        return False
    con.execute(
        """
        UPDATE dcc_ask_conversations
        SET title = ?, updated_at = now() WHERE conversation_id = ?
        """,
        [title.strip(), conversation_id],
    )
    return True


def delete_conversation(con: duckdb.DuckDBPyConnection, conversation_id: str) -> bool:
    cur = con.execute(
        "SELECT conversation_id FROM dcc_ask_conversations WHERE conversation_id = ?",
        [conversation_id],
    ).fetchone()
    if not cur:
        return False
    con.execute("DELETE FROM dcc_ask_turns WHERE conversation_id = ?", [conversation_id])
    con.execute("DELETE FROM dcc_ask_conversations WHERE conversation_id = ?", [conversation_id])
    return True


def delete_turn(con: duckdb.DuckDBPyConnection, conversation_id: str, turn_id: str) -> bool:
    row = con.execute(
        """
        SELECT turn_id FROM dcc_ask_turns
        WHERE conversation_id = ? AND turn_id = ?
        """,
        [conversation_id, turn_id],
    ).fetchone()
    if not row:
        return False
    con.execute(
        "DELETE FROM dcc_ask_turns WHERE conversation_id = ? AND turn_id = ?",
        [conversation_id, turn_id],
    )
    con.execute(
        "UPDATE dcc_ask_conversations SET updated_at = now() WHERE conversation_id = ?",
        [conversation_id],
    )
    return True


def _next_seq(con: duckdb.DuckDBPyConnection, conversation_id: str) -> int:
    row = con.execute(
        "SELECT COALESCE(MAX(seq), 0) + 1 FROM dcc_ask_turns WHERE conversation_id = ?",
        [conversation_id],
    ).fetchone()
    return int(row[0]) if row else 1


def append_turn(
    con: duckdb.DuckDBPyConnection,
    conversation_id: str,
    question: str,
    sql: str | None,
    explanation: str | None,
    answer: str | None,
    error: str | None,
    attempts: list[dict[str, Any]],
    query_result: QueryResult | None,
    model: str | None,
    elapsed_ms: int | None,
) -> tuple[str, int]:
    """Insert turn; bump conversation updated_at; auto-title first question."""
    seq = _next_seq(con, conversation_id)
    tid = uuid.uuid4().hex
    attempts_json = json.dumps(attempts, default=str)
    result_json = cap_result_json(query_result)
    con.execute(
        """
        INSERT INTO dcc_ask_turns (
          turn_id, conversation_id, seq, question, sql, explanation, answer, error,
          attempts_json, result_json, model, elapsed_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            tid,
            conversation_id,
            seq,
            question,
            sql,
            explanation,
            answer,
            error,
            attempts_json,
            result_json,
            model,
            elapsed_ms,
        ],
    )
    conv = get_conversation(con, conversation_id)
    if conv and conv["title"] == _DEFAULT_TITLE and question.strip():
        short = question.strip()[:60]
        con.execute(
            """
            UPDATE dcc_ask_conversations
            SET title = ?, updated_at = now() WHERE conversation_id = ?
            """,
            [short, conversation_id],
        )
    else:
        con.execute(
            "UPDATE dcc_ask_conversations SET updated_at = now() WHERE conversation_id = ?",
            [conversation_id],
        )
    return tid, seq


def list_turns(
    con: duckdb.DuckDBPyConnection,
    conversation_id: str,
    limit: int = 100,
) -> list[dict[str, Any]]:
    lim = max(1, min(limit, 200))
    rows = con.execute(
        f"""
        SELECT turn_id, conversation_id, seq, question, sql, explanation, answer, error,
               attempts_json, result_json, model, elapsed_ms, created_at
        FROM dcc_ask_turns
        WHERE conversation_id = ?
        ORDER BY seq ASC
        LIMIT {lim}
        """,
        [conversation_id],
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        attempts: list[dict[str, Any]] = []
        if r[8]:
            try:
                parsed = json.loads(r[8])
                if isinstance(parsed, list):
                    attempts = [x for x in parsed if isinstance(x, dict)]
            except json.JSONDecodeError:
                pass
        qres: QueryResult | None = None
        if r[9]:
            try:
                qres = QueryResult.model_validate(json.loads(r[9]))
            except (json.JSONDecodeError, ValueError):
                qres = None
        out.append(
            {
                "turn_id": r[0],
                "conversation_id": r[1],
                "seq": int(r[2]),
                "question": r[3],
                "sql": r[4],
                "explanation": r[5],
                "answer": r[6],
                "error": r[7],
                "attempts": attempts,
                "query_result": qres,
                "model": r[10],
                "elapsed_ms": int(r[11]) if r[11] is not None else None,
                "created_at": _ts(r[12]),
            }
        )
    return out


def _preview_row_cells(row: dict[str, Any], max_cols: int = 3) -> str:
    parts = []
    for k, v in list(row.items())[:max_cols]:
        parts.append(f"{k}={v!r}")
    return ", ".join(parts)


def last_turns_for_context(
    con: duckdb.DuckDBPyConnection,
    conversation_id: str,
    n: int = 3,
) -> list[dict[str, Any]]:
    """Compact turns for LLM context (newest last within the returned window)."""
    nn = max(1, min(n, 10))
    # Fetch last nn turns by seq
    rows = con.execute(
        f"""
        SELECT question, sql, error, result_json
        FROM dcc_ask_turns
        WHERE conversation_id = ?
        ORDER BY seq DESC
        LIMIT {nn}
        """,
        [conversation_id],
    ).fetchall()
    rows = list(reversed(rows))
    out: list[dict[str, Any]] = []
    for question, sql, err, rj in rows:
        row_count: int | None = None
        preview = ""
        if rj:
            try:
                blob = json.loads(rj)
                rc = blob.get("row_count")
                if isinstance(rc, int):
                    row_count = rc
                qrows = blob.get("rows")
                if isinstance(qrows, list) and qrows and isinstance(qrows[0], dict):
                    preview = _preview_row_cells(qrows[0])
            except (json.JSONDecodeError, TypeError):
                pass
        out.append(
            {
                "question": question,
                "sql": sql,
                "row_count": row_count,
                "error": err,
                "preview": preview,
            }
        )
    return out


def format_history_block(turns: list[dict[str, Any]]) -> str:
    if not turns:
        return ""
    lines = ["Recent conversation turns (oldest first):"]
    for i, t in enumerate(turns, 1):
        q = str(t.get("question", ""))
        sql = t.get("sql") or ""
        err = t.get("error")
        rc = t.get("row_count")
        preview = t.get("preview") or ""
        chunk = f"  Turn {i} Q: {q}\n"
        if sql:
            chunk += f"  SQL: {sql}\n"
        if err:
            chunk += f"  Error: {err}\n"
        elif rc is not None:
            chunk += f"  Rows: {rc}"
            if preview:
                chunk += f" | First row: {preview}"
            chunk += "\n"
        lines.append(chunk.rstrip())
    return "\n".join(lines) + "\n\n"
