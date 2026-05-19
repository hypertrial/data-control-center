"""Tests for versioned workspace schema migrations."""

from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from app.config import Settings
from app.services.workspace import Workspace
from app.services.workspace_migrations import CURRENT_VERSION, run_migrations
from app.services.workspace_migrations.registry import MIGRATIONS
from app.services.workspace_schema import UnsupportedWorkspaceSchemaError, _validate_schema


def _settings(tmp_path: Path, **kwargs: object) -> Settings:
    return Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
        **kwargs,
    )


def test_fresh_db_runs_migrations_and_validates(tmp_path: Path) -> None:
    path = tmp_path / "w.duckdb"
    settings = _settings(tmp_path)
    con = duckdb.connect(str(path))
    try:
        run_migrations(con, settings)
        _validate_schema(con)
        version = con.execute("SELECT version FROM schema_version").fetchone()
        assert version is not None
        assert int(version[0]) == CURRENT_VERSION
    finally:
        con.close()


def test_existing_current_schema_gets_implicit_baseline_stamp(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    ws.close()
    assert settings.workspace_db_path.is_file()

    con = duckdb.connect(str(settings.workspace_db_path))
    try:
        con.execute("DELETE FROM schema_version")
        con.execute("DROP TABLE schema_version")
    finally:
        con.close()

    ws2 = Workspace(settings)
    try:
        con2 = ws2.connection
        row = con2.execute("SELECT version, description FROM schema_version").fetchone()
        assert row is not None
        assert int(row[0]) == CURRENT_VERSION
        assert "baseline" in str(row[1]).lower()
    finally:
        ws2.close()


def test_downgrade_refused(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    con = ws.connection
    con.execute("DELETE FROM schema_version")
    con.execute("INSERT INTO schema_version (version, description) VALUES (?, ?)", [99, "future"])
    ws.close()

    with pytest.raises(UnsupportedWorkspaceSchemaError, match="newer Data Control Center"):
        Workspace(settings)


def test_failed_migration_does_not_bump_version(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(tmp_path, workspace_backup_before_migrate=False)
    ws = Workspace(settings)
    ws.close()

    def boom(_con: duckdb.DuckDBPyConnection) -> None:
        raise RuntimeError("migration failed")

    from app.services.workspace_migrations.registry import Migration

    broken = Migration(2, "broken", boom)
    monkeypatch.setattr(
        "app.services.workspace_migrations.registry.MIGRATIONS",
        (MIGRATIONS[0], broken),
    )

    con = duckdb.connect(str(settings.workspace_db_path))
    try:
        con.execute("DELETE FROM schema_version")
        con.execute("INSERT INTO schema_version (version, description) VALUES (1, 'baseline')")
        con.close()
        with pytest.raises(RuntimeError, match="migration failed"):
            Workspace(settings)
        con = duckdb.connect(str(settings.workspace_db_path))
        row = con.execute("SELECT MAX(version) FROM schema_version").fetchone()
        assert row is not None
        assert int(row[0]) == 1
    finally:
        con.close()
