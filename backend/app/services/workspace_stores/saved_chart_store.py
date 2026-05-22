"""Saved chart spec persistence."""

from __future__ import annotations

import uuid
from typing import Any

from app.services.workspace_engine import WorkspaceEngine
from app.services.workspace_stores._utils import apply_partial_update, iso_ts, record_exists


class SavedChartStore:
    def __init__(self, engine: WorkspaceEngine) -> None:
        self._engine = engine

    def list_saved_charts(self, dataset_id: str) -> list[dict[str, Any]]:
        with self._engine.read_db() as con:
            rows = con.execute(
                """
                SELECT chart_id, dataset_id, name, spec_json, created_at, updated_at
                FROM dcc_saved_charts
                WHERE dataset_id = ?
                ORDER BY updated_at DESC
                """,
                [dataset_id],
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def insert_saved_chart(self, dataset_id: str, name: str, spec_json: str) -> str:
        cid = uuid.uuid4().hex
        with self._engine.lock_db() as con:
            con.execute(
                """
                INSERT INTO dcc_saved_charts (chart_id, dataset_id, name, spec_json)
                VALUES (?, ?, ?, ?)
                """,
                [cid, dataset_id, name.strip(), spec_json],
            )
        return cid

    def update_saved_chart(
        self,
        chart_id: str,
        name: str | None = None,
        spec_json: str | None = None,
    ) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_saved_charts", "chart_id", chart_id):
                return False
            apply_partial_update(
                con,
                "dcc_saved_charts",
                "chart_id",
                chart_id,
                {"name": name, "spec_json": spec_json},
            )
        return True

    def delete_saved_chart(self, chart_id: str) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_saved_charts", "chart_id", chart_id):
                return False
            con.execute("DELETE FROM dcc_saved_charts WHERE chart_id = ?", [chart_id])
        return True

    def get_saved_chart(self, chart_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT chart_id, dataset_id, name, spec_json, created_at, updated_at
                FROM dcc_saved_charts WHERE chart_id = ?
                """,
                [chart_id],
            ).fetchone()
        if not row:
            return None
        return self._row_to_dict(row)

    @staticmethod
    def _row_to_dict(row: tuple[Any, ...]) -> dict[str, Any]:
        return {
            "chart_id": row[0],
            "dataset_id": row[1],
            "name": row[2],
            "spec_json": row[3],
            "created_at": iso_ts(row[4]),
            "updated_at": iso_ts(row[5]),
        }
