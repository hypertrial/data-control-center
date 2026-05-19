"""Local LLM (Ollama) agent: natural-language questions to validated DuckDB SQL."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from app.config import Settings
from app.models.api import AgentAskRequest, AgentAskResponse, QueryResult
from app.services.agent.context import build_dataset_context
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
from app.services.agent.context import _pragma_column_summaries
from app.services.agent.workflow import _run_ask_workflow
from app.services.registry import DatasetRegistry

def run_agent_ask(
    registry: DatasetRegistry,
    settings: Settings,
    req: AgentAskRequest,
    ollama_call=ollama_chat,
) -> AgentAskResponse:
    payload: dict[str, Any] = {"model": settings.llm_model}
    for ev in _run_ask_workflow(
        registry,
        settings,
        req,
        emit_summary_tokens=False,
        ollama_call=ollama_call,
        ollama_stream=ollama_chat_stream,
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
            if "query_result" in data and data.get("query_result") is not None:
                payload["query_result"] = QueryResult.model_validate(data["query_result"])
    return AgentAskResponse(**payload)


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
