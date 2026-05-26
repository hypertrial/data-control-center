"""execute_query guardrails and result shaping."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.models.api import QueryRequest
from app.services.query import _apply_statement_timeout, execute_query
from app.services.query_errors import MSG_BINDER_GROUPING, MSG_CATALOG, MSG_CONVERSION
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@pytest.fixture()
def registry_with_view(tmp_path: Path) -> DatasetRegistry:
    csv = tmp_path / "d.csv"
    csv.write_text("id\n1\n2\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
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


def test_execute_success_with_cte(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    sql = f"WITH q AS (SELECT * FROM {vw}) SELECT * FROM q"
    out = execute_query(registry_with_view, Settings(), QueryRequest(sql=sql))
    assert not out.error
    assert len(out.rows) >= 1


def test_execute_success_with_nested_select(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    sql = f"SELECT * FROM (SELECT id FROM {vw}) nested WHERE id > 0"
    out = execute_query(registry_with_view, Settings(), QueryRequest(sql=sql))
    assert not out.error
    assert out.row_count == 2


def test_execute_rejects_nested_unknown_relation(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT * FROM {vw} WHERE id IN (SELECT id FROM missing)"),
    )
    assert out.error
    assert "non-registered relations" in out.error


def test_execute_rejects_nested_file_read_function(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT * FROM {vw} WHERE id IN (SELECT id FROM read_csv_auto('x.csv'))"),
    )
    assert out.error
    assert "forbidden file-reading" in out.error


def test_execute_rejects_duckdb_dynamic_and_metadata_functions(
    registry_with_view: DatasetRegistry,
) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    for sql in [
        f"SELECT * FROM {vw}, query('SELECT * FROM read_csv_auto(''secret.csv'')')",
        f"SELECT * FROM {vw}, query_table('dcc_datasets')",
        f"SELECT current_setting('temp_directory') FROM {vw}",
        f"SELECT * FROM {vw}, duckdb_settings()",
    ]:
        out = execute_query(registry_with_view, Settings(), QueryRequest(sql=sql))
        assert out.error
        assert "forbidden DuckDB system" in out.error


def test_execute_insert_forbidden(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"INSERT INTO {vw} SELECT 1"),
    )
    assert out.error
    assert "forbidden" in (out.error or "").lower()


def test_execute_multi_statement_rejected(registry_with_view: DatasetRegistry) -> None:
    vw = next(iter(registry_with_view.list_all())).view_name
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT 1 FROM {vw}; SELECT 2 FROM {vw}"),
    )
    assert out.error
    assert "single" in (out.error or "").lower()


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


def test_execute_preserves_aggregate_date_range_rows(tmp_path: Path) -> None:
    csv = tmp_path / "daily.csv"
    csv.write_text("day_utc\n2009-01-03\n2026-03-13\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    ds = reg.register_path(csv)

    out = execute_query(
        reg,
        settings,
        QueryRequest(sql=f"SELECT MIN(day_utc), MAX(day_utc) FROM {ds.view_name}"),
    )

    assert not out.error
    assert out.row_count == 1
    assert out.model_dump(mode="json")["rows"] == [
        {"min(day_utc)": "2009-01-03", "max(day_utc)": "2026-03-13"}
    ]


def test_execute_preserves_empty_aggregate_null_row(tmp_path: Path) -> None:
    csv = tmp_path / "daily.csv"
    csv.write_text("day_utc\n2009-01-03\n2026-03-13\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    ds = reg.register_path(csv)

    out = execute_query(
        reg,
        settings,
        QueryRequest(
            sql=f"SELECT MIN(day_utc), MAX(day_utc) FROM {ds.view_name} WHERE day_utc > DATE '2100-01-01'"
        ),
    )

    assert not out.error
    assert out.row_count == 1
    assert out.rows == [{"min(day_utc)": None, "max(day_utc)": None}]


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


def test_apply_statement_timeout_reraises_unknown_errors() -> None:
    class Con:
        def execute(self, _sql: str) -> None:
            raise RuntimeError("different failure")

    with pytest.raises(RuntimeError, match="different failure"):
        _apply_statement_timeout(Con(), 1.0)


def test_execute_query_timeout_error_message(
    registry_with_view: DatasetRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Con:
        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

        def execute(self, _sql: str):
            raise RuntimeError("statement timeout")

    monkeypatch.setattr(registry_with_view.workspace, "read_db", lambda: Con())
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT * FROM {registry_with_view.list_all()[0].view_name}"),
    )
    assert out.error == "Query timed out."


def test_execute_query_missing_source_error_is_sanitized(
    registry_with_view: DatasetRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Con:
        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

        def execute(self, sql: str):
            if sql.startswith("SET statement_timeout"):
                return None
            raise RuntimeError('IO Error: No files found that match the pattern "/private/data/missing.parquet"')

    monkeypatch.setattr(registry_with_view.workspace, "read_db", lambda: Con())
    out = execute_query(
        registry_with_view,
        Settings(),
        QueryRequest(sql=f"SELECT * FROM {registry_with_view.list_all()[0].view_name}"),
    )
    assert out.error == "Dataset source file is unavailable. Re-upload or unregister the dataset."
    assert "/private" not in (out.error or "")


def _patch_read_db_raises(registry: DatasetRegistry, monkeypatch: pytest.MonkeyPatch, message: str) -> None:
    class Con:
        def __enter__(self):  # noqa: ANN204
            return self

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

        def execute(self, sql: str):
            if sql.startswith("SET statement_timeout"):
                return None
            raise RuntimeError(message)

    monkeypatch.setattr(registry.workspace, "read_db", lambda: Con())


def test_execute_query_binder_error_message(
    registry_with_view: DatasetRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_read_db_raises(
        registry_with_view,
        monkeypatch,
        'Binder Error: column "x" must appear in the GROUP BY clause or must be part of an aggregate function.',
    )
    vw = registry_with_view.list_all()[0].view_name
    out = execute_query(registry_with_view, Settings(), QueryRequest(sql=f"SELECT * FROM {vw}"))
    assert out.error == MSG_BINDER_GROUPING
    assert "/Volumes" not in (out.error or "")


def test_execute_query_conversion_error_message(
    registry_with_view: DatasetRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_read_db_raises(registry_with_view, monkeypatch, "Conversion Error: Could not convert string to INT")
    vw = registry_with_view.list_all()[0].view_name
    out = execute_query(registry_with_view, Settings(), QueryRequest(sql=f"SELECT * FROM {vw}"))
    assert out.error == MSG_CONVERSION


def test_execute_query_catalog_error_message(
    registry_with_view: DatasetRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    _patch_read_db_raises(registry_with_view, monkeypatch, "Catalog Error: Table with name missing does not exist")
    vw = registry_with_view.list_all()[0].view_name
    out = execute_query(registry_with_view, Settings(), QueryRequest(sql=f"SELECT * FROM {vw}"))
    assert out.error == MSG_CATALOG
