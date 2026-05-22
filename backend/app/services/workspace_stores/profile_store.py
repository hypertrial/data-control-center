"""Profile cache and history persistence."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.services.workspace_engine import WorkspaceEngine
from app.services.workspace_stores._utils import iso_ts


class ProfileStore:
    def __init__(self, engine: WorkspaceEngine) -> None:
        self._engine = engine

    def save_profile_cache(self, dataset_id: str, profile: dict[str, Any]) -> None:
        payload = json.dumps(profile)
        with self._engine.lock_db() as con:
            con.execute(
                """
                INSERT INTO dcc_profile_cache (dataset_id, profile_json)
                VALUES (?, ?)
                ON CONFLICT (dataset_id) DO UPDATE SET
                  profile_json = excluded.profile_json,
                  updated_at = now()
                """,
                [dataset_id, payload],
            )
            hid = uuid.uuid4().hex
            con.execute(
                """
                INSERT INTO dcc_profile_history (
                  history_id, dataset_id, profile_json, quality_score, rows, columns, missing_cell_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    hid,
                    dataset_id,
                    payload,
                    profile.get("quality_score"),
                    profile.get("rows"),
                    profile.get("columns"),
                    profile.get("missing_cell_pct"),
                ],
            )
            self._prune_profile_history(con, dataset_id)

    def _prune_profile_history(self, con: Any, dataset_id: str, keep: int = 50) -> None:
        con.execute(
            """
            DELETE FROM dcc_profile_history
            WHERE dataset_id = ?
            AND history_id IN (
              SELECT history_id FROM (
                SELECT history_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY dataset_id ORDER BY created_at DESC
                  ) AS rn
                FROM dcc_profile_history
                WHERE dataset_id = ?
              ) sub
              WHERE sub.rn > ?
            )
            """,
            [dataset_id, dataset_id, keep],
        )

    def list_profile_history(self, dataset_id: str, limit: int = 10) -> list[dict[str, Any]]:
        lim = max(1, min(limit, 50))
        with self._engine.read_db() as con:
            rows = con.execute(
                """
                SELECT history_id, dataset_id, created_at, quality_score, rows, columns,
                       missing_cell_pct
                FROM dcc_profile_history
                WHERE dataset_id = ?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                [dataset_id, lim],
            ).fetchall()
        return [
            {
                "history_id": r[0],
                "dataset_id": r[1],
                "created_at": iso_ts(r[2]),
                "quality_score": r[3],
                "rows": r[4],
                "columns": r[5],
                "missing_cell_pct": r[6],
            }
            for r in rows
        ]

    def load_profile_history_blob(self, history_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                "SELECT profile_json FROM dcc_profile_history WHERE history_id = ?",
                [history_id],
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def get_profile_history_meta(self, history_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT history_id, dataset_id, created_at
                FROM dcc_profile_history WHERE history_id = ?
                """,
                [history_id],
            ).fetchone()
        if not row:
            return None
        return {
            "history_id": row[0],
            "dataset_id": row[1],
            "created_at": iso_ts(row[2]),
        }

    def load_profile_cache(self, dataset_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                "SELECT profile_json FROM dcc_profile_cache WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def delete_profile_cache(self, dataset_id: str) -> None:
        with self._engine.lock_db() as con:
            con.execute("DELETE FROM dcc_profile_cache WHERE dataset_id = ?", [dataset_id])
