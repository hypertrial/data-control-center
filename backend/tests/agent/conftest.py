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


def collect_ask_result(registry, settings, req, ollama_call=None, ollama_stream=None):  # noqa: ANN001
    """Fold streaming workflow events into AgentAskResponse for tests."""
    from typing import Any

    from app.models.api import AgentAskResponse, QueryResult
    from app.services.agent.ollama_client import ollama_chat, ollama_chat_stream
    from app.services.agent.workflow_run import _run_ask_workflow

    payload: dict[str, Any] = {"model": settings.llm_model}
    for ev in _run_ask_workflow(
        registry,
        settings,
        req,
        emit_summary_tokens=False,
        ollama_call=ollama_call or ollama_chat,
        ollama_stream=ollama_stream or ollama_chat_stream,
    ):
        typ = ev["type"]
        data = ev["data"]
        if typ == "sql":
            payload["sql"] = data.get("sql")
            payload["explanation"] = data.get("explanation")
        elif typ == "query_result":
            payload["query_result"] = QueryResult.model_validate(data)
        elif typ == "answer":
            payload["answer"] = data.get("answer")
        elif typ == "error":
            payload["error"] = data.get("message")
            if "sql" in data:
                payload["sql"] = data.get("sql")
            if "explanation" in data:
                payload["explanation"] = data.get("explanation")
            if data.get("query_result") is not None:
                payload["query_result"] = QueryResult.model_validate(data["query_result"])
    return AgentAskResponse(**payload)

