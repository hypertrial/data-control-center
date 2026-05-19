"""Agent tests."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.models.api import AgentAskRequest, AgentAskResponse
from app.services.agent import (
    OLLAMA_SQL_DRAFT_FORMAT,
    OLLAMA_SUMMARY_FORMAT,
    _empty_result_retry_prompt,
    _ollama_error_body,
    _pragma_column_summaries,
    _result_preview_for_summary,
    _should_retry_empty_result,
    _sql_retry_prompt,
    _system_prompt,
    build_dataset_context,
    ollama_chat,
    ollama_chat_stream,
    parse_sql_draft,
    parse_summary_answer,
    run_agent_ask,
    run_agent_ask_stream,
)
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace

def test_system_prompt_discourages_any_value_without_group_for_frequency() -> None:
    p = _system_prompt()
    assert "Most common" in p
    assert "GROUP BY the dimension column" in p
    assert "ANY_VALUE alone" in p


def test_build_dataset_context_no_datasets(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "empty.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws, settings)
    ctx, err = build_dataset_context(reg, ws, None)
    assert ctx is None
    assert err and "No datasets are registered" in err


def test_build_dataset_context_filter_miss(registry_csv: DatasetRegistry) -> None:
    ws = registry_csv.workspace
    ctx, err = build_dataset_context(registry_csv, ws, ["ds_999"])
    assert ctx is None
    assert "dataset_ids filter" in (err or "")


def test_build_dataset_context_uses_profile_cache(registry_csv: DatasetRegistry) -> None:
    ds = registry_csv.list_all()[0]
    prof = {
        "column_profiles": [
            {"name": "id", "physical_type": "INT32"},
            {"name": "val", "physical_type": "FLOAT64"},
        ],
        "narrative": "Test narrative\nline2",
    }
    registry_csv.workspace.save_profile_cache(ds.dataset_id, prof)
    ctx, err = build_dataset_context(registry_csv, registry_csv.workspace, None)
    assert err is None
    assert ctx
    assert "id:INT32" in ctx
    assert "Test narrative" in ctx


def test_pragma_column_summaries_truncates(registry_csv: DatasetRegistry) -> None:
    cols = [f"c{i}" for i in range(85)]
    header = ",".join(cols)
    row = ",".join(["1"] * 85)
    p = registry_csv.list_all()[0].source_path.parent / "wide85.csv"
    p.write_text(f"{header}\n{row}\n")
    registry_csv.register_path(p)
    ds = registry_csv.list_all()[-1]
    out = _pragma_column_summaries(registry_csv.workspace.connection, ds.view_name, max_cols=80)
    assert any("more columns" in x for x in out)


def test_build_dataset_context_profile_column_overflow(registry_csv: DatasetRegistry) -> None:
    ds = registry_csv.list_all()[0]
    prof = {
        "column_profiles": [{"name": f"c{i}", "physical_type": "INT32"} for i in range(85)],
    }
    registry_csv.workspace.save_profile_cache(ds.dataset_id, prof)
    ctx, err = build_dataset_context(registry_csv, registry_csv.workspace, None)
    assert err is None
    assert ctx and "more columns" in ctx


def test_build_dataset_context_no_columns_resolved(
    registry_csv: DatasetRegistry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.agent.context._pragma_column_summaries",
        lambda *a, **k: [],
    )
    registry_csv.workspace.delete_profile_cache(registry_csv.list_all()[0].dataset_id)
    ctx, err = build_dataset_context(registry_csv, registry_csv.workspace, None)
    assert err is None
    assert ctx and "(no columns resolved)" in ctx

