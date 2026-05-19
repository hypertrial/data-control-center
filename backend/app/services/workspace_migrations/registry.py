"""Ordered workspace migration registry."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import duckdb

from app.services.workspace_migrations.migration_001_baseline import upgrade as upgrade_001

UpgradeFn = Callable[[duckdb.DuckDBPyConnection], None]


@dataclass(frozen=True)
class Migration:
    version: int
    description: str
    upgrade: UpgradeFn


MIGRATIONS: tuple[Migration, ...] = (
    Migration(1, "baseline workspace tables and indexes", upgrade_001),
)
