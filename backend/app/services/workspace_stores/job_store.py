"""Background job persistence."""

from __future__ import annotations

import json
from typing import Any

from app.services.workspace_engine import WorkspaceEngine
from app.services.workspace_stores._utils import iso_ts, json_dict_or_none, record_exists


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

    def job_find_active_for_dataset(self, dataset_id: str, kind: str) -> str | None:
        with self._engine.read_db() as con:
            row = con.execute(
                """
                SELECT job_id FROM dcc_jobs
                WHERE dataset_id = ? AND kind = ? AND status IN ('queued', 'running')
                ORDER BY created_at DESC
                LIMIT 1
                """,
                [dataset_id, kind],
            ).fetchone()
        return str(row[0]) if row else None

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
        return {
            "job_id": row[0],
            "kind": row[1],
            "dataset_id": row[2],
            "status": row[3],
            "progress": float(row[4] or 0),
            "error_code": row[5],
            "error_message": row[6],
            "result": json_dict_or_none(row[7]),
            "cancel_requested": bool(row[8]),
            "created_at": iso_ts(row[9]),
            "updated_at": iso_ts(row[10]),
            "finished_at": iso_ts(row[11]),
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
        return [
            {
                "job_id": r[0],
                "kind": r[1],
                "dataset_id": r[2],
                "status": r[3],
                "progress": float(r[4] or 0),
                "error_code": r[5],
                "error_message": r[6],
                "cancel_requested": bool(r[8]),
                "created_at": iso_ts(r[9]),
                "updated_at": iso_ts(r[10]),
                "finished_at": iso_ts(r[11]) if r[11] else None,
            }
            for r in rows
        ]

    def job_request_cancel(self, job_id: str) -> bool:
        with self._engine.lock_db() as con:
            if not record_exists(con, "dcc_jobs", "job_id", job_id):
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
