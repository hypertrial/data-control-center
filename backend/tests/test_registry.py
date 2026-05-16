"""DatasetRegistry edge cases."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.errors import AppError
from app.services.registry import (
    DatasetRegistry,
    guard_reserved_identifier,
    pick_unique_view_name,
    slugify_file_stem,
)
from app.services.workspace import Workspace, sanitize_sql_identifier


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


def test_migrate_legacy_v_dataset_view_on_load(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    csv = tmp_path / "player_ratings_2006_2026.csv"
    csv.write_text("id\n1\n")
    ws.register_file_view("v_ds_001", csv, "csv")
    rows, cols = ws.get_row_column_counts("v_ds_001")
    sz = csv.stat().st_size
    ws.connection.execute(
        """
        INSERT INTO dcc_datasets (
            dataset_id, source_path, source_label, view_name, format, row_count, column_count, file_size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ["ds_001", str(csv.resolve()), csv.name, "v_ds_001", "csv", rows, cols, sz],
    )
    reg = DatasetRegistry(ws, settings)
    ds = reg.get("ds_001")
    assert ds is not None
    assert ds.view_name == "player_ratings_2006_2026"
    db_row = ws.connection.execute(
        "SELECT view_name FROM dcc_datasets WHERE dataset_id = 'ds_001'"
    ).fetchone()
    assert db_row is not None and db_row[0] == "player_ratings_2006_2026"
    safe = sanitize_sql_identifier(ds.view_name)
    assert ws.connection.execute(f"SELECT COUNT(*) FROM {safe}").fetchone()[0] == rows


def test_migrate_legacy_skips_missing_source_file(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    csv = tmp_path / "gone.csv"
    csv.write_text("a\n1\n")
    ws.register_file_view("v_ds_001", csv, "csv")
    rows, cols = ws.get_row_column_counts("v_ds_001")
    sz = csv.stat().st_size
    resolved = str(csv.resolve())
    csv.unlink()
    ws.connection.execute(
        """
        INSERT INTO dcc_datasets (
            dataset_id, source_path, source_label, view_name, format, row_count, column_count, file_size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ["ds_001", resolved, "gone.csv", "v_ds_001", "csv", rows, cols, sz],
    )
    reg = DatasetRegistry(ws, settings)
    ds = reg.get("ds_001")
    assert ds is not None
    assert ds.view_name == "v_ds_001"


def test_migrate_legacy_noop_when_stem_matches_existing_view_name(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    csv = tmp_path / "v_ds_001.csv"
    csv.write_text("a\n1\n")
    ws.register_file_view("v_ds_001", csv, "csv")
    rows, cols = ws.get_row_column_counts("v_ds_001")
    sz = csv.stat().st_size
    ws.connection.execute(
        """
        INSERT INTO dcc_datasets (
            dataset_id, source_path, source_label, view_name, format, row_count, column_count, file_size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ["ds_001", str(csv.resolve()), csv.name, "v_ds_001", "csv", rows, cols, sz],
    )
    reg = DatasetRegistry(ws, settings)
    assert reg.get("ds_001") is not None
    assert reg.get("ds_001").view_name == "v_ds_001"


def test_migrate_legacy_register_failure_keeps_old_view_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    csv = tmp_path / "z.csv"
    csv.write_text("a\n1\n")
    ws.register_file_view("v_ds_001", csv, "csv")
    rows, cols = ws.get_row_column_counts("v_ds_001")
    sz = csv.stat().st_size
    ws.connection.execute(
        """
        INSERT INTO dcc_datasets (
            dataset_id, source_path, source_label, view_name, format, row_count, column_count, file_size_bytes
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ["ds_001", str(csv.resolve()), csv.name, "v_ds_001", "csv", rows, cols, sz],
    )

    def boom(*_args, **_kwargs) -> None:
        raise OSError("register blocked")

    monkeypatch.setattr(ws, "register_file_view", boom)
    reg = DatasetRegistry(ws, settings)
    assert reg.get("ds_001") is not None
    assert reg.get("ds_001").view_name == "v_ds_001"


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
