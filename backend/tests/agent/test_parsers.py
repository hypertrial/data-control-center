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

def test_parse_sql_draft_ok() -> None:
    d, err = parse_sql_draft('{"sql":"SELECT 1","explanation":"x"}')
    assert err is None
    assert d and d.sql == "SELECT 1"


def test_parse_sql_draft_extracts_wrapped_json() -> None:
    d, err = parse_sql_draft(
        '<think>skip this</think>\n{"sql":"SELECT 1","explanation":"x"}'
    )
    assert err is None
    assert d and d.sql == "SELECT 1"


def test_parse_sql_draft_bad_json() -> None:
    d, err = parse_sql_draft("not-json")
    assert d is None
    assert err and "json" in err.lower()


def test_parse_sql_draft_empty_response() -> None:
    d, err = parse_sql_draft("")
    assert d is None
    assert err and "empty response" in err


def test_parse_sql_draft_not_object() -> None:
    d, err = parse_sql_draft('"string"')
    assert d is None
    assert err and "object" in err.lower()


def test_parse_sql_draft_validation_error() -> None:
    d, err = parse_sql_draft('{"sql":1}')
    assert d is None
    assert err and "Invalid SQL draft" in err


def test_parse_summary_answer_ok() -> None:
    a, err = parse_summary_answer('{"answer":"hello"}')
    assert err is None
    assert a == "hello"


def test_parse_summary_answer_extracts_wrapped_json() -> None:
    a, err = parse_summary_answer('text before {"answer":"hello"}')
    assert err is None
    assert a == "hello"


def test_parse_summary_answer_bad() -> None:
    a, err = parse_summary_answer("{}")
    assert a is None
    assert err


def test_parse_summary_answer_not_object() -> None:
    a, err = parse_summary_answer("[1]")
    assert a is None
    assert err and "object" in err.lower()


def test_result_preview_for_summary_truncates() -> None:
    big = {"x": "y" * 5000}
    s = _result_preview_for_summary(big, max_chars=50)
    assert "truncated" in s
    assert len(s) <= 50


def test_sql_retry_prompt_explains_group_by_aggregate_error() -> None:
    prompt = _sql_retry_prompt("Binder Error: GROUP BY clause cannot contain aggregates!")
    assert "aggregate functions in GROUP BY" in prompt
    assert "raw dimension columns" in prompt


def test_empty_result_retry_helpers() -> None:
    assert _should_retry_empty_result("SELECT * FROM t WHERE x IS NOT NULL")
    assert _should_retry_empty_result("SELECT x FROM t HAVING COUNT(*) > 1")
    assert not _should_retry_empty_result("SELECT * FROM t")
    assert "remove them" in _empty_result_retry_prompt()

