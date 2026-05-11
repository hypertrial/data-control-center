"""execute_query guardrails and result shaping."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.models.api import QueryRequest
from app.services.query import execute_query
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@pytest.fixture()
def registry_with_view(tmp_path: Path) -> DatasetRegistry:
    csv = tmp_path / "d.csv"
    csv.write_text("id\n1\n2\n")
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    reg.register_path(csv)
    return reg


def test_execute_forbidden_keyword(registry_with_view: DatasetRegistry) -> None:
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql="ATTACH 'x' AS other"),
    )
    assert out.error
    assert "forbidden" in (out.error or "").lower()


def test_execute_requires_view_when_datasets_exist(registry_with_view: DatasetRegistry) -> None:
    assert execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql="SELECT 1"),
    ).error


def test_execute_success_and_truncation(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    out = execute_query(
        registry_with_view,
        Settings(query_max_rows=2),
        QueryRequest(sql=f"SELECT * FROM {vw}", max_rows=1),
    )
    assert not out.error
    assert out.truncated
    assert len(out.rows) == 1


def test_execute_duckdb_error(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    assert execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT nope FROM {vw}"),
    ).error


def test_view_token_must_be_whole_word(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT '{vw}x' AS c"),
    )
    assert out.error


def test_empty_registry_allows_select(registry_with_view: DatasetRegistry, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(registry_with_view, "list_all", lambda: [])
    out = execute_query(registry_with_view, Settings(), QueryRequest(sql="SELECT 1 AS x"))
    assert not out.error
    assert out.rows == [{"x": 1}]
