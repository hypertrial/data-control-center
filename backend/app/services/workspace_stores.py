"""Focused persistence stores built on top of the workspace engine."""

from __future__ import annotations

import json
import uuid
from typing import Any

from app.services.workspace_engine import WorkspaceEngine


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
                "created_at": r[2].isoformat() if hasattr(r[2], "isoformat") else str(r[2]),
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
        ct = row[2]
        return {
            "history_id": row[0],
            "dataset_id": row[1],
            "created_at": ct.isoformat() if hasattr(ct, "isoformat") else str(ct),
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
        out: list[dict[str, Any]] = []
        for r in rows:
            ca, ua = r[3], r[4]
            out.append(
                {
                    "saved_id": r[0],
                    "name": r[1],
                    "sql": r[2],
                    "created_at": ca.isoformat() if hasattr(ca, "isoformat") else str(ca),
                    "updated_at": ua.isoformat() if hasattr(ua, "isoformat") else str(ua),
                }
            )
        return out

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
            row = con.execute(
                "SELECT saved_id FROM dcc_saved_queries WHERE saved_id = ?",
                [saved_id],
            ).fetchone()
            if not row:
                return False
            if name is not None and sql is not None:
                con.execute(
                    """
                    UPDATE dcc_saved_queries
                    SET name = ?, sql = ?, updated_at = now()
                    WHERE saved_id = ?
                    """,
                    [name.strip(), sql, saved_id],
                )
            elif name is not None:
                con.execute(
                    "UPDATE dcc_saved_queries SET name = ?, updated_at = now() WHERE saved_id = ?",
                    [name.strip(), saved_id],
                )
            elif sql is not None:
                con.execute(
                    "UPDATE dcc_saved_queries SET sql = ?, updated_at = now() WHERE saved_id = ?",
                    [sql, saved_id],
                )
        return True

    def delete_saved_query(self, saved_id: str) -> bool:
        with self._engine.lock_db() as con:
            row = con.execute(
                "SELECT saved_id FROM dcc_saved_queries WHERE saved_id = ?",
                [saved_id],
            ).fetchone()
            if not row:
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
        ca, ua = row[3], row[4]
        return {
            "saved_id": row[0],
            "name": row[1],
            "sql": row[2],
            "created_at": ca.isoformat() if hasattr(ca, "isoformat") else str(ca),
            "updated_at": ua.isoformat() if hasattr(ua, "isoformat") else str(ua),
        }


class JobStore:
    def __init__(self, engine: WorkspaceEngine) -> None:
        self._engine = engine

    def job_insert(self, job_id: str, kind: str, dataset_id: str | None, status: str) -> None:
        with self._engine.lock_db() as con:
            con.execute(
                """
                INSERT INTO dcc_jobs (job_id, kind, dataset_id, status, progress)
                VALUES (?, ?, ?, ?, 0)
                """,
                [job_id, kind, dataset_id, status],
            )

    def job_update(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: float | None = None,
        error_code: str | None = None,
        error_message: str | None = None,
        result_json: dict[str, Any] | None = None,
        finished: bool = False,
    ) -> None:
        sets: list[str] = ["updated_at = now()"]
        vals: list[Any] = []
        if status is not None:
            sets.append("status = ?")
            vals.append(status)
        if progress is not None:
            sets.append("progress = ?")
            vals.append(progress)
        if error_code is not None:
            sets.append("error_code = ?")
            vals.append(error_code)
        if error_message is not None:
            sets.append("error_message = ?")
            vals.append(error_message)
        if result_json is not None:
            sets.append("result_json = ?")
            vals.append(json.dumps(result_json, default=str))
        if finished:
            sets.append("finished_at = now()")
        vals.append(job_id)
        with self._engine.lock_db() as con:
            con.execute(f"UPDATE dcc_jobs SET {', '.join(sets)} WHERE job_id = ?", vals)

    def job_finish(self, job_id: str, status: str, error: str | None = None) -> None:
        self.job_update(
            job_id,
            status=status,
            progress=1.0 if status == "completed" else None,
            error_message=error,
            finished=True,
        )

    def job_get(self, job_id: str) -> dict[str, Any] | None:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT job_id, kind, dataset_id, status, progress, error_code, error_message,
                       result_json, cancel_requested, created_at, updated_at, finished_at
                FROM dcc_jobs WHERE job_id = ?
                """,
                [job_id],
            ).fetchone()
        if not row:
            return None
        result: dict[str, Any] | None = None
        if row[7]:
            try:
                parsed = json.loads(row[7])
                if isinstance(parsed, dict):
                    result = parsed
            except json.JSONDecodeError:
                result = None

        def _ts(v: Any) -> str | None:
            if v is None:
                return None
            return v.isoformat() if hasattr(v, "isoformat") else str(v)

        return {
            "job_id": row[0],
            "kind": row[1],
            "dataset_id": row[2],
            "status": row[3],
            "progress": float(row[4] or 0),
            "error_code": row[5],
            "error_message": row[6],
            "result": result,
            "cancel_requested": bool(row[8]),
            "created_at": _ts(row[9]),
            "updated_at": _ts(row[10]),
            "finished_at": _ts(row[11]),
        }

    def jobs_list(self, limit: int = 100, status: str | None = None) -> list[dict[str, Any]]:
        lim = max(1, min(limit, 500))
        args: list[Any] = []
        where = ""
        if status:
            where = "WHERE status = ?"
            args.append(status)
        args.append(lim)
        with self._engine.read_db() as con:
            rows = con.execute(
                f"""
                SELECT job_id, kind, dataset_id, status, progress, error_code, error_message,
                       result_json, cancel_requested, created_at, updated_at, finished_at
                FROM dcc_jobs
                {where}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                args,
            ).fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "job_id": r[0],
                    "kind": r[1],
                    "dataset_id": r[2],
                    "status": r[3],
                    "progress": float(r[4] or 0),
                    "error_code": r[5],
                    "error_message": r[6],
                    "cancel_requested": bool(r[8]),
                    "created_at": r[9].isoformat() if hasattr(r[9], "isoformat") else str(r[9]),
                    "updated_at": r[10].isoformat() if hasattr(r[10], "isoformat") else str(r[10]),
                    "finished_at": r[11].isoformat() if hasattr(r[11], "isoformat") else str(r[11]) if r[11] else None,
                }
            )
        return out

    def job_request_cancel(self, job_id: str) -> bool:
        with self._engine.lock_db() as con:
            row = con.execute(
                "SELECT job_id FROM dcc_jobs WHERE job_id = ?",
                [job_id],
            ).fetchone()
            if not row:
                return False
            con.execute(
                "UPDATE dcc_jobs SET cancel_requested = TRUE, updated_at = now() WHERE job_id = ?",
                [job_id],
            )
            return True

    def job_cancel_requested(self, job_id: str) -> bool:
        with self._engine.read_db() as con:
            row = con.execute(
                "SELECT cancel_requested FROM dcc_jobs WHERE job_id = ?",
                [job_id],
            ).fetchone()
        return bool(row and row[0])
