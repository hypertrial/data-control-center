"""Workspace and SQL identifier helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import duckdb
import polars as pl
import pytest

from app.config import Settings
from app.services.workspace import (
    UnsupportedWorkspaceSchemaError,
    Workspace,
    _is_recoverable_open_error,
    sanitize_sql_identifier,
)
from app.services.workspace_engine import WorkspaceEngine


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )


def test_sanitize_sql_identifier_ok() -> None:
    assert sanitize_sql_identifier("v_ds_001") == "v_ds_001"


def test_sanitize_sql_identifier_rejects_injection() -> None:
    with pytest.raises(ValueError, match="Invalid SQL identifier"):
        sanitize_sql_identifier("bad;drop")


def test_workspace_relative_db_path_resolves(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    db = Path("relative.duckdb")
    settings = Settings(workspace_db_path=db)
    ws = Workspace(settings)
    try:
        assert ws.connection.execute("SELECT 1").fetchone() == (1,)
    finally:
        ws.close()


def test_register_file_view_parquet_csv_tsv_json(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        pq = tmp_path / "p.parquet"
        pl.DataFrame({"a": [1, 2]}).write_parquet(pq)
        ws.register_file_view("vp", pq, "parquet")
        assert ws.get_row_column_counts("vp") == (2, 1)

        csv = tmp_path / "c.csv"
        csv.write_text("x,y\n1,2\n")
        ws.register_file_view("vc", csv, "csv")
        assert ws.get_row_column_counts("vc")[0] == 1

        tsv = tmp_path / "t.tsv"
        tsv.write_text("x\ty\n3\t4\n")
        ws.register_file_view("vt", tsv, "csv")
        assert ws.get_row_column_counts("vt")[0] == 1

        jarr = tmp_path / "a.json"
        jarr.write_text('[{"k": 1}]')
        ws.register_file_view("vj", jarr, "json")
        assert ws.get_row_column_counts("vj")[0] == 1
    finally:
        ws.close()


def test_register_file_view_bad_format(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        p = tmp_path / "f.csv"
        p.write_text("a\n1\n")
        with pytest.raises(ValueError, match="Unsupported format"):
            ws.register_file_view("x", p, "weird")
    finally:
        ws.close()


def test_register_file_view_missing_file(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        missing = tmp_path / "nope.csv"
        with pytest.raises(FileNotFoundError):
            ws.register_file_view("x", missing, "csv")
    finally:
        ws.close()


def test_profile_cache_roundtrip(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        payload = {"rows": 1, "cols": ["a"]}
        ws.save_profile_cache("ds_001", payload)
        assert ws.load_profile_cache("ds_001") == payload
        ws.delete_profile_cache("ds_001")
        assert ws.load_profile_cache("ds_001") is None
    finally:
        ws.close()


def test_drop_view_if_exists(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        pq = tmp_path / "p.parquet"
        pl.DataFrame({"a": [1]}).write_parquet(pq)
        ws.register_file_view("vd", pq, "parquet")
        ws.drop_view_if_exists("vd")
    finally:
        ws.close()


def test_jobs_insert_and_finish(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        ws.job_insert("jid", "profile_refresh", "ds_001", "running")
        ws.job_finish("jid", "failed", "oops")
        row = ws.connection.execute(
            "SELECT status, error_message FROM dcc_jobs WHERE job_id = ?",
            ["jid"],
        ).fetchone()
        assert row == ("failed", "oops")
    finally:
        ws.close()


def test_profile_history_pruned_to_fifty(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        for i in range(55):
            ws.save_profile_cache(
                "ds_x",
                {
                    "rows": i,
                    "columns": 1,
                    "quality_score": float(i),
                    "missing_cell_pct": 1.0,
                    "column_profiles": [],
                },
            )
        hist = ws.list_profile_history("ds_x", 100)
        assert len(hist) == 50
        assert hist[0]["rows"] == 54
    finally:
        ws.close()


def test_saved_query_crud(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        sid = ws.insert_saved_query("n1", "SELECT 1")
        row = ws.get_saved_query(sid)
        assert row and row["name"] == "n1" and row["sql"] == "SELECT 1"
        assert ws.update_saved_query(sid, name="n2", sql="SELECT 2")
        row2 = ws.get_saved_query(sid)
        assert row2 and row2["name"] == "n2" and row2["sql"] == "SELECT 2"
        assert ws.delete_saved_query(sid)
        assert ws.get_saved_query(sid) is None
        assert not ws.delete_saved_query(sid)
    finally:
        ws.close()


def test_get_profile_history_meta(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        ws.save_profile_cache("ds_y", {"rows": 1, "columns": 0, "column_profiles": []})
        h = ws.list_profile_history("ds_y", 1)
        hid = h[0]["history_id"]
        m = ws.get_profile_history_meta(hid)
        assert m and m["dataset_id"] == "ds_y"
    finally:
        ws.close()


def test_load_profile_history_blob_missing(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        assert ws.load_profile_history_blob("missing_id") is None
    finally:
        ws.close()


def test_update_saved_query_sql_only(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        sid = ws.insert_saved_query("n", "SELECT 1")
        assert ws.update_saved_query(sid, sql="SELECT 2")
        assert ws.get_saved_query(sid)["sql"] == "SELECT 2"
    finally:
        ws.close()


def test_update_saved_query_missing_returns_false(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        assert not ws.update_saved_query("nope", sql="SELECT 1")
    finally:
        ws.close()


def test_workspace_path_property(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        assert ws.path == tmp_path / "w.duckdb"
    finally:
        ws.close()


def _create_current_workspace_db(db_path: Path) -> None:
    ws = Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))
    ws.close()


def test_workspace_rejects_partial_dcc_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "partial.duckdb"
    con = duckdb.connect(str(db_path))
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
        )
        """
    )
    con.close()

    with pytest.raises(UnsupportedWorkspaceSchemaError, match="missing="):
        Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))


def test_workspace_rejects_missing_source_label_column(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.duckdb"
    _create_current_workspace_db(db_path)
    con = duckdb.connect(str(db_path))
    con.execute("DROP INDEX dcc_datasets_view_name_unique")
    con.execute("ALTER TABLE dcc_datasets DROP COLUMN source_label")
    con.close()

    with pytest.raises(
        UnsupportedWorkspaceSchemaError,
        match="Unsupported workspace database schema",
    ):
        Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))


def test_workspace_rejects_missing_registered_at_column(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.duckdb"
    _create_current_workspace_db(db_path)
    con = duckdb.connect(str(db_path))
    con.execute("DROP INDEX dcc_datasets_view_name_unique")
    con.execute("ALTER TABLE dcc_datasets DROP COLUMN registered_at")
    con.close()

    with pytest.raises(
        UnsupportedWorkspaceSchemaError,
        match="Unsupported workspace database schema",
    ):
        Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))


def test_workspace_rejects_legacy_job_error_column(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.duckdb"
    _create_current_workspace_db(db_path)
    con = duckdb.connect(str(db_path))
    con.execute("ALTER TABLE dcc_jobs ADD COLUMN error VARCHAR")
    con.close()

    with pytest.raises(
        UnsupportedWorkspaceSchemaError,
        match="Unsupported workspace database schema",
    ):
        Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))


def test_workspace_rejects_duplicate_dataset_view_names(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.duckdb"
    _create_current_workspace_db(db_path)
    con = duckdb.connect(str(db_path))
    con.execute("DROP INDEX dcc_datasets_view_name_unique")
    con.execute(
        """
        INSERT INTO dcc_datasets (dataset_id, source_path, source_label, view_name, format)
        VALUES (?, ?, ?, ?, ?)
        """,
        ["ds_001", str(tmp_path / "a.csv"), "a.csv", "data", "csv"],
    )
    con.execute(
        """
        INSERT INTO dcc_datasets (dataset_id, source_path, source_label, view_name, format)
        VALUES (?, ?, ?, ?, ?)
        """,
        ["ds_002", str(tmp_path / "b.csv"), "b.csv", "data", "csv"],
    )
    con.close()

    with pytest.raises(UnsupportedWorkspaceSchemaError, match="duplicate dataset view_name"):
        Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))


def test_workspace_rejects_missing_required_index(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.duckdb"
    _create_current_workspace_db(db_path)
    con = duckdb.connect(str(db_path))
    con.execute("DROP INDEX dcc_ask_turns_conv_seq")
    con.close()

    with pytest.raises(UnsupportedWorkspaceSchemaError, match="index dcc_ask_turns_conv_seq"):
        Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))


def test_job_get_handles_missing_and_invalid_result_json(tmp_path: Path) -> None:
    ws = Workspace(_settings(tmp_path))
    try:
        assert ws.job_get("missing") is None
        ws.job_insert("j1", "profile_refresh", None, "running")
        ws.connection.execute("UPDATE dcc_jobs SET result_json = 'not-json' WHERE job_id = ?", ["j1"])
        job = ws.job_get("j1")
        assert job is not None
        assert job["result"] is None
    finally:
        ws.close()


def test_jobs_list_and_cancel_paths(tmp_path: Path) -> None:
    ws = Workspace(_settings(tmp_path))
    try:
        ws.job_insert("j1", "profile_refresh", "ds_001", "queued")
        ws.job_insert("j2", "dataset_count", "ds_002", "running")
        assert ws.job_request_cancel("j2")
        assert ws.job_cancel_requested("j2")
        assert not ws.job_request_cancel("missing")

        queued = ws.jobs_list(status="queued")
        assert [job["job_id"] for job in queued] == ["j1"]

        all_jobs = ws.jobs_list(limit=10)
        assert {job["job_id"] for job in all_jobs} == {"j1", "j2"}
    finally:
        ws.close()


def test_sleep_poll_calls_time_sleep(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ws = Workspace(_settings(tmp_path))
    seen: list[float] = []

    def fake_sleep(seconds: float) -> None:
        seen.append(seconds)

    monkeypatch.setattr("app.services.workspace_engine.time.sleep", fake_sleep)
    try:
        ws.sleep_poll(0.25)
    finally:
        ws.close()

    assert seen == [0.25]


def test_workspace_recovery_resets_broken_wal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db_path = tmp_path / "w.duckdb"
    wal_path = tmp_path / "w.duckdb.wal"
    db_path.write_text("broken-db")
    wal_path.write_text("broken-wal")

    real_connect = WorkspaceEngine._connect_database
    calls = {"count": 0}

    def flaky_connect(self: WorkspaceEngine):
        calls["count"] += 1
        if calls["count"] == 1:
            raise duckdb.InternalException(
                'INTERNAL Error: Failure while replaying WAL file "x": '
                "Calling DatabaseManager::GetDefaultDatabase with no default database set"
            )
        return real_connect(self)

    monkeypatch.setattr(WorkspaceEngine, "_connect_database", flaky_connect)

    ws = WorkspaceEngine(_settings(tmp_path))
    try:
        assert ws.connection.execute("SELECT 1").fetchone() == (1,)
    finally:
        ws.close()

    assert db_path.exists()
    assert not wal_path.exists()
    assert (tmp_path / "w.duckdb.corrupt").read_text() == "broken-db"
    assert (tmp_path / "w.duckdb.wal.corrupt").read_text() == "broken-wal"


def test_workspace_recovery_ignores_nonrecoverable_open_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def bad_connect(self: WorkspaceEngine):
        raise duckdb.IOException("permission denied")

    monkeypatch.setattr(WorkspaceEngine, "_connect_database", bad_connect)

    with pytest.raises(duckdb.IOException, match="permission denied"):
        WorkspaceEngine(_settings(tmp_path))


def test_workspace_recovery_backup_suffix_avoids_collisions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "w.duckdb"
    wal_path = tmp_path / "w.duckdb.wal"
    db_path.write_text("broken-db")
    wal_path.write_text("broken-wal")
    (tmp_path / "w.duckdb.corrupt").write_text("older-db")
    (tmp_path / "w.duckdb.wal.corrupt").write_text("older-wal")

    real_connect = WorkspaceEngine._connect_database
    calls = {"count": 0}

    def flaky_connect(self: WorkspaceEngine):
        calls["count"] += 1
        if calls["count"] == 1:
            raise duckdb.InternalException(
                'INTERNAL Error: Failure while replaying WAL file "x": '
                "Calling DatabaseManager::GetDefaultDatabase with no default database set"
            )
        return real_connect(self)

    monkeypatch.setattr(WorkspaceEngine, "_connect_database", flaky_connect)

    ws = WorkspaceEngine(_settings(tmp_path))
    ws.close()

    assert (tmp_path / "w.duckdb.corrupt").read_text() == "older-db"
    assert (tmp_path / "w.duckdb.wal.corrupt").read_text() == "older-wal"
    assert (tmp_path / "w.duckdb.corrupt.1").read_text() == "broken-db"
    assert (tmp_path / "w.duckdb.wal.corrupt.1").read_text() == "broken-wal"


def test_recoverable_open_error_rejects_non_duckdb_exception() -> None:
    assert not _is_recoverable_open_error(RuntimeError("boom"))


def test_backup_corrupt_workspace_files_noop_when_missing(tmp_path: Path) -> None:
    ws = WorkspaceEngine.__new__(WorkspaceEngine)
    ws._path = tmp_path / "missing.duckdb"  # type: ignore[attr-defined]
    ws._backup_corrupt_workspace_files()
    assert not ws._path.exists()  # type: ignore[attr-defined]


def test_query_count_reraises_unknown_timeout_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = WorkspaceEngine(_settings(tmp_path))

    class BadCtx:
        def __enter__(self):  # noqa: ANN204
            class Con:
                def execute(self, sql: str):
                    if sql.startswith("PRAGMA"):
                        return None
                    raise RuntimeError("bad timeout setup")

            return Con()

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

    monkeypatch.setattr(ws, "read_db", lambda: BadCtx())
    try:
        with pytest.raises(RuntimeError, match="bad timeout setup"):
            ws.query_count("view_name", 1.0)
    finally:
        ws.close()


def test_query_count_returns_none_when_count_query_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = WorkspaceEngine(_settings(tmp_path))

    class BadCtx:
        def __enter__(self):  # noqa: ANN204
            class Con:
                def execute(self, sql: str):
                    if sql.startswith("PRAGMA") or sql.startswith("SET statement_timeout"):
                        return None
                    raise RuntimeError("count failed")

            return Con()

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

    monkeypatch.setattr(ws, "read_db", lambda: BadCtx())
    try:
        assert ws.query_count("view_name", 1.0) is None
    finally:
        ws.close()


def test_workspace_facade_delegates_to_engine_and_stores(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: dict[str, Any] = {}
    lock_token = object()
    read_token = object()
    connection_token = object()

    class FakeEngine:
        def __init__(self, settings: Settings) -> None:
            calls["engine_settings"] = settings
            self.path = tmp_path / "facade.duckdb"
            self.connection = connection_token

        def lock_db(self):
            calls["lock_db"] = True

            class Ctx:
                def __enter__(self_inner):  # noqa: ANN204
                    return lock_token

                def __exit__(self_inner, exc_type, exc, tb):  # noqa: ANN001, ANN204
                    return False

            return Ctx()

        def read_db(self):
            calls["read_db"] = True

            class Ctx:
                def __enter__(self_inner):  # noqa: ANN204
                    return read_token

                def __exit__(self_inner, exc_type, exc, tb):  # noqa: ANN001, ANN204
                    return False

            return Ctx()

        def close(self) -> None:
            calls["close"] = True

        def drop_view_if_exists(self, view_name: str) -> None:
            calls["drop_view_if_exists"] = view_name

        def register_file_view(self, view_name: str, source_path: Path, file_format: str) -> None:
            calls["register_file_view"] = (view_name, source_path, file_format)

        def get_row_column_counts(self, view_name: str) -> tuple[int, int]:
            calls["get_row_column_counts"] = view_name
            return (12, 3)

        def query_count(self, view_name: str, timeout_seconds: float) -> int | None:
            calls["query_count"] = (view_name, timeout_seconds)
            return 77

        def sleep_poll(self, seconds: float) -> None:
            calls["sleep_poll"] = seconds

    class FakeSchema:
        def initialize(self, con: object) -> None:
            calls["schema_init"] = con

    class FakeProfiles:
        def __init__(self, engine: object) -> None:
            calls["profiles_engine"] = engine

        def save_profile_cache(self, dataset_id: str, profile: dict[str, Any]) -> None:
            calls["save_profile_cache"] = (dataset_id, profile)

        def list_profile_history(self, dataset_id: str, limit: int = 10) -> list[dict[str, Any]]:
            calls["list_profile_history"] = (dataset_id, limit)
            return [{"history_id": "h1"}]

        def load_profile_history_blob(self, history_id: str) -> dict[str, Any] | None:
            calls["load_profile_history_blob"] = history_id
            return {"history_id": history_id}

        def get_profile_history_meta(self, history_id: str) -> dict[str, Any] | None:
            calls["get_profile_history_meta"] = history_id
            return {"history_id": history_id}

        def load_profile_cache(self, dataset_id: str) -> dict[str, Any] | None:
            calls["load_profile_cache"] = dataset_id
            return {"dataset_id": dataset_id}

        def delete_profile_cache(self, dataset_id: str) -> None:
            calls["delete_profile_cache"] = dataset_id

    class FakeSavedQueries:
        def __init__(self, engine: object) -> None:
            calls["saved_engine"] = engine

        def list_saved_queries(self) -> list[dict[str, Any]]:
            calls["list_saved_queries"] = True
            return [{"saved_id": "s1"}]

        def insert_saved_query(self, name: str, sql: str) -> str:
            calls["insert_saved_query"] = (name, sql)
            return "saved-id"

        def update_saved_query(self, saved_id: str, name: str | None = None, sql: str | None = None) -> bool:
            calls["update_saved_query"] = (saved_id, name, sql)
            return True

        def delete_saved_query(self, saved_id: str) -> bool:
            calls["delete_saved_query"] = saved_id
            return True

        def get_saved_query(self, saved_id: str) -> dict[str, Any] | None:
            calls["get_saved_query"] = saved_id
            return {"saved_id": saved_id}

    class FakeJobs:
        def __init__(self, engine: object) -> None:
            calls["jobs_engine"] = engine

        def job_insert(self, job_id: str, kind: str, dataset_id: str | None, status: str) -> None:
            calls["job_insert"] = (job_id, kind, dataset_id, status)

        def job_update(self, job_id: str, **kwargs: Any) -> None:
            calls["job_update"] = (job_id, kwargs)

        def job_finish(self, job_id: str, status: str, error: str | None = None) -> None:
            calls["job_finish"] = (job_id, status, error)

        def job_get(self, job_id: str) -> dict[str, Any] | None:
            calls["job_get"] = job_id
            return {"job_id": job_id}

        def jobs_list(self, limit: int = 100, status: str | None = None) -> list[dict[str, Any]]:
            calls["jobs_list"] = (limit, status)
            return [{"job_id": "j1"}]

        def job_request_cancel(self, job_id: str) -> bool:
            calls["job_request_cancel"] = job_id
            return True

        def job_cancel_requested(self, job_id: str) -> bool:
            calls["job_cancel_requested"] = job_id
            return True

    monkeypatch.setattr("app.services.workspace.WorkspaceEngine", FakeEngine)
    monkeypatch.setattr("app.services.workspace.WorkspaceSchema", FakeSchema)
    monkeypatch.setattr("app.services.workspace.ProfileStore", FakeProfiles)
    monkeypatch.setattr("app.services.workspace.SavedQueryStore", FakeSavedQueries)
    monkeypatch.setattr("app.services.workspace.JobStore", FakeJobs)

    ws = Workspace(_settings(tmp_path))
    assert ws.path == tmp_path / "facade.duckdb"
    assert ws.connection is connection_token
    assert calls["schema_init"] is lock_token
    assert calls["profiles_engine"] is ws._engine
    assert calls["saved_engine"] is ws._engine
    assert calls["jobs_engine"] is ws._engine

    assert ws.lock_db().__enter__() is lock_token
    assert ws.read_db().__enter__() is read_token
    ws.drop_view_if_exists("view_a")
    ws.register_file_view("view_a", tmp_path / "a.csv", "csv")
    assert ws.get_row_column_counts("view_a") == (12, 3)
    assert ws.query_count("view_a", 1.5) == 77
    ws.save_profile_cache("ds_1", {"quality_score": 88})
    assert ws.list_profile_history("ds_1", 4) == [{"history_id": "h1"}]
    assert ws.load_profile_history_blob("h1") == {"history_id": "h1"}
    assert ws.list_saved_queries() == [{"saved_id": "s1"}]
    assert ws.insert_saved_query("saved", "SELECT 1") == "saved-id"
    assert ws.update_saved_query("saved-id", name="renamed", sql="SELECT 2") is True
    assert ws.delete_saved_query("saved-id") is True
    assert ws.get_saved_query("saved-id") == {"saved_id": "saved-id"}
    assert ws.get_profile_history_meta("h1") == {"history_id": "h1"}
    assert ws.load_profile_cache("ds_1") == {"dataset_id": "ds_1"}
    ws.delete_profile_cache("ds_1")
    ws.job_insert("job-1", "profile", "ds_1", "queued")
    ws.job_update(
        "job-1",
        status="running",
        progress=0.5,
        error_code="E1",
        error_message="boom",
        result_json={"ok": True},
        finished=True,
    )
    ws.job_finish("job-1", "completed", None)
    assert ws.job_get("job-1") == {"job_id": "job-1"}
    assert ws.jobs_list(8, "queued") == [{"job_id": "j1"}]
    assert ws.job_request_cancel("job-1") is True
    assert ws.job_cancel_requested("job-1") is True
    ws.sleep_poll(0.25)
    ws.close()

    assert calls["drop_view_if_exists"] == "view_a"
    assert calls["register_file_view"] == ("view_a", tmp_path / "a.csv", "csv")
    assert calls["save_profile_cache"] == ("ds_1", {"quality_score": 88})
    assert calls["update_saved_query"] == ("saved-id", "renamed", "SELECT 2")
    assert calls["job_insert"] == ("job-1", "profile", "ds_1", "queued")
    assert calls["job_update"] == (
        "job-1",
        {
            "status": "running",
            "progress": 0.5,
            "error_code": "E1",
            "error_message": "boom",
            "result_json": {"ok": True},
            "finished": True,
        },
    )
    assert calls["job_finish"] == ("job-1", "completed", None)
    assert calls["jobs_list"] == (8, "queued")
    assert calls["sleep_poll"] == 0.25
    assert calls["close"] is True
