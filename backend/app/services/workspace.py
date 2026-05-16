"""DuckDB workspace: connection management, metadata storage, and job records."""

from __future__ import annotations

import json
import queue
import re
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings


def sanitize_sql_identifier(raw: str) -> str:
    if not re.match(r"^[a-zA-Z0-9_]+$", raw):
        raise ValueError(f"Invalid SQL identifier: {raw!r}")
    return raw


class Workspace:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        path = settings.workspace_db_path
        if not path.is_absolute():
            path = Path.cwd() / path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path

        self._writer_con = duckdb.connect(str(path))
        self._db_lock = threading.RLock()

        self._read_pool: queue.SimpleQueue[duckdb.DuckDBPyConnection] = queue.SimpleQueue()
        self._read_pool_size = settings.db_reader_pool_size
        for _ in range(self._read_pool_size):
            self._read_pool.put(duckdb.connect(str(path)))

        self._init_schema()

    def _init_schema(self) -> None:
        with self._db_lock:
            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_datasets (
                  dataset_id VARCHAR PRIMARY KEY,
                  source_path VARCHAR NOT NULL,
                  source_label VARCHAR NOT NULL,
                  view_name VARCHAR NOT NULL,
                  format VARCHAR NOT NULL,
                  row_count BIGINT,
                  column_count INTEGER,
                  file_size_bytes BIGINT,
                  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            # Back-compat migration for earlier schema without source_label.
            self._writer_con.execute(
                """
                ALTER TABLE dcc_datasets ADD COLUMN IF NOT EXISTS source_label VARCHAR;
                """
            )
            self._writer_con.execute(
                """
                UPDATE dcc_datasets
                SET source_label = COALESCE(source_label, source_path)
                WHERE source_label IS NULL
                """
            )

            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_profile_cache (
                  dataset_id VARCHAR PRIMARY KEY,
                  profile_json VARCHAR NOT NULL,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_jobs (
                  job_id VARCHAR PRIMARY KEY,
                  kind VARCHAR NOT NULL,
                  dataset_id VARCHAR,
                  status VARCHAR NOT NULL,
                  progress DOUBLE DEFAULT 0,
                  error_code VARCHAR,
                  error_message VARCHAR,
                  result_json VARCHAR,
                  cancel_requested BOOLEAN DEFAULT FALSE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  finished_at TIMESTAMP
                );
                """
            )
            # Back-compat migration for earlier schema with only `error` column.
            self._writer_con.execute(
                """
                ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS error_code VARCHAR;
                """
            )
            self._writer_con.execute(
                """
                ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS error_message VARCHAR;
                """
            )
            self._writer_con.execute(
                """
                ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS result_json VARCHAR;
                """
            )
            self._writer_con.execute(
                """
                ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN DEFAULT FALSE;
                """
            )
            self._writer_con.execute(
                """
                ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP;
                """
            )
            # If a legacy `error` column exists, copy it into error_message once.
            job_cols = {
                str(row[1]).lower()
                for row in self._writer_con.execute("PRAGMA table_info('dcc_jobs')").fetchall()
            }
            if "error" in job_cols:
                self._writer_con.execute(
                    """
                    UPDATE dcc_jobs
                    SET error_message = COALESCE(error_message, error)
                    WHERE error IS NOT NULL
                    """
                )
            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_profile_history (
                  history_id VARCHAR PRIMARY KEY,
                  dataset_id VARCHAR NOT NULL,
                  profile_json VARCHAR NOT NULL,
                  quality_score DOUBLE,
                  rows BIGINT,
                  columns INTEGER,
                  missing_cell_pct DOUBLE,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            self._writer_con.execute(
                """
                CREATE INDEX IF NOT EXISTS dcc_profile_history_ds_created
                ON dcc_profile_history (dataset_id, created_at DESC);
                """
            )
            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_saved_queries (
                  saved_id VARCHAR PRIMARY KEY,
                  name VARCHAR NOT NULL,
                  sql VARCHAR NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_ask_conversations (
                  conversation_id VARCHAR PRIMARY KEY,
                  title VARCHAR NOT NULL,
                  dataset_ids VARCHAR,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            self._writer_con.execute(
                """
                CREATE TABLE IF NOT EXISTS dcc_ask_turns (
                  turn_id VARCHAR PRIMARY KEY,
                  conversation_id VARCHAR NOT NULL,
                  seq INTEGER NOT NULL,
                  question VARCHAR NOT NULL,
                  sql VARCHAR,
                  explanation VARCHAR,
                  answer VARCHAR,
                  error VARCHAR,
                  attempts_json VARCHAR,
                  result_json VARCHAR,
                  model VARCHAR,
                  elapsed_ms INTEGER,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                """
            )
            self._writer_con.execute(
                """
                CREATE INDEX IF NOT EXISTS dcc_ask_turns_conv_seq
                ON dcc_ask_turns (conversation_id, seq);
                """
            )

    @property
    def path(self) -> Path:
        return self._path

    @contextmanager
    def lock_db(self) -> Iterator[duckdb.DuckDBPyConnection]:
        with self._db_lock:
            yield self._writer_con

    @contextmanager
    def read_db(self) -> Iterator[duckdb.DuckDBPyConnection]:
        con = self._read_pool.get()
        try:
            yield con
        finally:
            self._read_pool.put(con)

    def close(self) -> None:
        with self._db_lock:
            self._writer_con.close()
        closed = 0
        while closed < self._read_pool_size:
            con = self._read_pool.get()
            con.close()
            closed += 1

    def drop_view_if_exists(self, view_name: str) -> None:
        safe = sanitize_sql_identifier(view_name)
        with self._db_lock:
            self._writer_con.execute(f"DROP VIEW IF EXISTS {safe}")

    def register_file_view(self, view_name: str, source_path: Path, file_format: str) -> None:
        safe_view = sanitize_sql_identifier(view_name)
        p = source_path.resolve()
        if not p.exists() or not p.is_file():
            raise FileNotFoundError(str(p))
        escaped = str(p).replace("'", "''")
        fmt = file_format.lower()
        if fmt == "parquet":
            sql = f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM read_parquet('{escaped}')"
        elif fmt == "csv":
            if source_path.suffix.lower() == ".tsv":
                sql = (
                    f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM "
                    f"read_csv_auto('{escaped}', delim='\\t')"
                )
            else:
                sql = (
                    f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM "
                    f"read_csv_auto('{escaped}')"
                )
        elif fmt == "json":
            sql = f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM read_json_auto('{escaped}')"
        else:
            raise ValueError(f"Unsupported format for DuckDB registration: {file_format}")
        with self._db_lock:
            self._writer_con.execute(sql)

    def get_row_column_counts(self, view_name: str) -> tuple[int, int]:
        safe = sanitize_sql_identifier(view_name)
        with self.read_db() as con:
            row = con.execute(f"SELECT COUNT(*) AS c FROM {safe}").fetchone()
            rows = int(row[0]) if row else 0
            cols_row = con.execute(f"SELECT COUNT(*) FROM pragma_table_info('{safe}')").fetchone()
            cols = int(cols_row[0]) if cols_row else 0
        return rows, cols

    def query_count(self, view_name: str, timeout_seconds: float) -> int | None:
        safe = sanitize_sql_identifier(view_name)
        with self.read_db() as con:
            con.execute("PRAGMA disable_progress_bar")
            con.execute(f"SET statement_timeout='{max(1, int(timeout_seconds * 1000))}ms'")
            try:
                row = con.execute(f"SELECT COUNT(*) AS c FROM {safe}").fetchone()
            except Exception:
                return None
        return int(row[0]) if row else None

    def save_profile_cache(self, dataset_id: str, profile: dict[str, Any]) -> None:
        payload = json.dumps(profile)
        with self._db_lock:
            self._writer_con.execute(
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
            self._writer_con.execute(
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
            self._prune_profile_history(dataset_id)

    def _prune_profile_history(self, dataset_id: str, keep: int = 50) -> None:
        self._writer_con.execute(
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
        with self.read_db() as con:
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
        with self.read_db() as con:
            row = con.execute(
                "SELECT profile_json FROM dcc_profile_history WHERE history_id = ?",
                [history_id],
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def list_saved_queries(self) -> list[dict[str, Any]]:
        with self.read_db() as con:
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
        with self._db_lock:
            self._writer_con.execute(
                "INSERT INTO dcc_saved_queries (saved_id, name, sql) VALUES (?, ?, ?)",
                [sid, name.strip(), sql],
            )
        return sid

    def update_saved_query(self, saved_id: str, name: str | None = None, sql: str | None = None) -> bool:
        with self._db_lock:
            row = self._writer_con.execute(
                "SELECT saved_id FROM dcc_saved_queries WHERE saved_id = ?",
                [saved_id],
            ).fetchone()
            if not row:
                return False
            if name is not None and sql is not None:
                self._writer_con.execute(
                    """
                    UPDATE dcc_saved_queries
                    SET name = ?, sql = ?, updated_at = now()
                    WHERE saved_id = ?
                    """,
                    [name.strip(), sql, saved_id],
                )
            elif name is not None:
                self._writer_con.execute(
                    "UPDATE dcc_saved_queries SET name = ?, updated_at = now() WHERE saved_id = ?",
                    [name.strip(), saved_id],
                )
            elif sql is not None:
                self._writer_con.execute(
                    "UPDATE dcc_saved_queries SET sql = ?, updated_at = now() WHERE saved_id = ?",
                    [sql, saved_id],
                )
        return True

    def delete_saved_query(self, saved_id: str) -> bool:
        with self._db_lock:
            row = self._writer_con.execute(
                "SELECT saved_id FROM dcc_saved_queries WHERE saved_id = ?",
                [saved_id],
            ).fetchone()
            if not row:
                return False
            self._writer_con.execute("DELETE FROM dcc_saved_queries WHERE saved_id = ?", [saved_id])
        return True

    def get_saved_query(self, saved_id: str) -> dict[str, Any] | None:
        with self.read_db() as con:
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

    def get_profile_history_meta(self, history_id: str) -> dict[str, Any] | None:
        with self.read_db() as con:
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
        with self.read_db() as con:
            row = con.execute(
                "SELECT profile_json FROM dcc_profile_cache WHERE dataset_id = ?",
                [dataset_id],
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def delete_profile_cache(self, dataset_id: str) -> None:
        with self._db_lock:
            self._writer_con.execute("DELETE FROM dcc_profile_cache WHERE dataset_id = ?", [dataset_id])

    def job_insert(self, job_id: str, kind: str, dataset_id: str | None, status: str) -> None:
        with self._db_lock:
            self._writer_con.execute(
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
        with self._db_lock:
            self._writer_con.execute(
                f"UPDATE dcc_jobs SET {', '.join(sets)} WHERE job_id = ?",
                vals,
            )

    def job_finish(self, job_id: str, status: str, error: str | None = None) -> None:
        self.job_update(
            job_id,
            status=status,
            progress=1.0 if status == "completed" else None,
            error_message=error,
            finished=True,
        )

    def job_get(self, job_id: str) -> dict[str, Any] | None:
        with self.read_db() as con:
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
        with self.read_db() as con:
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
        with self._db_lock:
            row = self._writer_con.execute(
                "SELECT job_id FROM dcc_jobs WHERE job_id = ?",
                [job_id],
            ).fetchone()
            if not row:
                return False
            self._writer_con.execute(
                "UPDATE dcc_jobs SET cancel_requested = TRUE, updated_at = now() WHERE job_id = ?",
                [job_id],
            )
            return True

    def job_cancel_requested(self, job_id: str) -> bool:
        with self.read_db() as con:
            row = con.execute(
                "SELECT cancel_requested FROM dcc_jobs WHERE job_id = ?",
                [job_id],
            ).fetchone()
        return bool(row and row[0])

    def sleep_poll(self, seconds: float) -> None:
        time.sleep(seconds)
