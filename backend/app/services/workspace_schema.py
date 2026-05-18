"""Workspace schema creation and strict current-schema validation."""

from __future__ import annotations

import duckdb


class UnsupportedWorkspaceSchemaError(RuntimeError):
    """Raised when a workspace database does not match the current schema."""


ColumnSpec = tuple[str, str, bool, bool]


EXPECTED_TABLES: dict[str, tuple[ColumnSpec, ...]] = {
    "dcc_datasets": (
        ("dataset_id", "VARCHAR", True, True),
        ("source_path", "VARCHAR", True, False),
        ("source_label", "VARCHAR", True, False),
        ("view_name", "VARCHAR", True, False),
        ("format", "VARCHAR", True, False),
        ("row_count", "BIGINT", False, False),
        ("column_count", "INTEGER", False, False),
        ("file_size_bytes", "BIGINT", False, False),
        ("registered_at", "TIMESTAMP", False, False),
    ),
    "dcc_profile_cache": (
        ("dataset_id", "VARCHAR", True, True),
        ("profile_json", "VARCHAR", True, False),
        ("updated_at", "TIMESTAMP", False, False),
    ),
    "dcc_jobs": (
        ("job_id", "VARCHAR", True, True),
        ("kind", "VARCHAR", True, False),
        ("dataset_id", "VARCHAR", False, False),
        ("status", "VARCHAR", True, False),
        ("progress", "DOUBLE", False, False),
        ("error_code", "VARCHAR", False, False),
        ("error_message", "VARCHAR", False, False),
        ("result_json", "VARCHAR", False, False),
        ("cancel_requested", "BOOLEAN", False, False),
        ("created_at", "TIMESTAMP", False, False),
        ("updated_at", "TIMESTAMP", False, False),
        ("finished_at", "TIMESTAMP", False, False),
    ),
    "dcc_profile_history": (
        ("history_id", "VARCHAR", True, True),
        ("dataset_id", "VARCHAR", True, False),
        ("profile_json", "VARCHAR", True, False),
        ("quality_score", "DOUBLE", False, False),
        ("rows", "BIGINT", False, False),
        ("columns", "INTEGER", False, False),
        ("missing_cell_pct", "DOUBLE", False, False),
        ("created_at", "TIMESTAMP", False, False),
    ),
    "dcc_saved_queries": (
        ("saved_id", "VARCHAR", True, True),
        ("name", "VARCHAR", True, False),
        ("sql", "VARCHAR", True, False),
        ("created_at", "TIMESTAMP", False, False),
        ("updated_at", "TIMESTAMP", False, False),
    ),
    "dcc_ask_conversations": (
        ("conversation_id", "VARCHAR", True, True),
        ("title", "VARCHAR", True, False),
        ("dataset_ids", "VARCHAR", False, False),
        ("created_at", "TIMESTAMP", False, False),
        ("updated_at", "TIMESTAMP", False, False),
    ),
    "dcc_ask_turns": (
        ("turn_id", "VARCHAR", True, True),
        ("conversation_id", "VARCHAR", True, False),
        ("seq", "INTEGER", True, False),
        ("question", "VARCHAR", True, False),
        ("sql", "VARCHAR", False, False),
        ("explanation", "VARCHAR", False, False),
        ("answer", "VARCHAR", False, False),
        ("error", "VARCHAR", False, False),
        ("attempts_json", "VARCHAR", False, False),
        ("result_json", "VARCHAR", False, False),
        ("model", "VARCHAR", False, False),
        ("elapsed_ms", "INTEGER", False, False),
        ("created_at", "TIMESTAMP", False, False),
    ),
}

EXPECTED_INDEXES: dict[str, tuple[str, bool]] = {
    "dcc_datasets_view_name_unique": ("dcc_datasets", True),
    "dcc_profile_history_ds_created": ("dcc_profile_history", False),
    "dcc_ask_turns_conv_seq": ("dcc_ask_turns", False),
}


def _unsupported(message: str) -> UnsupportedWorkspaceSchemaError:
    return UnsupportedWorkspaceSchemaError(
        f"Unsupported workspace database schema: {message}. "
        "Delete or recreate the workspace DB, or point DCC_WORKSPACE_DB_PATH to a fresh file."
    )


def _existing_dcc_tables(con: duckdb.DuckDBPyConnection) -> set[str]:
    rows = con.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
          AND table_type = 'BASE TABLE'
        """
    ).fetchall()
    return {str(row[0]) for row in rows if str(row[0]).startswith("dcc_")}


def _table_columns(con: duckdb.DuckDBPyConnection, table_name: str) -> tuple[ColumnSpec, ...]:
    rows = con.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    return tuple(
        (str(row[1]), str(row[2]).upper(), bool(row[3]), bool(row[5])) for row in rows
    )


def _validate_schema(con: duckdb.DuckDBPyConnection) -> None:
    existing = _existing_dcc_tables(con)
    expected = set(EXPECTED_TABLES)
    if existing != expected:
        missing = ", ".join(sorted(expected - existing)) or "none"
        extra = ", ".join(sorted(existing - expected)) or "none"
        raise _unsupported(f"expected current workspace tables; missing={missing}; extra={extra}")

    for table_name, expected_columns in EXPECTED_TABLES.items():
        actual_columns = _table_columns(con, table_name)
        if actual_columns != expected_columns:
            raise _unsupported(f"table {table_name} columns do not match the current schema")

    duplicate = con.execute(
        """
        SELECT view_name
        FROM dcc_datasets
        GROUP BY view_name
        HAVING COUNT(*) > 1
        LIMIT 1
        """
    ).fetchone()
    if duplicate is not None:
        raise _unsupported(f"duplicate dataset view_name {duplicate[0]!r}")

    rows = con.execute("SELECT index_name, table_name, is_unique FROM duckdb_indexes()").fetchall()
    indexes = {str(row[0]): (str(row[1]), bool(row[2])) for row in rows}
    for index_name, expected_index in EXPECTED_INDEXES.items():
        if indexes.get(index_name) != expected_index:
            raise _unsupported(f"index {index_name} is missing or does not match the current schema")


class WorkspaceSchema:
    def initialize(self, con: duckdb.DuckDBPyConnection) -> None:
        existing = _existing_dcc_tables(con)
        if existing:
            _validate_schema(con)
            return

        con.execute(
            """
            CREATE TABLE dcc_datasets (
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
            CREATE UNIQUE INDEX dcc_datasets_view_name_unique
            ON dcc_datasets (view_name);
            """
        )
        con.execute(
            """
            CREATE TABLE dcc_profile_cache (
              dataset_id VARCHAR PRIMARY KEY,
              profile_json VARCHAR NOT NULL,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        con.execute(
            """
            CREATE TABLE dcc_jobs (
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
            CREATE TABLE dcc_profile_history (
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
            CREATE INDEX dcc_profile_history_ds_created
            ON dcc_profile_history (dataset_id, created_at DESC);
            """
        )
        con.execute(
            """
            CREATE TABLE dcc_saved_queries (
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
            CREATE TABLE dcc_ask_conversations (
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
            CREATE TABLE dcc_ask_turns (
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
            CREATE INDEX dcc_ask_turns_conv_seq
            ON dcc_ask_turns (conversation_id, seq);
            """
        )
