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

def test_agent_ask_http_endpoint(client, tmp_path, monkeypatch) -> None:
    def fake_run(r, s, b):  # noqa: ANN001
        return AgentAskResponse(model="m", answer="ok")

    monkeypatch.setattr("app.api.agent.run_agent_ask", fake_run)
    r = client.post("/api/agent/ask", json={"question": "hello"})
    assert r.status_code == 200
    assert r.json()["answer"] == "ok"

