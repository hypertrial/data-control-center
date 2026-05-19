"""Local LLM (Ollama) agent: natural-language questions to validated DuckDB SQL."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from app.config import Settings
from app.models.api import AgentAskRequest
from app.services.agent.context import (
    _pragma_column_summaries,
    build_dataset_context,
)
from app.services.agent.ollama_client import (
    _ollama_error_body,
    ollama_chat,
    ollama_chat_stream,
)
from app.services.agent.parsers import (
    _default_answer,
    _load_json_object,
    _result_preview_for_summary,
    parse_sql_draft,
    parse_summary_answer,
)
from app.services.agent.prompts import (
    OLLAMA_SQL_DRAFT_FORMAT,
    OLLAMA_SUMMARY_FORMAT,
    _build_user_block,
    _empty_result_retry_prompt,
    _should_retry_empty_result,
    _sql_retry_prompt,
    _system_prompt,
)
from app.services.agent.workflow_run import _run_ask_workflow
from app.services.registry import DatasetRegistry

__all__ = [
    "OLLAMA_SQL_DRAFT_FORMAT",
    "OLLAMA_SUMMARY_FORMAT",
    "_build_user_block",
    "_default_answer",
    "_empty_result_retry_prompt",
    "_load_json_object",
    "_ollama_error_body",
    "_pragma_column_summaries",
    "_result_preview_for_summary",
    "_run_ask_workflow",
    "_should_retry_empty_result",
    "_sql_retry_prompt",
    "_system_prompt",
    "build_dataset_context",
    "ollama_chat",
    "ollama_chat_stream",
    "parse_sql_draft",
    "parse_summary_answer",
    "run_agent_ask_stream",
]


def run_agent_ask_stream(
    registry: DatasetRegistry,
    settings: Settings,
    req: AgentAskRequest,
    ollama_call=ollama_chat,
    ollama_stream=ollama_chat_stream,
) -> Iterator[dict[str, Any]]:
    """Yield SSE events including meta, stage, sql_attempt, sql, query_result, token, answer, turn, timing, done."""
    yield from _run_ask_workflow(
        registry,
        settings,
        req,
        emit_summary_tokens=True,
        ollama_call=ollama_call,
        ollama_stream=ollama_stream,
    )
