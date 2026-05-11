"""DatasetRegistry edge cases."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.services.registry import DatasetRegistry
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
    assert r2.get(ds.dataset_id) is not None
    ws2.close()


def test_jsonl_registers_as_json(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    jl = tmp_path / "l.jsonl"
    jl.write_text('{"a":1}\n{"a":2}\n')
    ds = reg.register_path(jl)
    assert ds.format == "json"
