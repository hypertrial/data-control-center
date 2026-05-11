"""DatasetRegistry edge cases."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.services.registry import (
    DatasetRegistry,
    guard_reserved_identifier,
    pick_unique_view_name,
    slugify_file_stem,
)
from app.services.workspace import Workspace


def test_register_path_unsupported_extension(tmp_path: Path) -> None:
    bad = tmp_path / "x.exe"
    bad.write_bytes(b"\x00")
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    with pytest.raises(ValueError, match="Unsupported"):
        reg.register_path(bad)


def test_register_path_directory_error(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    with pytest.raises(IsADirectoryError):
        reg.register_path(tmp_path)


def test_register_path_tsv_extension(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    t = tmp_path / "t.tsv"
    t.write_text("x\ty\n1\t2\n")
    ds = reg.register_path(t)
    assert ds.format == "csv"
    assert ds.view_name == "t"


def test_register_folder_skips_valueerror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "ok.csv").write_text("a\n1\n")
    (tmp_path / "bad.csv").write_text("b\n2\n")

    real = reg.register_path

    def selective_register(self, p):  # noqa: ANN001
        if p.name == "bad.csv":
            raise ValueError("bad")
        return real(p)

    monkeypatch.setattr(DatasetRegistry, "register_path", selective_register)
    out = reg.register_folder(tmp_path, recursive=False)
    assert len(out) == 1


def test_register_folder_skips_unsupported_files(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "good.csv").write_text("a\n1\n")
    (tmp_path / "bad.exe").write_bytes(b"y")
    out = reg.register_folder(tmp_path, recursive=False)
    assert len(out) == 1


def test_register_folder_recursive(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "inner.csv").write_text("b\n2\n")
    assert len(reg.register_folder(tmp_path, recursive=True)) == 1


def test_registry_persists_ids(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    csv = tmp_path / "a.csv"
    csv.write_text("z\n1\n")
    ws = Workspace(settings)
    r1 = DatasetRegistry(ws)
    ds = r1.register_path(csv)
    ws.close()
    ws2 = Workspace(settings)
    r2 = DatasetRegistry(ws2)
    got = r2.get(ds.dataset_id)
    assert got is not None
    assert got.view_name == ds.view_name
    ws2.close()


def test_jsonl_registers_as_json(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
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
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    p = tmp_path / "player_ratings_2006_2026.csv"
    p.write_text("a\n1\n")
    ds = reg.register_path(p)
    assert ds.view_name == "player_ratings_2006_2026"


def test_register_path_duplicate_stem_in_different_dirs(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
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


def test_register_path_reserved_keyword_stem(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    p = tmp_path / "order.csv"
    p.write_text("a\n1\n")
    ds = reg.register_path(p)
    assert ds.view_name == "order_dcc"
