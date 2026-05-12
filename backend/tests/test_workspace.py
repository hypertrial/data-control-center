"""Workspace and SQL identifier helpers."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from app.config import Settings
from app.services.workspace import Workspace, sanitize_sql_identifier


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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        p = tmp_path / "f.csv"
        p.write_text("a\n1\n")
        with pytest.raises(ValueError, match="Unsupported format"):
            ws.register_file_view("x", p, "weird")
    finally:
        ws.close()


def test_register_file_view_missing_file(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        missing = tmp_path / "nope.csv"
        with pytest.raises(FileNotFoundError):
            ws.register_file_view("x", missing, "csv")
    finally:
        ws.close()


def test_profile_cache_roundtrip(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        pq = tmp_path / "p.parquet"
        pl.DataFrame({"a": [1]}).write_parquet(pq)
        ws.register_file_view("vd", pq, "parquet")
        ws.drop_view_if_exists("vd")
    finally:
        ws.close()


def test_jobs_insert_and_finish(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        ws.job_insert("jid", "profile_refresh", "ds_001", "running")
        ws.job_finish("jid", "failed", "oops")
        row = ws.connection.execute(
            "SELECT status, error FROM dcc_jobs WHERE job_id = ?",
            ["jid"],
        ).fetchone()
        assert row == ("failed", "oops")
    finally:
        ws.close()


def test_profile_history_pruned_to_fifty(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        assert ws.load_profile_history_blob("missing_id") is None
    finally:
        ws.close()


def test_update_saved_query_sql_only(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        sid = ws.insert_saved_query("n", "SELECT 1")
        assert ws.update_saved_query(sid, sql="SELECT 2")
        assert ws.get_saved_query(sid)["sql"] == "SELECT 2"
    finally:
        ws.close()


def test_update_saved_query_missing_returns_false(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    try:
        assert not ws.update_saved_query("nope", sql="SELECT 1")
    finally:
        ws.close()
