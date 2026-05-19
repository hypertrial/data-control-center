"""Example migration template for future schema bumps.

Copy this file to migration_00N_<name>.py, implement upgrade(), and register it in registry.py.
"""

from __future__ import annotations

import duckdb


def upgrade(con: duckdb.DuckDBPyConnection) -> None:  # pragma: no cover
    """Apply additive DDL only; keep forward-only migrations."""
    raise NotImplementedError("Example migration is not registered")
