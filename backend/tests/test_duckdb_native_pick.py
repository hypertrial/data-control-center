"""Tests for native DuckDB file picker helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.services import duckdb_native_pick as pick_mod
from app.services.duckdb_native_pick import native_pick_available, pick_local_duckdb_path


def test_native_pick_available_is_bool() -> None:
    assert isinstance(native_pick_available(), bool)


def test_native_pick_available_macos_uses_osascript(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "darwin")
    monkeypatch.setattr(pick_mod.shutil, "which", lambda cmd: "/usr/bin/osascript" if cmd == "osascript" else None)
    assert native_pick_available() is True


def test_native_pick_available_macos_without_osascript(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "darwin")
    monkeypatch.setattr(pick_mod.shutil, "which", lambda _cmd: None)
    assert native_pick_available() is False


def test_pick_macos_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "darwin")

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        assert cmd[0] == "osascript"
        return subprocess.CompletedProcess(cmd, 0, "/data/sample.duckdb\n", "")

    monkeypatch.setattr(pick_mod.subprocess, "run", fake_run)
    assert pick_local_duckdb_path() == Path("/data/sample.duckdb")


def test_pick_macos_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "darwin")

    def fake_run(cmd: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        return subprocess.CompletedProcess(cmd, 1, "", "User canceled.")

    monkeypatch.setattr(pick_mod.subprocess, "run", fake_run)
    assert pick_local_duckdb_path() is None


def test_pick_local_duckdb_path_cancelled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "linux")

    class FakeRoot:
        def withdraw(self) -> None:
            return None

        def update_idletasks(self) -> None:
            return None

        def destroy(self) -> None:
            return None

        def attributes(self, *_args: object, **_kwargs: object) -> None:
            return None

    monkeypatch.setattr("tkinter.Tk", FakeRoot)
    monkeypatch.setattr("tkinter.filedialog.askopenfilename", lambda **_kwargs: "")
    assert pick_local_duckdb_path() is None


def test_pick_local_duckdb_path_ignores_topmost_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    import tkinter as tk

    monkeypatch.setattr(pick_mod.sys, "platform", "linux")

    class FakeRoot:
        def withdraw(self) -> None:
            return None

        def update_idletasks(self) -> None:
            return None

        def destroy(self) -> None:
            return None

        def attributes(self, *_args: object, **_kwargs: object) -> None:
            raise tk.TclError("unsupported")

    monkeypatch.setattr("tkinter.Tk", FakeRoot)
    monkeypatch.setattr(
        "tkinter.filedialog.askopenfilename",
        lambda **_kwargs: "/tmp/topmost.duckdb",
    )
    assert pick_local_duckdb_path() == Path("/tmp/topmost.duckdb")


def test_pick_local_duckdb_path_returns_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "linux")

    class FakeRoot:
        def withdraw(self) -> None:
            return None

        def update_idletasks(self) -> None:
            return None

        def destroy(self) -> None:
            return None

        def attributes(self, *_args: object, **_kwargs: object) -> None:
            return None

    monkeypatch.setattr("tkinter.Tk", FakeRoot)
    monkeypatch.setattr(
        "tkinter.filedialog.askopenfilename",
        lambda **_kwargs: "/tmp/sample.duckdb",
    )
    assert pick_local_duckdb_path() == Path("/tmp/sample.duckdb")


def test_native_pick_unavailable_when_tkinter_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pick_mod.sys, "platform", "linux")
    monkeypatch.setattr(pick_mod, "_tkinter_pick_available", lambda: False)
    assert native_pick_available() is False


def test_tkinter_pick_available_true(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeRoot:
        def withdraw(self) -> None:
            return None

        def destroy(self) -> None:
            return None

    monkeypatch.setattr("tkinter.Tk", FakeRoot)
    assert pick_mod._tkinter_pick_available() is True


def test_tkinter_pick_available_false_on_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: object, **kwargs: object):
        if name == "tkinter":
            raise ImportError("no tk")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert pick_mod._tkinter_pick_available() is False


def test_tkinter_pick_available_false_on_tcl_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import tkinter as tk

    def boom() -> object:
        raise tk.TclError("no display")

    monkeypatch.setattr("tkinter.Tk", boom)
    assert pick_mod._tkinter_pick_available() is False


def test_pick_and_register_surfaces_picker_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.errors import AppError
    from app.services.duckdb_import import pick_and_register_local_duckdb
    from app.services.registry import DatasetRegistry
    from app.services.workspace import Workspace
    from app.config import Settings

    settings = Settings(
        workspace_db_path=tmp_path / "workspace.duckdb",
        upload_dir=tmp_path / "uploads",
        enable_path_registration=True,
        allow_arbitrary_registration_paths=True,
    )
    registry = DatasetRegistry(Workspace(settings), settings)

    def boom() -> Path | None:
        raise RuntimeError("picker broke")

    monkeypatch.setattr("app.services.duckdb_native_pick.pick_local_duckdb_path", boom)
    monkeypatch.setattr("app.services.duckdb_native_pick.native_pick_available", lambda: True)

    with pytest.raises(AppError, match="Native file picker failed"):
        pick_and_register_local_duckdb(registry=registry, settings=settings)
