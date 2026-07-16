"""Persisted relationship confirmations and dismissals."""

from __future__ import annotations

from typing import Any, Literal

from app.services.workspace_engine import WorkspaceEngine
from app.services.workspace_stores._utils import iso_ts


class RelationshipDecisionStore:
    def __init__(self, engine: WorkspaceEngine) -> None:
        self._engine = engine

    def list_decisions(self) -> list[dict[str, Any]]:
        with self._engine.read_db() as con:
            rows = con.execute(
                """
                SELECT relationship_id, left_dataset_id, left_column,
                       right_dataset_id, right_column, status, created_at, updated_at
                FROM dcc_relationship_decisions
                ORDER BY updated_at DESC
                """
            ).fetchall()
        return [
            {
                "relationship_id": row[0],
                "left_dataset_id": row[1],
                "left_column": row[2],
                "right_dataset_id": row[3],
                "right_column": row[4],
                "status": row[5],
                "created_at": iso_ts(row[6]),
                "updated_at": iso_ts(row[7]),
            }
            for row in rows
        ]

    def upsert_decision(
        self,
        relationship_id: str,
        left_dataset_id: str,
        left_column: str,
        right_dataset_id: str,
        right_column: str,
        status: Literal["confirmed", "dismissed"],
    ) -> None:
        with self._engine.lock_db() as con:
            con.execute(
                """
                INSERT INTO dcc_relationship_decisions (
                  relationship_id, left_dataset_id, left_column,
                  right_dataset_id, right_column, status
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (relationship_id) DO UPDATE SET
                  status = excluded.status,
                  updated_at = now()
                """,
                [
                    relationship_id,
                    left_dataset_id,
                    left_column,
                    right_dataset_id,
                    right_column,
                    status,
                ],
            )

    def delete_decision(self, relationship_id: str) -> bool:
        with self._engine.lock_db() as con:
            row = con.execute(
                "SELECT 1 FROM dcc_relationship_decisions WHERE relationship_id = ?",
                [relationship_id],
            ).fetchone()
            if not row:
                return False
            con.execute(
                "DELETE FROM dcc_relationship_decisions WHERE relationship_id = ?",
                [relationship_id],
            )
        return True

    def count_for_dataset(self, dataset_id: str) -> int:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT COUNT(*) FROM dcc_relationship_decisions
                WHERE left_dataset_id = ? OR right_dataset_id = ?
                """,
                [dataset_id, dataset_id],
            ).fetchone()
        return int(row[0]) if row else 0

    def delete_for_dataset(self, dataset_id: str) -> int:
        count = self.count_for_dataset(dataset_id)
        with self._engine.lock_db() as con:
            con.execute(
                """
                DELETE FROM dcc_relationship_decisions
                WHERE left_dataset_id = ? OR right_dataset_id = ?
                """,
                [dataset_id, dataset_id],
            )
        return count
