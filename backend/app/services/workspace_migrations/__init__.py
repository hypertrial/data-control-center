"""Versioned workspace schema migrations."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Callable

import duckdb

from app.config import Settings

from . import registry

logger = logging.getLogger(__name__)


def _migrations():
    return registry.MIGRATIONS


def _current_version() -> int:
    migrations = _migrations()
    return max(m.version for m in migrations) if migrations else 0


CURRENT_VERSION = _current_version()

UpgradeFn = Callable[[duckdb.DuckDBPyConnection], None]


def _schema_version_table_exists(con: duckdb.DuckDBPyConnection) -> bool:
    row = con.execute(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = 'main' AND table_name = 'schema_version'
        """
    ).fetchone()
    return bool(row and int(row[0]) > 0)


def _read_schema_version(con: duckdb.DuckDBPyConnection) -> int | None:
    if not _schema_version_table_exists(con):
        return None
    row = con.execute("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1").fetchone()
    return int(row[0]) if row else None


def _write_schema_version(con: duckdb.DuckDBPyConnection, version: int, description: str) -> None:
    if not _schema_version_table_exists(con):
        con.execute(
            """
            CREATE TABLE schema_version (
              version INTEGER NOT NULL,
              applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              description VARCHAR
            );
            """
        )
    con.execute("DELETE FROM schema_version")
    con.execute(
        "INSERT INTO schema_version (version, description) VALUES (?, ?)",
        [version, description],
    )


def _existing_dcc_tables(con: duckdb.DuckDBPyConnection) -> set[str]:
    rows = con.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
          AND table_type = 'BASE TABLE'
          AND table_name LIKE 'dcc_%'
        """
    ).fetchall()
    return {str(row[0]) for row in rows}


def _maybe_backup_db(db_path: Path, *, target_version: int) -> None:
    backup = db_path.with_suffix(db_path.suffix + f".pre-migrate-v{target_version}")
    shutil.copy2(db_path, backup)
    logger.info("Workspace backup before migration: %s", backup.name)


def run_migrations(con: duckdb.DuckDBPyConnection, settings: Settings) -> None:
    """Apply pending migrations or stamp an implicit baseline."""
    from app.services.workspace_schema import UnsupportedWorkspaceSchemaError, _validate_schema

    stored = _read_schema_version(con)
    dcc_tables = _existing_dcc_tables(con)

    current = _current_version()

    if stored is None and not dcc_tables:
        for migration in _migrations():
            migration.upgrade(con)
            _write_schema_version(con, migration.version, migration.description)
        return

    if stored is None and dcc_tables:
        _validate_schema(con)
        _write_schema_version(con, current, "implicit baseline")
        logger.info(
            "Stamped workspace schema_version=%s (implicit baseline, no DDL)",
            current,
        )
        return

    if stored is not None and stored > current:
        raise UnsupportedWorkspaceSchemaError(
            f"workspace was created by a newer Data Control Center (schema version {stored}); "
            "downgrade is not supported"
        )

    if stored is not None and stored < current:
        db_path = settings.workspace_db_path.expanduser().resolve()
        if settings.workspace_backup_before_migrate and db_path.is_file():
            _maybe_backup_db(db_path, target_version=current)
        for migration in _migrations():
            if migration.version <= stored:
                continue
            migration.upgrade(con)
            _write_schema_version(con, migration.version, migration.description)
