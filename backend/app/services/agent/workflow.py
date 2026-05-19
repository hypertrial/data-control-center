"""Ask workflow orchestration and SSE event helpers."""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

import httpx

from app.config import Settings
from app.models.api import AgentAskRequest, QueryRequest, QueryResult
from app.services import ask_store
from app.services.agent.context import build_dataset_context
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
    _system_prompt,
)
from app.services.query import execute_query
from app.services.registry import DatasetRegistry

logger = logging.getLogger(__name__)

def _persist_turn_optional(
    registry: DatasetRegistry,
    req: AgentAskRequest,
    t0: float,
    *,
    sql: str | None,
    explanation: str | None,
    answer: str | None,
    error: str | None,
    attempts: list[dict[str, Any]],
    query_result: QueryResult | None,
    model_name: str,
) -> tuple[str | None, int | None]:
    if not req.conversation_id:
        return None, None
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    with registry.workspace.lock_db() as con:
        tid, seq = ask_store.append_turn(
            con,
            req.conversation_id,
            req.question.strip(),
            sql,
            explanation,
            answer,
            error,
            attempts,
            query_result,
            model_name,
            elapsed_ms,
        )
    return tid, seq


def _emit_done(total_ms: int) -> Iterator[dict[str, Any]]:
    yield {"type": "timing", "data": {"total_ms": total_ms}}
    yield {"type": "done", "data": {}}


def _emit_turn_if_persisted(
    turn_id: str | None,
    seq: int | None,
    conversation_id: str | None,
) -> Iterator[dict[str, Any]]:
    if turn_id and seq is not None and conversation_id:
        yield {
            "type": "turn",
            "data": {
                "turn_id": turn_id,
                "conversation_id": conversation_id,
                "seq": seq,
            },
        }


def _finish_error(
    registry: DatasetRegistry,
    req: AgentAskRequest,
    t0: float,
    *,
    message: str,
    attempts: list[dict[str, Any]],
    model_name: str,
    elapsed_ms: int,
    sql: str | None = None,
    explanation: str | None = None,
    query_result: QueryResult | None = None,
    event_data: dict[str, Any] | None = None,
) -> Iterator[dict[str, Any]]:
    turn_id, seq = _persist_turn_optional(
        registry,
        req,
        t0,
        sql=sql,
        explanation=explanation,
        answer=None,
        error=message,
        attempts=attempts,
        query_result=query_result,
        model_name=model_name,
    )
    data = {"message": message}
    if event_data:
        data.update(event_data)
    yield {"type": "error", "data": data}
    yield from _emit_turn_if_persisted(turn_id, seq, req.conversation_id)
    yield from _emit_done(elapsed_ms)


def _finish_success(
    registry: DatasetRegistry,
    req: AgentAskRequest,
    t0: float,
    *,
    sql: str,
    explanation: str | None,
    answer: str,
    attempts: list[dict[str, Any]],
    query_result: QueryResult,
    model_name: str,
    elapsed_ms: int,
) -> Iterator[dict[str, Any]]:
    yield {"type": "answer", "data": {"answer": answer}}
    turn_id, seq = _persist_turn_optional(
        registry,
        req,
        t0,
        sql=sql,
        explanation=explanation,
        answer=answer,
        error=None,
        attempts=attempts,
        query_result=query_result,
        model_name=model_name,
    )
    yield from _emit_turn_if_persisted(turn_id, seq, req.conversation_id)
    yield from _emit_done(elapsed_ms)


def _run_ask_workflow(
    registry: DatasetRegistry,
    settings: Settings,
    req: AgentAskRequest,
    *,
    emit_summary_tokens: bool,
    ollama_call=ollama_chat,
    ollama_stream=ollama_chat_stream,
) -> Iterator[dict[str, Any]]:
    model_name = settings.llm_model
    t0 = time.monotonic()
    attempts: list[dict[str, Any]] = []

    def elapsed_ms() -> int:
        return int((time.monotonic() - t0) * 1000)

    yield {"type": "meta", "data": {"model": model_name}}

    if req.conversation_id:
        with registry.workspace.lock_db() as con:
            if not ask_store.get_conversation(con, req.conversation_id):
                yield {"type": "error", "data": {"message": "Conversation not found"}}
                yield from _emit_done(elapsed_ms())
                return

    yield {"type": "stage", "data": {"name": "context", "elapsed_ms": elapsed_ms()}}

    ctx, ctx_err = build_dataset_context(
        registry,
        registry.workspace,
        req.dataset_ids,
        settings.agent_context_max_columns,
    )
    if ctx_err:
        yield {"type": "error", "data": {"message": ctx_err}}
        yield from _emit_done(elapsed_ms())
        return

    cap = min(settings.agent_max_rows, settings.query_max_rows)
    limit = min(req.max_rows or cap, cap)

    user_block = _build_user_block(registry, req, ctx)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": user_block},
    ]

    last_content_err: str | None = None

    for attempt in range(max(1, settings.agent_sql_attempts)):
        yield {
            "type": "stage",
            "data": {"name": "draft_sql", "attempt": attempt + 1, "elapsed_ms": elapsed_ms()},
        }
        try:
            content = ollama_call(settings, messages, OLLAMA_SQL_DRAFT_FORMAT)
        except httpx.ConnectError as e:
            logger.warning("Ollama connection failed: %s", e)
            msg = (
                f"Ollama is not reachable at {settings.llm_base_url}. "
                f"Start Ollama and run `ollama pull {settings.llm_model}` "
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

        draft, parse_err = parse_sql_draft(content)
        if parse_err or draft is None:
            last_content_err = parse_err or "Unknown parse error"
            attempts.append({"stage": "draft_sql", "error": last_content_err, "sql": None})
            if attempt + 1 >= settings.agent_sql_attempts:
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
            messages.append({"role": "assistant", "content": content})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Your previous reply was invalid: {last_content_err}. "
                        'Reply with only JSON: {{"sql":"...","explanation":"..."}}.'
                    ),
                },
            )
            continue

        yield {"type": "stage", "data": {"name": "execute", "elapsed_ms": elapsed_ms()}}
        qres = execute_query(
            registry,
            settings,
            QueryRequest(sql=draft.sql, max_rows=limit),
        )
        if not qres.error:
            if (
                qres.row_count == 0
                and attempt + 1 < settings.agent_sql_attempts
                and _should_retry_empty_result(draft.sql)
            ):
                attempts.append(
                    {
                        "sql": draft.sql,
                        "error": "Query returned 0 rows (retrying with adjusted SQL)",
                        "stage": "execute",
                    }
                )
                yield {
                    "type": "sql_attempt",
                    "data": {
                        "sql": draft.sql,
                        "error": "Query returned 0 rows (retrying with adjusted SQL)",
                        "attempt": attempt + 1,
                    },
                }
                yield {
                    "type": "stage",
                    "data": {"name": "retry", "attempt": attempt + 1, "elapsed_ms": elapsed_ms()},
                }
                messages.append({"role": "assistant", "content": content})
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
            summary_messages = [
                {
                    "role": "system",
                    "content": (
                        "Summarize the query result for the user in clear language. "
                        'Be concise. Return JSON {"answer": "..."} only.'
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Question: {req.question.strip()}\n"
                        f"SQL used: {draft.sql}\n"
                        f"Explanation from model: {draft.explanation}\n"
                        "Result preview (JSON):\n"
                        f"{_result_preview_for_summary(qres.model_dump(mode='json'), settings.agent_summarize_max_json_chars)}"
                    ),
                },
            ]
            try:
                if emit_summary_tokens:
                    acc = ""
                    for chunk in ollama_stream(settings, summary_messages, OLLAMA_SUMMARY_FORMAT):
                        acc += chunk
                        yield {"type": "token", "data": {"text": chunk}}
                    summary_content = acc
                else:
                    summary_content = ollama_call(settings, summary_messages, OLLAMA_SUMMARY_FORMAT)
                parsed_ans, serr = parse_summary_answer(summary_content)
                answer = parsed_ans or (
                    f"{draft.explanation}\n\n(Summarization issue: {serr})".strip()
                    if serr
                    else (draft.explanation or "Query completed.")
                )
            except (httpx.HTTPError, OSError) as e:
                answer = f"{draft.explanation}\n\n(Summarization unavailable: {e})".strip()
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

        err_text = qres.error or "Unknown SQL error"
        attempts.append({"sql": draft.sql, "error": err_text, "stage": "execute"})
        yield {
            "type": "sql_attempt",
            "data": {"sql": draft.sql, "error": err_text, "attempt": attempt + 1},
        }
        if attempt + 1 >= settings.agent_sql_attempts:
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
        messages.append({"role": "assistant", "content": content})
        messages.append(
            {
                "role": "user",
                "content": _sql_retry_prompt(err_text),
            }
        )

    raise AssertionError("ask workflow: expected all paths to return")  # pragma: no cover
