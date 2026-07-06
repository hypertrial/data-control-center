"""Execute shared chart SQL fixtures against DuckDB."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.models.api import QueryRequest
from app.services.query import execute_query
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace

FIXTURE_CSV = Path(__file__).resolve().parent / "fixtures" / "chart_orders.csv"
FIXTURE_CASES = Path(__file__).resolve().parent / "fixtures" / "chart_sql_cases.json"
VIEW_NAME = "chart_orders"


@pytest.fixture()
def chart_registry(tmp_path: Path) -> DatasetRegistry:
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    reg.register_path(FIXTURE_CSV)
    ds = reg.list_all()[0]
    assert ds.view_name == VIEW_NAME
    return reg


def _chart_sql_cases() -> list[dict[str, Any]]:
    return json.loads(FIXTURE_CASES.read_text(encoding="utf-8"))


@pytest.mark.parametrize(
    "case",
    _chart_sql_cases(),
    ids=lambda case: case["case_id"],
)
def test_chart_sql_executes_in_duckdb(
    chart_registry: DatasetRegistry,
    case: dict[str, Any],
) -> None:
    assert case["view_name"] == VIEW_NAME
    out = execute_query(chart_registry, Settings(), QueryRequest(sql=case["sql"]))
    assert out.error is None, out.error
    assert out.row_count >= case["min_rows"]
