"""Workspace and SQL identifier helpers."""

from __future__ import annotations

from pathlib import Path

import duckdb
import polars as pl
import pytest

from app.config import Settings
from app.services.workspace import Workspace, _is_recoverable_open_error, sanitize_sql_identifier


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


def test_workspace_migrates_legacy_job_error_column(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.duckdb"
    con = duckdb.connect(str(db_path))
    con.execute(
        """
        CREATE TABLE dcc_jobs (
          job_id VARCHAR PRIMARY KEY,
          kind VARCHAR NOT NULL,
          dataset_id VARCHAR,
          status VARCHAR NOT NULL,
          progress DOUBLE DEFAULT 0,
          error VARCHAR
        )
        """
    )
    con.execute(
        "INSERT INTO dcc_jobs (job_id, kind, dataset_id, status, progress, error) VALUES (?, ?, ?, ?, ?, ?)",
        ["j1", "profile_refresh", "ds_001", "failed", 1.0, "legacy boom"],
    )
    con.close()

    ws = Workspace(Settings(workspace_db_path=db_path, allow_arbitrary_registration_paths=True))
    try:
        row = ws.connection.execute(
            "SELECT error_message FROM dcc_jobs WHERE job_id = ?",
            ["j1"],
        ).fetchone()
        assert row == ("legacy boom",)
    finally:
        ws.close()


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

    monkeypatch.setattr("app.services.workspace.time.sleep", fake_sleep)
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

    real_connect = Workspace._connect_database
    calls = {"count": 0}

    def flaky_connect(self: Workspace):
        calls["count"] += 1
        if calls["count"] == 1:
            raise duckdb.InternalException(
                'INTERNAL Error: Failure while replaying WAL file "x": '
                "Calling DatabaseManager::GetDefaultDatabase with no default database set"
            )
        return real_connect(self)

    monkeypatch.setattr(Workspace, "_connect_database", flaky_connect)

    ws = Workspace(_settings(tmp_path))
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
    def bad_connect(self: Workspace):
        raise duckdb.IOException("permission denied")

    monkeypatch.setattr(Workspace, "_connect_database", bad_connect)

    with pytest.raises(duckdb.IOException, match="permission denied"):
        Workspace(_settings(tmp_path))


def test_workspace_recovery_backup_suffix_avoids_collisions(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    db_path = tmp_path / "w.duckdb"
    wal_path = tmp_path / "w.duckdb.wal"
    db_path.write_text("broken-db")
    wal_path.write_text("broken-wal")
    (tmp_path / "w.duckdb.corrupt").write_text("older-db")
    (tmp_path / "w.duckdb.wal.corrupt").write_text("older-wal")

    real_connect = Workspace._connect_database
    calls = {"count": 0}

    def flaky_connect(self: Workspace):
        calls["count"] += 1
        if calls["count"] == 1:
            raise duckdb.InternalException(
                'INTERNAL Error: Failure while replaying WAL file "x": '
                "Calling DatabaseManager::GetDefaultDatabase with no default database set"
            )
        return real_connect(self)

    monkeypatch.setattr(Workspace, "_connect_database", flaky_connect)

    ws = Workspace(_settings(tmp_path))
    ws.close()

    assert (tmp_path / "w.duckdb.corrupt").read_text() == "older-db"
    assert (tmp_path / "w.duckdb.wal.corrupt").read_text() == "older-wal"
    assert (tmp_path / "w.duckdb.corrupt.1").read_text() == "broken-db"
    assert (tmp_path / "w.duckdb.wal.corrupt.1").read_text() == "broken-wal"


def test_recoverable_open_error_rejects_non_duckdb_exception() -> None:
    assert not _is_recoverable_open_error(RuntimeError("boom"))


def test_backup_corrupt_workspace_files_noop_when_missing(tmp_path: Path) -> None:
    ws = Workspace.__new__(Workspace)
    ws._path = tmp_path / "missing.duckdb"  # type: ignore[attr-defined]
    ws._backup_corrupt_workspace_files()
    assert not ws._path.exists()  # type: ignore[attr-defined]


def test_query_count_reraises_unknown_timeout_setup_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = Workspace(_settings(tmp_path))

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
