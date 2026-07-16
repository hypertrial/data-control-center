"""Persisted chart specifications."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.services.workspace_engine import WorkspaceEngine
from app.services.workspace_stores._utils import iso_ts, record_exists

_UNSET = object()


class SavedChartStore:
    def __init__(self, engine: WorkspaceEngine) -> None:
        self._engine = engine

    @staticmethod
    def _row(row: tuple[Any, ...]) -> dict[str, Any]:
        return {
            "chart_id": row[0],
            "dataset_id": row[1],
            "name": row[2],
            "description": row[3],
            "spec": json.loads(row[4]),
            "created_at": iso_ts(row[5]),
            "updated_at": iso_ts(row[6]),
        }

    def list_saved_charts(self, dataset_id: str | None = None) -> list[dict[str, Any]]:
        sql = """
            SELECT chart_id, dataset_id, name, description, spec_json, created_at, updated_at
            FROM dcc_chart_artifacts
        """
        params: list[object] = []
        if dataset_id is not None:
            sql += " WHERE dataset_id = ?"
            params.append(dataset_id)
        sql += " ORDER BY updated_at DESC"
        with self._engine.read_db() as con:
            rows = con.execute(sql, params).fetchall()
        return [self._row(row) for row in rows]

    def get_saved_chart(self, chart_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT chart_id, dataset_id, name, description, spec_json, created_at, updated_at
                FROM dcc_chart_artifacts WHERE chart_id = ?
                """,
                [chart_id],
            ).fetchone()
        return self._row(row) if row else None

    def insert_saved_chart(
        self, dataset_id: str, name: str, description: str | None, spec: dict[str, Any]
    ) -> str:
        chart_id = uuid.uuid4().hex
        cleaned_description = description.strip() if isinstance(description, str) else None
        with self._engine.lock_db() as con:
            con.execute(
                """
                INSERT INTO dcc_chart_artifacts
                  (chart_id, dataset_id, name, description, spec_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    chart_id,
                    dataset_id,
                    name.strip(),
                    cleaned_description or None,
                    json.dumps(spec, separators=(",", ":")),
                ],
            )
        return chart_id

    def update_saved_chart(
        self,
        chart_id: str,
        *,
        name: str | None = None,
        description: object = _UNSET,
        spec: dict[str, Any] | None = None,
    ) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_chart_artifacts", "chart_id", chart_id):
                return False
            sets = ["updated_at = now()"]
            values: list[object] = []
            if name is not None:
                sets.append("name = ?")
                values.append(name.strip())
            if description is not _UNSET:
                cleaned = description.strip() if isinstance(description, str) else None
                sets.append("description = ?")
                values.append(cleaned or None)
            if spec is not None:
                sets.append("spec_json = ?")
                values.append(json.dumps(spec, separators=(",", ":")))
            values.append(chart_id)
            con.execute(
                f"UPDATE dcc_chart_artifacts SET {', '.join(sets)} WHERE chart_id = ?",
                values,
            )
        return True

    def delete_saved_chart(self, chart_id: str) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_chart_artifacts", "chart_id", chart_id):
                return False
            con.execute("DELETE FROM dcc_chart_artifacts WHERE chart_id = ?", [chart_id])
        return True

    def count_for_dataset(self, dataset_id: str) -> int:
        with self._engine.read_db() as con:
            row = con.execute(
                "SELECT COUNT(*) FROM dcc_chart_artifacts WHERE dataset_id = ?", [dataset_id]
            ).fetchone()
        return int(row[0]) if row else 0

    def delete_for_dataset(self, dataset_id: str) -> int:
        count = self.count_for_dataset(dataset_id)
        with self._engine.lock_db() as con:
            con.execute("DELETE FROM dcc_chart_artifacts WHERE dataset_id = ?", [dataset_id])
        return count
