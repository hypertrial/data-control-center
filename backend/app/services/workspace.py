"""DuckDB workspace facade over engine + focused stores."""

from __future__ import annotations

from pathlib import Path
import duckdb

from app.config import Settings
from app.services.workspace_engine import (
    WorkspaceEngine,
    _is_recoverable_open_error,
    sanitize_sql_identifier,
)
from app.services.workspace_schema import UnsupportedWorkspaceSchemaError, WorkspaceSchema
from app.services.ask_store import AskStore
from app.services.workspace_stores import JobStore, ProfileStore, SavedQueryStore

__all__ = [
    "Workspace",
    "sanitize_sql_identifier",
    "_is_recoverable_open_error",
    "UnsupportedWorkspaceSchemaError",
]


class Workspace:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._engine = WorkspaceEngine(settings)
        self._schema = WorkspaceSchema()
        with self._engine.lock_db() as con:
            self._schema.initialize(con, settings)
        self._profiles = ProfileStore(self._engine)
        self._saved_queries = SavedQueryStore(self._engine)
        self._jobs = JobStore(self._engine)
        self._ask = AskStore(self._engine)

    @property
    def path(self) -> Path:
        return self._engine.path

    @property
    def connection(self) -> duckdb.DuckDBPyConnection:
        return self._engine.connection

    @property
    def profiles(self) -> ProfileStore:
        return self._profiles

    @property
    def jobs(self) -> JobStore:
        return self._jobs

    @property
    def saved_queries(self) -> SavedQueryStore:
        return self._saved_queries

    @property
    def ask(self) -> AskStore:
        return self._ask

    def lock_db(self):
        return self._engine.lock_db()

    def read_db(self):
        return self._engine.read_db()

    def close(self) -> None:
        self._engine.close()

    def drop_view_if_exists(self, view_name: str) -> None:
        self._engine.drop_view_if_exists(view_name)

    def register_file_view(self, view_name: str, source_path: Path, file_format: str) -> None:
        self._engine.register_file_view(view_name, source_path, file_format)

    def get_row_column_counts(self, view_name: str) -> tuple[int, int]:
        return self._engine.get_row_column_counts(view_name)

    def query_count(self, view_name: str, timeout_seconds: float) -> int | None:
        return self._engine.query_count(view_name, timeout_seconds)

    def sleep_poll(self, seconds: float) -> None:
        self._engine.sleep_poll(seconds)
