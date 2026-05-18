"""Workspace schema creation and lightweight back-compat migrations."""

from __future__ import annotations

import re
from pathlib import Path

import duckdb


def _sanitize_view_identifier(raw: str) -> str:
    if not re.match(r"^[a-zA-Z0-9_]+$", raw):
        raise ValueError(f"Invalid SQL identifier: {raw!r}")
    return raw


def _create_view_for_dataset(
    con: duckdb.DuckDBPyConnection,
    view_name: str,
    source_path: str,
    file_format: str,
) -> None:
    safe_view = _sanitize_view_identifier(view_name)
    p = Path(source_path).expanduser().resolve()
    if not p.is_file():
        return
    escaped = str(p).replace("'", "''")
    fmt = file_format.lower()
    if fmt == "parquet":
        sql = f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM read_parquet('{escaped}')"
    elif fmt == "csv":
        if p.suffix.lower() == ".tsv":
            sql = (
                f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM "
                f"read_csv_auto('{escaped}', delim='\\t')"
            )
        else:
            sql = f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM read_csv_auto('{escaped}')"
    elif fmt == "json":
        sql = f"CREATE OR REPLACE VIEW {safe_view} AS SELECT * FROM read_json_auto('{escaped}')"
    else:
        return
    con.execute(sql)


def _pick_repaired_view_name(base: str, dataset_id: str, taken: set[str]) -> str:
    candidate = f"{base}_{dataset_id}"
    n = 2
    while candidate in taken:
        candidate = f"{base}_{dataset_id}_{n}"
        n += 1
    return candidate


class WorkspaceSchema:
    def initialize(self, con: duckdb.DuckDBPyConnection) -> None:
        con.execute(
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
        con.execute(
            """
            ALTER TABLE dcc_datasets ADD COLUMN IF NOT EXISTS source_label VARCHAR;
            """
        )
        con.execute(
            """
            UPDATE dcc_datasets
            SET source_label = COALESCE(source_label, source_path)
            WHERE source_label IS NULL
            """
        )
        con.execute(
            """
            ALTER TABLE dcc_datasets
            ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            """
        )
        self._repair_duplicate_dataset_view_names(con)
        con.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS dcc_datasets_view_name_unique
            ON dcc_datasets (view_name);
            """
        )

        con.execute(
            """
            CREATE TABLE IF NOT EXISTS dcc_profile_cache (
              dataset_id VARCHAR PRIMARY KEY,
              profile_json VARCHAR NOT NULL,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        con.execute(
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
        con.execute(
            """
            ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS error_code VARCHAR;
            """
        )
        con.execute(
            """
            ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS error_message VARCHAR;
            """
        )
        con.execute(
            """
            ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS result_json VARCHAR;
            """
        )
        con.execute(
            """
            ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN DEFAULT FALSE;
            """
        )
        con.execute(
            """
            ALTER TABLE dcc_jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP;
            """
        )
        job_cols = {str(row[1]).lower() for row in con.execute("PRAGMA table_info('dcc_jobs')").fetchall()}
        if "error" in job_cols:
            con.execute(
                """
                UPDATE dcc_jobs
                SET error_message = COALESCE(error_message, error)
                WHERE error IS NOT NULL
                """
            )

        con.execute(
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
        con.execute(
            """
            CREATE INDEX IF NOT EXISTS dcc_profile_history_ds_created
            ON dcc_profile_history (dataset_id, created_at DESC);
            """
        )
        con.execute(
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
        con.execute(
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
        con.execute(
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
        con.execute(
            """
            CREATE INDEX IF NOT EXISTS dcc_ask_turns_conv_seq
            ON dcc_ask_turns (conversation_id, seq);
            """
        )

    def _repair_duplicate_dataset_view_names(self, con: duckdb.DuckDBPyConnection) -> None:
        rows = con.execute(
            """
            SELECT dataset_id, source_path, view_name, format
            FROM dcc_datasets
            ORDER BY view_name, registered_at, dataset_id
            """
        ).fetchall()
        taken: set[str] = set()
        seen: set[str] = set()
        for dataset_id, source_path, view_name, file_format in rows:
            view = str(view_name)
            if view not in seen and view not in taken:
                seen.add(view)
                taken.add(view)
                continue
            new_view = _pick_repaired_view_name(view, str(dataset_id), taken)
            taken.add(new_view)
            try:
                _create_view_for_dataset(con, new_view, str(source_path), str(file_format))
            except (OSError, ValueError, duckdb.Error):
                # Metadata still needs a unique view_name so the schema constraint can be applied.
                pass
            con.execute(
                "UPDATE dcc_datasets SET view_name = ? WHERE dataset_id = ?",
                [new_view, dataset_id],
            )
