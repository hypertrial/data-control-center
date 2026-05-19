"""Ask workflow persistence and SSE helper emitters."""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

from app.models.api import AgentAskRequest, QueryResult
from app.services.registry import DatasetRegistry


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
    tid, seq = registry.workspace.ask.append_turn(
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
