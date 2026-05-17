"""DuckDB workspace compatibility facade over engine + focused stores."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings
from app.services.workspace_engine import (
    WorkspaceEngine,
    _is_recoverable_open_error,
    sanitize_sql_identifier,
)
from app.services.workspace_schema import WorkspaceSchema
from app.services.workspace_stores import JobStore, ProfileStore, SavedQueryStore

__all__ = ["Workspace", "sanitize_sql_identifier", "_is_recoverable_open_error"]


class Workspace:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._engine = WorkspaceEngine(settings)
        self._schema = WorkspaceSchema()
        with self._engine.lock_db() as con:
            self._schema.initialize(con)
        self._profiles = ProfileStore(self._engine)
        self._saved_queries = SavedQueryStore(self._engine)
        self._jobs = JobStore(self._engine)

    @property
    def path(self) -> Path:
        return self._engine.path

    @property
    def connection(self) -> duckdb.DuckDBPyConnection:
        return self._engine.connection

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

    def save_profile_cache(self, dataset_id: str, profile: dict[str, Any]) -> None:
        self._profiles.save_profile_cache(dataset_id, profile)

    def list_profile_history(self, dataset_id: str, limit: int = 10) -> list[dict[str, Any]]:
        return self._profiles.list_profile_history(dataset_id, limit)

    def load_profile_history_blob(self, history_id: str) -> dict[str, Any] | None:
        return self._profiles.load_profile_history_blob(history_id)

    def list_saved_queries(self) -> list[dict[str, Any]]:
        return self._saved_queries.list_saved_queries()

    def insert_saved_query(self, name: str, sql: str) -> str:
        return self._saved_queries.insert_saved_query(name, sql)

    def update_saved_query(self, saved_id: str, name: str | None = None, sql: str | None = None) -> bool:
        return self._saved_queries.update_saved_query(saved_id, name, sql)

    def delete_saved_query(self, saved_id: str) -> bool:
        return self._saved_queries.delete_saved_query(saved_id)

    def get_saved_query(self, saved_id: str) -> dict[str, Any] | None:
        return self._saved_queries.get_saved_query(saved_id)

    def get_profile_history_meta(self, history_id: str) -> dict[str, Any] | None:
        return self._profiles.get_profile_history_meta(history_id)

    def load_profile_cache(self, dataset_id: str) -> dict[str, Any] | None:
        return self._profiles.load_profile_cache(dataset_id)

    def delete_profile_cache(self, dataset_id: str) -> None:
        self._profiles.delete_profile_cache(dataset_id)

    def job_insert(self, job_id: str, kind: str, dataset_id: str | None, status: str) -> None:
        self._jobs.job_insert(job_id, kind, dataset_id, status)

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
        self._jobs.job_update(
            job_id,
            status=status,
            progress=progress,
            error_code=error_code,
            error_message=error_message,
            result_json=result_json,
            finished=finished,
        )

    def job_finish(self, job_id: str, status: str, error: str | None = None) -> None:
        self._jobs.job_finish(job_id, status, error)

    def job_get(self, job_id: str) -> dict[str, Any] | None:
        return self._jobs.job_get(job_id)

    def jobs_list(self, limit: int = 100, status: str | None = None) -> list[dict[str, Any]]:
        return self._jobs.jobs_list(limit, status)

    def job_request_cancel(self, job_id: str) -> bool:
        return self._jobs.job_request_cancel(job_id)

    def job_cancel_requested(self, job_id: str) -> bool:
        return self._jobs.job_cancel_requested(job_id)

    def sleep_poll(self, seconds: float) -> None:
        self._engine.sleep_poll(seconds)
