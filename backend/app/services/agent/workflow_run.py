"""Ask workflow orchestration and SSE event helpers."""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import Settings
from app.models.api import AgentAskRequest, QueryRequest
from app.services.agent.context import build_dataset_context
from app.services.agent.workflow_persistence import _emit_done, _finish_error, _finish_success
from app.services.agent.ollama_client import ollama_chat, ollama_chat_stream
from app.services.agent.parsers import (
    _default_answer,
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
    _summary_messages,
    _system_prompt,
)
from app.services.query import execute_query
from app.services.llm_models import effective_llm_model
from app.services.registry import DatasetRegistry

logger = logging.getLogger(__name__)


@dataclass
class AskPreflight:
    messages: list[dict[str, str]]
    limit: int


@dataclass
class DraftSqlResult:
    content: str
    draft: Any | None
    error: str | None


def _prepare_ask_preflight(
    registry: DatasetRegistry,
    settings: Settings,
    req: AgentAskRequest,
) -> tuple[AskPreflight | None, str | None]:
    ctx, ctx_err = build_dataset_context(
        registry,
        registry.workspace,
        req.dataset_ids,
        settings.agent_context_max_columns,
    )
    if ctx_err:
        return None, ctx_err
    cap = min(settings.agent_max_rows, settings.query_max_rows)
    limit = min(req.max_rows or cap, cap)
    user_block = _build_user_block(registry, req, ctx)
    return AskPreflight(
        messages=[
            {"role": "system", "content": _system_prompt()},
            {"role": "user", "content": user_block},
        ],
        limit=limit,
    ), None


def _draft_sql_once(llm_settings: Settings, messages: list[dict[str, str]], ollama_call) -> DraftSqlResult:  # type: ignore[no-untyped-def]
    content = ollama_call(llm_settings, messages, OLLAMA_SQL_DRAFT_FORMAT)
    draft, parse_err = parse_sql_draft(content)
    return DraftSqlResult(content=content, draft=draft, error=parse_err if parse_err or draft is None else None)


def _append_parse_retry(messages: list[dict[str, str]], content: str, error: str) -> None:
    messages.append({"role": "assistant", "content": content})
    messages.append(
        {
            "role": "user",
            "content": (
                f"Your previous reply was invalid: {error}. "
                'Reply with only JSON: {{"sql":"...","explanation":"..."}}.'
            ),
        },
    )


def _query_retry_reason(qres, sql: str, attempt: int, max_attempts: int) -> str | None:  # type: ignore[no-untyped-def]
    if qres.error:
        return qres.error or "Unknown SQL error"
    if qres.row_count == 0 and attempt + 1 < max_attempts and _should_retry_empty_result(sql):
        return "Query returned 0 rows (retrying with adjusted SQL)"
    return None


def _summary_answer_events(
    *,
    req: AgentAskRequest,
    settings: Settings,
    llm_settings: Settings,
    draft,
    qres,
    emit_summary_tokens: bool,
    ollama_call,
    ollama_stream,
) -> Iterator[dict[str, Any]]:  # type: ignore[no-untyped-def]
    fallback_answer = _default_answer(draft, qres)
    summary_messages = _summary_messages(
        req,
        _result_preview_for_summary(
            qres.model_dump(mode="json"),
            settings.agent_summarize_max_json_chars,
        ),
    )
    try:
        if emit_summary_tokens:
            acc = ""
            for chunk in ollama_stream(llm_settings, summary_messages, OLLAMA_SUMMARY_FORMAT):
                acc += chunk
                yield {"type": "token", "data": {"text": chunk}}
            summary_content = acc
        else:
            summary_content = ollama_call(llm_settings, summary_messages, OLLAMA_SUMMARY_FORMAT)
        parsed_ans, serr = parse_summary_answer(summary_content)
        if serr:
            logger.warning("Ollama summary parse failed: %s", serr)
        answer = parsed_ans or fallback_answer
    except (httpx.HTTPError, OSError) as e:
        logger.warning("Ollama summary failed; using fallback answer: %s", e)
        answer = fallback_answer
    yield {"type": "summary_answer", "data": {"answer": answer}}


def _run_ask_workflow(
    registry: DatasetRegistry,
    settings: Settings,
    req: AgentAskRequest,
    *,
    emit_summary_tokens: bool,
    ollama_call=ollama_chat,
    ollama_stream=ollama_chat_stream,
) -> Iterator[dict[str, Any]]:
    model_name = effective_llm_model(settings, req.model)
    llm_settings = settings.model_copy(update={"llm_model": model_name})
    t0 = time.monotonic()
    attempts: list[dict[str, Any]] = []

    def elapsed_ms() -> int:
        return int((time.monotonic() - t0) * 1000)

    yield {"type": "meta", "data": {"model": model_name}}

    if req.conversation_id:
        if not registry.workspace.ask.get_conversation(req.conversation_id):
            yield {"type": "error", "data": {"message": "Conversation not found"}}
            yield from _emit_done(elapsed_ms())
            return

    yield {"type": "stage", "data": {"name": "context", "elapsed_ms": elapsed_ms()}}

    preflight, preflight_err = _prepare_ask_preflight(registry, settings, req)
    if preflight_err or preflight is None:
        yield {"type": "error", "data": {"message": preflight_err or "Unable to build Ask context"}}
        yield from _emit_done(elapsed_ms())
        return

    messages = preflight.messages
    limit = preflight.limit
    last_content_err: str | None = None
    max_attempts = max(1, settings.agent_sql_attempts)

    for attempt in range(max_attempts):
        yield {
            "type": "stage",
            "data": {"name": "draft_sql", "attempt": attempt + 1, "elapsed_ms": elapsed_ms()},
        }
        try:
            draft_result = _draft_sql_once(llm_settings, messages, ollama_call)
        except httpx.ConnectError as e:
            logger.warning("Ollama connection failed: %s", e)
            msg = (
                f"Ollama is not reachable at {settings.llm_base_url}. "
                f"Start Ollama and run `ollama pull {model_name}` "
                "if the model is not installed."
            )
            yield from _finish_error(
                registry,
                req,
                t0,
                message=msg,
                attempts=attempts,
                model_name=model_name,
                elapsed_ms=elapsed_ms(),
            )
            return
        except httpx.HTTPError as e:
            logger.warning("Ollama HTTP error: %s", e)
            msg = f"Ollama at {settings.llm_base_url} failed: {e}"
            yield from _finish_error(
                registry,
                req,
                t0,
                message=msg,
                attempts=attempts,
                model_name=model_name,
                elapsed_ms=elapsed_ms(),
            )
            return
        except Exception as e:  # noqa: BLE001
            logger.exception("Ollama request failed")
            msg = f"Ollama request failed: {e}"
            yield from _finish_error(
                registry,
                req,
                t0,
                message=msg,
                attempts=attempts,
                model_name=model_name,
                elapsed_ms=elapsed_ms(),
            )
            return

        if draft_result.error or draft_result.draft is None:
            last_content_err = draft_result.error or "Unknown parse error"
            attempts.append({"stage": "draft_sql", "error": last_content_err, "sql": None})
            if attempt + 1 >= max_attempts:
                yield from _finish_error(
                    registry,
                    req,
                    t0,
                    message=last_content_err,
                    attempts=attempts,
                    model_name=model_name,
                    elapsed_ms=elapsed_ms(),
                )
                return
            _append_parse_retry(messages, draft_result.content, last_content_err)
            continue

        draft = draft_result.draft
        yield {"type": "stage", "data": {"name": "execute", "elapsed_ms": elapsed_ms()}}
        qres = execute_query(
            registry,
            settings,
            QueryRequest(sql=draft.sql, max_rows=limit),
        )
        retry_reason = _query_retry_reason(qres, draft.sql, attempt, max_attempts)
        if not qres.error:
            if retry_reason:
                attempts.append(
                    {
                        "sql": draft.sql,
                        "error": retry_reason,
                        "stage": "execute",
                    }
                )
                yield {
                    "type": "sql_attempt",
                    "data": {
                        "sql": draft.sql,
                        "error": retry_reason,
                        "attempt": attempt + 1,
                    },
                }
                yield {
                    "type": "stage",
                    "data": {"name": "retry", "attempt": attempt + 1, "elapsed_ms": elapsed_ms()},
                }
                messages.append({"role": "assistant", "content": draft_result.content})
                messages.append({"role": "user", "content": _empty_result_retry_prompt()})
                continue

            yield {
                "type": "sql",
                "data": {"sql": draft.sql, "explanation": draft.explanation or None},
            }
            yield {"type": "query_result", "data": qres.model_dump(mode="json")}

            if not settings.agent_summarize_with_llm:
                ans = _default_answer(draft, qres)
                yield from _finish_success(
                    registry,
                    req,
                    t0,
                    sql=draft.sql,
                    explanation=draft.explanation or None,
                    answer=ans,
                    attempts=attempts,
                    query_result=qres,
                    model_name=model_name,
                    elapsed_ms=elapsed_ms(),
                )
                return

            yield {
                "type": "stage",
                "data": {"name": "summarize", "elapsed_ms": elapsed_ms()},
            }
            answer = _default_answer(draft, qres)
            for ev in _summary_answer_events(
                req=req,
                settings=settings,
                llm_settings=llm_settings,
                draft=draft,
                qres=qres,
                emit_summary_tokens=emit_summary_tokens,
                ollama_call=ollama_call,
                ollama_stream=ollama_stream,
            ):
                if ev["type"] == "summary_answer":
                    answer = str(ev["data"]["answer"])
                else:
                    yield ev
            yield from _finish_success(
                registry,
                req,
                t0,
                sql=draft.sql,
                explanation=draft.explanation or None,
                answer=answer,
                attempts=attempts,
                query_result=qres,
                model_name=model_name,
                elapsed_ms=elapsed_ms(),
            )
            return

        err_text = retry_reason or qres.error or "Unknown SQL error"
        attempts.append({"sql": draft.sql, "error": err_text, "stage": "execute"})
        yield {
            "type": "sql_attempt",
            "data": {"sql": draft.sql, "error": err_text, "attempt": attempt + 1},
        }
        if attempt + 1 >= max_attempts:
            yield from _finish_error(
                registry,
                req,
                t0,
                message=err_text,
                sql=draft.sql,
                explanation=draft.explanation or None,
                attempts=attempts,
                query_result=qres,
                model_name=model_name,
                elapsed_ms=elapsed_ms(),
                event_data={
                    "message": err_text,
                    "sql": draft.sql,
                    "explanation": draft.explanation or None,
                    "query_result": qres.model_dump(mode="json"),
                },
            )
            return

        yield {
            "type": "stage",
            "data": {"name": "retry", "attempt": attempt + 1, "elapsed_ms": elapsed_ms()},
        }
        messages.append({"role": "assistant", "content": draft_result.content})
        messages.append(
            {
                "role": "user",
                "content": _sql_retry_prompt(err_text),
            }
        )

    raise AssertionError("ask workflow: expected all paths to return")  # pragma: no cover
