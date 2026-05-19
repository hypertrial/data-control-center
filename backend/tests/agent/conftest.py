"""Shared fixtures for agent tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@pytest.fixture()
def registry_csv(tmp_path: Path) -> DatasetRegistry:
    csv = tmp_path / "rows.csv"
    csv.write_text("id,val\n1,10\n2,20\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    reg.register_path(csv)
    return reg

