"""DuckDB workspace: connection, view registration, cache tables."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings


def sanitize_sql_identifier(raw: str) -> str:
    """Produce a safe quoted identifier fragment (no user-controlled chars)."""
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
        self._con = duckdb.connect(str(path))
        self._init_schema()

    def _init_schema(self) -> None:
        self._con.execute(
            """
            CREATE TABLE IF NOT EXISTS dcc_datasets (
              dataset_id VARCHAR PRIMARY KEY,
              source_path VARCHAR NOT NULL,
              view_name VARCHAR NOT NULL,
              format VARCHAR NOT NULL,
              row_count BIGINT,
              column_count INTEGER,
              file_size_bytes BIGINT,
              registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        self._con.execute(
            """
            CREATE TABLE IF NOT EXISTS dcc_profile_cache (
              dataset_id VARCHAR PRIMARY KEY,
              profile_json VARCHAR NOT NULL,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        self._con.execute(
            """
            CREATE TABLE IF NOT EXISTS dcc_jobs (
              job_id VARCHAR PRIMARY KEY,
              kind VARCHAR NOT NULL,
              dataset_id VARCHAR,
              status VARCHAR NOT NULL,
              progress DOUBLE DEFAULT 0,
              error VARCHAR,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        self._con.execute(
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
        self._con.execute(
            """
            CREATE INDEX IF NOT EXISTS dcc_profile_history_ds_created
            ON dcc_profile_history (dataset_id, created_at DESC);
            """
        )
        self._con.execute(
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
        self._con.execute(
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
        self._con.execute(
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
        self._con.execute(
            """
            CREATE INDEX IF NOT EXISTS dcc_ask_turns_conv_seq
            ON dcc_ask_turns (conversation_id, seq);
            """
        )

    @property
    def connection(self) -> duckdb.DuckDBPyConnection:
        return self._con

    def close(self) -> None:
        self._con.close()

    def drop_view_if_exists(self, view_name: str) -> None:
        safe = sanitize_sql_identifier(view_name)
        self._con.execute(f"DROP VIEW IF EXISTS {safe}")

    def register_file_view(
        self,
        view_name: str,
        source_path: Path,
        file_format: str,
    ) -> None:
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
                    f"read_csv_auto('{escaped}', delim='\t')"
                )
            else:
                sql = (
                    f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM "
                    f"read_csv_auto('{escaped}')"
                )
        elif fmt == "json":
            sql = (
                f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM read_json_auto('{escaped}')"
            )
        else:
            raise ValueError(f"Unsupported format for DuckDB registration: {file_format}")
        self._con.execute(sql)

    def get_row_column_counts(self, view_name: str) -> tuple[int, int]:
        safe = sanitize_sql_identifier(view_name)
        row = self._con.execute(f"SELECT COUNT(*) AS c FROM {safe}").fetchone()
        rows = int(row[0]) if row else 0
        cols_row = self._con.execute(
            f"SELECT COUNT(*) FROM pragma_table_info('{safe}')"
        ).fetchone()
        cols = int(cols_row[0]) if cols_row else 0
        return rows, cols

    def save_profile_cache(self, dataset_id: str, profile: dict[str, Any]) -> None:
        payload = json.dumps(profile)
        self._con.execute(
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
        qs = profile.get("quality_score")
        rows = profile.get("rows")
        cols = profile.get("columns")
        miss = profile.get("missing_cell_pct")
        self._con.execute(
            """
            INSERT INTO dcc_profile_history (
              history_id, dataset_id, profile_json, quality_score, rows, columns, missing_cell_pct
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [hid, dataset_id, payload, qs, rows, cols, miss],
        )
        self._prune_profile_history(dataset_id)

    def _prune_profile_history(self, dataset_id: str, keep: int = 50) -> None:
        self._con.execute(
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
        rows = self._con.execute(
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
        out: list[dict[str, Any]] = []
        for r in rows:
            ct = r[2]
            out.append(
                {
                    "history_id": r[0],
                    "dataset_id": r[1],
                    "created_at": ct.isoformat() if hasattr(ct, "isoformat") else str(ct),
                    "quality_score": r[3],
                    "rows": r[4],
                    "columns": r[5],
                    "missing_cell_pct": r[6],
                }
            )
        return out

    def load_profile_history_blob(self, history_id: str) -> dict[str, Any] | None:
        row = self._con.execute(
            "SELECT profile_json FROM dcc_profile_history WHERE history_id = ?",
            [history_id],
        ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def list_saved_queries(self) -> list[dict[str, Any]]:
        rows = self._con.execute(
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
        self._con.execute(
            "INSERT INTO dcc_saved_queries (saved_id, name, sql) VALUES (?, ?, ?)",
            [sid, name.strip(), sql],
        )
        return sid

    def update_saved_query(
        self,
        saved_id: str,
        name: str | None = None,
        sql: str | None = None,
    ) -> bool:
        row = self._con.execute(
            "SELECT saved_id FROM dcc_saved_queries WHERE saved_id = ?",
            [saved_id],
        ).fetchone()
        if not row:
            return False
        if name is not None and sql is not None:
            self._con.execute(
                """
                UPDATE dcc_saved_queries
                SET name = ?, sql = ?, updated_at = now()
                WHERE saved_id = ?
                """,
                [name.strip(), sql, saved_id],
            )
        elif name is not None:
            self._con.execute(
                "UPDATE dcc_saved_queries SET name = ?, updated_at = now() WHERE saved_id = ?",
                [name.strip(), saved_id],
            )
        elif sql is not None:
            self._con.execute(
                "UPDATE dcc_saved_queries SET sql = ?, updated_at = now() WHERE saved_id = ?",
                [sql, saved_id],
            )
        return True

    def delete_saved_query(self, saved_id: str) -> bool:
        row = self._con.execute(
            "SELECT saved_id FROM dcc_saved_queries WHERE saved_id = ?",
            [saved_id],
        ).fetchone()
        if not row:
            return False
        self._con.execute("DELETE FROM dcc_saved_queries WHERE saved_id = ?", [saved_id])
        return True

    def get_saved_query(self, saved_id: str) -> dict[str, Any] | None:
        row = self._con.execute(
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
        row = self._con.execute(
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
        row = self._con.execute(
            "SELECT profile_json FROM dcc_profile_cache WHERE dataset_id = ?",
            [dataset_id],
        ).fetchone()
        if not row:
            return None
        return json.loads(row[0])

    def delete_profile_cache(self, dataset_id: str) -> None:
        self._con.execute("DELETE FROM dcc_profile_cache WHERE dataset_id = ?", [dataset_id])

    def job_insert(self, job_id: str, kind: str, dataset_id: str | None, status: str) -> None:
        self._con.execute(
            """
            INSERT INTO dcc_jobs (job_id, kind, dataset_id, status, progress)
            VALUES (?, ?, ?, ?, 0)
            """,
            [job_id, kind, dataset_id, status],
        )

    def job_finish(self, job_id: str, status: str, error: str | None = None) -> None:
        self._con.execute(
            """
            UPDATE dcc_jobs SET status = ?, error = ?, updated_at = now()
            WHERE job_id = ?
            """,
            [status, error, job_id],
        )
