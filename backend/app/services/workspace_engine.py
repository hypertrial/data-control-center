"""Low-level DuckDB workspace engine and filesystem-backed view helpers."""

from __future__ import annotations

import queue
import re
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import duckdb

from app.config import Settings
from app.services.duckdb_timeout import apply_statement_timeout


def sanitize_sql_identifier(raw: str) -> str:
    if not re.match(r"^[a-zA-Z0-9_]+$", raw):
        raise ValueError(f"Invalid SQL identifier: {raw!r}")
    return raw


def _is_recoverable_open_error(exc: Exception) -> bool:
    if not isinstance(exc, duckdb.Error):
        return False
    msg = str(exc)
    return "Failure while replaying WAL file" in msg and "GetDefaultDatabase" in msg


def _is_invalidated_database_error(exc: Exception) -> bool:
    if not isinstance(exc, duckdb.Error):
        return False
    msg = str(exc).lower()
    return "database has been invalidated" in msg and "previous fatal error" in msg


class WorkspaceEngine:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        path = settings.workspace_db_path
        if not path.is_absolute():
            path = Path.cwd() / path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = path

        self._writer_con = self._open_writer_connection()
        self._db_lock = threading.RLock()

        self._read_pool: queue.SimpleQueue[duckdb.DuckDBPyConnection] = queue.SimpleQueue()
        self._read_pool_size = settings.db_reader_pool_size
        for _ in range(self._read_pool_size):
            self._read_pool.put(self._connect_database())

    def _connect_database(self) -> duckdb.DuckDBPyConnection:
        return duckdb.connect(str(self._path))

    def _open_writer_connection(self) -> duckdb.DuckDBPyConnection:
        try:
            return self._connect_database()
        except Exception as exc:
            if not _is_recoverable_open_error(exc):
                raise
            self._backup_corrupt_workspace_files()
            return self._connect_database()

    def _backup_corrupt_workspace_files(self) -> None:
        db_path = self._path
        wal_path = db_path.with_name(f"{db_path.name}.wal")
        paths = [p for p in (db_path, wal_path) if p.exists()]
        if not paths:
            return
        suffix = ".corrupt"
        attempt = 0
        while True:
            attempt_suffix = suffix if attempt == 0 else f"{suffix}.{attempt}"
            targets = [p.with_name(f"{p.name}{attempt_suffix}") for p in paths]
            if all(not target.exists() for target in targets):
                break
            attempt += 1
        for source, target in zip(paths, targets, strict=False):
            source.replace(target)

    @property
    def path(self) -> Path:
        return self._path

    @property
    def connection(self) -> duckdb.DuckDBPyConnection:
        return self._writer_con

    @contextmanager
    def lock_db(self) -> Iterator[duckdb.DuckDBPyConnection]:
        with self._db_lock:
            try:
                yield self._writer_con
            except Exception as exc:
                if _is_invalidated_database_error(exc):
                    self._reopen_connections_locked()
                raise

    @contextmanager
    def read_db(self) -> Iterator[duckdb.DuckDBPyConnection]:
        con = self._read_pool.get()
        keep_connection = True
        try:
            yield con
        except Exception as exc:
            if _is_invalidated_database_error(exc):
                keep_connection = False
                self._close_connection(con)
                with self._db_lock:
                    self._reopen_connections_locked()
            raise
        finally:
            if keep_connection:
                self._read_pool.put(con)

    def _close_connection(self, con: duckdb.DuckDBPyConnection) -> None:
        try:
            con.close()
        except Exception:
            pass

    def _reopen_connections_locked(self) -> None:
        self._close_connection(self._writer_con)
        drained: list[duckdb.DuckDBPyConnection] = []
        while True:
            try:
                drained.append(self._read_pool.get_nowait())
            except queue.Empty:
                break
        for con in drained:
            self._close_connection(con)
        self._writer_con = self._open_writer_connection()
        self._read_pool = queue.SimpleQueue()
        for _ in range(self._read_pool_size):
            self._read_pool.put(self._connect_database())

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
            apply_statement_timeout(con, timeout_seconds, min_ms=1)
            try:
                row = con.execute(f"SELECT COUNT(*) AS c FROM {safe}").fetchone()
            except Exception:
                return None
        return int(row[0]) if row else None

    def query_column_count(self, view_name: str) -> int:
        safe = sanitize_sql_identifier(view_name)
        with self.read_db() as con:
            row = con.execute(f"SELECT COUNT(*) FROM pragma_table_info('{safe}')").fetchone()
        return int(row[0]) if row else 0

    def query_parquet_row_count(self, path: Path) -> int | None:
        escaped = str(path.expanduser().resolve()).replace("'", "''")
        with self.read_db() as con:
            con.execute("PRAGMA disable_progress_bar")
            try:
                row = con.execute(
                    f"SELECT COALESCE(SUM(row_group_num_rows), 0)::BIGINT FROM ("
                    f"SELECT DISTINCT row_group_id, row_group_num_rows "
                    f"FROM parquet_metadata('{escaped}')"
                    f")"
                ).fetchone()
            except Exception:
                return None
        if not row:
            return None
        count = int(row[0])
        return count if count > 0 else None

    def sleep_poll(self, seconds: float) -> None:
        time.sleep(seconds)
