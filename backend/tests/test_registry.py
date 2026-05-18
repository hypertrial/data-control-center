"""DatasetRegistry edge cases."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb
import pytest

from app.config import Settings
from app.errors import AppError
from app.services.registry import (
    DatasetRegistry,
    guard_reserved_identifier,
    pick_unique_view_name,
    slugify_file_stem,
)
from app.services.workspace import UnsupportedWorkspaceSchemaError, Workspace, sanitize_sql_identifier


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )


def test_register_path_unsupported_extension(tmp_path: Path) -> None:
    bad = tmp_path / "x.exe"
    bad.write_bytes(b"\x00")
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    with pytest.raises(ValueError, match="Unsupported"):
        reg.register_path(bad)


def test_register_path_directory_error(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    with pytest.raises(IsADirectoryError):
        reg.register_path(tmp_path)


def test_register_path_tsv_extension(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    t = tmp_path / "t.tsv"
    t.write_text("x\ty\n1\t2\n")
    ds = reg.register_path(t)
    assert ds.format == "csv"
    assert ds.view_name == "t"


def test_register_folder_skips_valueerror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    (tmp_path / "ok.csv").write_text("a\n1\n")
    (tmp_path / "bad.csv").write_text("b\n2\n")

    real = reg.register_path

    def selective_register(self, p, *, compute_counts=True):  # noqa: ANN001, ARG001
        if p.name == "bad.csv":
            raise ValueError("bad")
        return real(p, compute_counts=compute_counts)

    monkeypatch.setattr(DatasetRegistry, "register_path", selective_register)
    out = reg.register_folder(tmp_path, recursive=False)
    assert len(out) == 1


def test_register_folder_skips_unsupported_files(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    (tmp_path / "good.csv").write_text("a\n1\n")
    (tmp_path / "bad.exe").write_bytes(b"y")
    out = reg.register_folder(tmp_path, recursive=False)
    assert len(out) == 1


def test_register_folder_recursive(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "inner.csv").write_text("b\n2\n")
    assert len(reg.register_folder(tmp_path, recursive=True)) == 1


def test_registry_persists_ids(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    csv = tmp_path / "a.csv"
    csv.write_text("z\n1\n")
    ws = Workspace(settings)
    r1 = DatasetRegistry(ws, settings)
    ds = r1.register_path(csv)
    ws.close()
    ws2 = Workspace(settings)
    r2 = DatasetRegistry(ws2, settings)
    got = r2.get(ds.dataset_id)
    assert got is not None
    assert got.view_name == ds.view_name
    ws2.close()


def test_registry_persists_dataset_view_with_dcc_prefix(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    csv = tmp_path / "dcc_report.csv"
    csv.write_text("z\n1\n")
    ws = Workspace(settings)
    r1 = DatasetRegistry(ws, settings)
    ds = r1.register_path(csv)
    assert ds.view_name == "dcc_report"
    ws.close()

    ws2 = Workspace(settings)
    try:
        r2 = DatasetRegistry(ws2, settings)
        got = r2.get(ds.dataset_id)
        assert got is not None
        assert got.view_name == "dcc_report"
    finally:
        ws2.close()


def test_jsonl_registers_as_json(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    jl = tmp_path / "l.jsonl"
    jl.write_text('{"a":1}\n{"a":2}\n')
    ds = reg.register_path(jl)
    assert ds.format == "json"


def test_slugify_file_stem() -> None:
    assert slugify_file_stem("player ratings", "ds_001") == "player_ratings"


def test_slugify_empty_stem_falls_back_to_dataset_id() -> None:
    assert slugify_file_stem("???", "ds_007") == "dataset_ds_007"


def test_slugify_truncated_empty_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.registry.MAX_VIEW_STEM_LEN", 0)
    assert slugify_file_stem("hello", "ds_010") == "dataset_ds_010"


def test_guard_reserved_identifier() -> None:
    assert guard_reserved_identifier("order") == "order_dcc"


def test_pick_unique_view_name() -> None:
    assert pick_unique_view_name("x", "ds_002", {"x"}) == "x_ds_002"
    assert pick_unique_view_name("x", "ds_003", {"x", "x_ds_003"}) == "x_ds_003_2"


def test_register_path_view_name_from_long_stem_csv(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    p = tmp_path / "player_ratings_2006_2026.csv"
    p.write_text("a\n1\n")
    ds = reg.register_path(p)
    assert ds.view_name == "player_ratings_2006_2026"


def test_register_path_duplicate_stem_in_different_dirs(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    xa = tmp_path / "x"
    ya = tmp_path / "y"
    xa.mkdir()
    ya.mkdir()
    f1 = xa / "data.csv"
    f2 = ya / "data.csv"
    f1.write_text("a\n1\n")
    f2.write_text("b\n2\n")
    d1 = reg.register_path(f1)
    d2 = reg.register_path(f2)
    assert d1.view_name == "data"
    assert d2.view_name == f"data_{d2.dataset_id}"


def test_register_path_duplicate_stem_concurrent_gets_distinct_views(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    xa = tmp_path / "x"
    ya = tmp_path / "y"
    xa.mkdir()
    ya.mkdir()
    f1 = xa / "data.csv"
    f2 = ya / "data.csv"
    f1.write_text("a\n1\n")
    f2.write_text("a\n2\n")

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            d1, d2 = list(pool.map(lambda p: reg.register_path(p), [f1, f2]))

        assert d1.dataset_id != d2.dataset_id
        assert d1.view_name != d2.view_name
        rows = ws.connection.execute(
            "SELECT dataset_id, view_name FROM dcc_datasets ORDER BY dataset_id"
        ).fetchall()
        assert len(rows) == 2
        assert len({r[1] for r in rows}) == 2
        assert ws.connection.execute(f"SELECT a FROM {d1.view_name}").fetchone()[0] == 1
        assert ws.connection.execute(f"SELECT a FROM {d2.view_name}").fetchone()[0] == 2
    finally:
        ws.close()


def test_register_path_drops_created_view_when_later_step_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    csv = tmp_path / "data.csv"
    csv.write_text("a\n1\n")

    def fail_counts(_view_name: str) -> tuple[int, int]:
        raise RuntimeError("count failed")

    monkeypatch.setattr(ws, "get_row_column_counts", fail_counts)
    try:
        with pytest.raises(RuntimeError, match="count failed"):
            reg.register_path(csv)
        assert "data" not in {ds.view_name for ds in reg.list_all()}
        with pytest.raises(duckdb.CatalogException):
            ws.connection.execute("SELECT * FROM data").fetchall()
    finally:
        ws.close()


def test_workspace_schema_enforces_unique_dataset_view_names(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        idx = ws.connection.execute(
            """
            SELECT index_name, is_unique
            FROM duckdb_indexes()
            WHERE table_name = 'dcc_datasets'
              AND index_name = 'dcc_datasets_view_name_unique'
            """
        ).fetchone()
        assert idx == ("dcc_datasets_view_name_unique", True)
    finally:
        ws.close()


def test_registry_rejects_legacy_v_dataset_view_on_load(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        csv = tmp_path / "player_ratings_2006_2026.csv"
        csv.write_text("id\n1\n")
        ws.register_file_view("v_ds_001", csv, "csv")
        rows, cols = ws.get_row_column_counts("v_ds_001")
        sz = csv.stat().st_size
        ws.connection.execute(
            """
            INSERT INTO dcc_datasets (
                dataset_id, source_path, source_label, view_name, format,
                row_count, column_count, file_size_bytes
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            ["ds_001", str(csv.resolve()), csv.name, "v_ds_001", "csv", rows, cols, sz],
        )
        with pytest.raises(UnsupportedWorkspaceSchemaError, match="legacy dataset view names"):
            DatasetRegistry(ws, settings)
    finally:
        ws.close()


def test_register_path_reserved_keyword_stem(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    p = tmp_path / "order.csv"
    p.write_text("a\n1\n")
    ds = reg.register_path(p)
    assert ds.view_name == "order_dcc"


def test_registration_allowed_roots_support_relative_paths(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    csv = allowed / "ok.csv"
    csv.write_text("a\n1\n")
    monkeypatch.chdir(tmp_path)
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        registration_allowed_roots=[Path("allowed")],
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    ds = reg.register_path(csv)
    assert ds.source_path == csv.resolve()


def test_registration_allowed_roots_try_multiple_candidates(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    other = tmp_path / "other"
    allowed.mkdir()
    other.mkdir()
    csv = allowed / "ok.csv"
    csv.write_text("a\n1\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        registration_allowed_roots=[other, allowed],
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    ds = reg.register_path(csv)
    assert ds.source_path == csv.resolve()


def test_set_counts_missing_dataset_is_noop(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    reg.set_counts("missing", 1, 2)
    assert reg.get("missing") is None


def test_registration_denied_after_all_roots_checked(tmp_path: Path) -> None:
    allowed = tmp_path / "allowed"
    other = tmp_path / "other"
    allowed.mkdir()
    other.mkdir()
    blocked = tmp_path / "blocked.csv"
    blocked.write_text("a\n1\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        registration_allowed_roots=[other, allowed],
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    with pytest.raises(AppError, match="outside allowed registration roots"):
        reg.register_path(blocked)


def test_unregister_removes_dataset_view_and_profile_state(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    p = tmp_path / "gone.csv"
    p.write_text("a\n1\n")
    ds = reg.register_path(p)
    ws.save_profile_cache(ds.dataset_id, {"rows": 1, "columns": 1, "column_profiles": []})
    ws.job_insert("job_1", "profile_refresh", ds.dataset_id, "running")

    assert reg.unregister(ds.dataset_id)
    assert reg.get(ds.dataset_id) is None
    assert not reg.unregister(ds.dataset_id)
    assert ws.load_profile_cache(ds.dataset_id) is None
    assert ws.list_profile_history(ds.dataset_id) == []
    assert ws.connection.execute(
        "SELECT dataset_id FROM dcc_datasets WHERE dataset_id = ?",
        [ds.dataset_id],
    ).fetchone() is None
    assert ws.connection.execute(
        "SELECT job_id FROM dcc_jobs WHERE dataset_id = ?",
        [ds.dataset_id],
    ).fetchone() is None
    with pytest.raises(Exception):
        ws.connection.execute(f"SELECT COUNT(*) FROM {sanitize_sql_identifier(ds.view_name)}")
