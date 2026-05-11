"""DuckDB workspace: connection, view registration, cache tables."""

from __future__ import annotations

import json
import re
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
            CREATE TABLE IF NOT EXISTS dcc_relationships_cache (
              singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
              fingerprint VARCHAR NOT NULL,
              payload_json VARCHAR NOT NULL,
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

    def load_relationships_cache(self) -> tuple[str, str] | None:
        row = self._con.execute(
            "SELECT fingerprint, payload_json FROM dcc_relationships_cache WHERE singleton = 1",
        ).fetchone()
        if not row:
            return None
        return str(row[0]), str(row[1])

    def save_relationships_cache(self, fingerprint: str, payload_json: str) -> None:
        self._con.execute(
            """
            INSERT INTO dcc_relationships_cache (singleton, fingerprint, payload_json)
            VALUES (1, ?, ?)
            ON CONFLICT (singleton) DO UPDATE SET
              fingerprint = excluded.fingerprint,
              payload_json = excluded.payload_json,
              updated_at = now()
            """,
            [fingerprint, payload_json],
        )

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
