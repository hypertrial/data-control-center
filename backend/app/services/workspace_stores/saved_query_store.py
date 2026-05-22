"""Saved SQL query persistence."""

from __future__ import annotations

import uuid
from typing import Any

from app.services.workspace_engine import WorkspaceEngine
from app.services.workspace_stores._utils import apply_partial_update, iso_ts, record_exists


class SavedQueryStore:
    def __init__(self, engine: WorkspaceEngine) -> None:
        self._engine = engine

    def list_saved_queries(self) -> list[dict[str, Any]]:
        with self._engine.read_db() as con:
            rows = con.execute(
                """
                SELECT saved_id, name, sql, created_at, updated_at
                FROM dcc_saved_queries
                ORDER BY updated_at DESC
                """
            ).fetchall()
        return [
            {
                "saved_id": r[0],
                "name": r[1],
                "sql": r[2],
                "created_at": iso_ts(r[3]),
                "updated_at": iso_ts(r[4]),
            }
            for r in rows
        ]

    def insert_saved_query(self, name: str, sql: str) -> str:
        sid = uuid.uuid4().hex
        with self._engine.lock_db() as con:
            con.execute(
                "INSERT INTO dcc_saved_queries (saved_id, name, sql) VALUES (?, ?, ?)",
                [sid, name.strip(), sql],
            )
        return sid

    def update_saved_query(self, saved_id: str, name: str | None = None, sql: str | None = None) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_saved_queries", "saved_id", saved_id):
                return False
            apply_partial_update(con, "dcc_saved_queries", "saved_id", saved_id, {"name": name, "sql": sql})
        return True

    def delete_saved_query(self, saved_id: str) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_saved_queries", "saved_id", saved_id):
                return False
            con.execute("DELETE FROM dcc_saved_queries WHERE saved_id = ?", [saved_id])
        return True

    def get_saved_query(self, saved_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT saved_id, name, sql, created_at, updated_at
                FROM dcc_saved_queries WHERE saved_id = ?
                """,
                [saved_id],
            ).fetchone()
        if not row:
            return None
        return {
            "saved_id": row[0],
            "name": row[1],
            "sql": row[2],
            "created_at": iso_ts(row[3]),
            "updated_at": iso_ts(row[4]),
        }
