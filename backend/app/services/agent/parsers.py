"""Parse and validate agent model outputs."""

from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from app.models.api import AgentSqlDraft, QueryResult

def _load_json_object(content: str) -> Any:
    """Load a JSON object, tolerating model-added thinking text around it."""
    stripped = content.strip()
    if not stripped:
        raise json.JSONDecodeError("empty response", content, 0)
    decoder = json.JSONDecoder()
    try:
        return decoder.raw_decode(stripped)[0]
    except json.JSONDecodeError:
        start = stripped.find("{")
        if start < 0:
            raise
        return decoder.raw_decode(stripped[start:])[0]


def parse_sql_draft(content: str) -> tuple[AgentSqlDraft | None, str | None]:
    try:
        obj = _load_json_object(content)
    except json.JSONDecodeError as e:
        return None, f"Model returned invalid JSON: {e}"
    if not isinstance(obj, dict):
        return None, "Model JSON must be an object with sql and optional explanation."
    try:
        return AgentSqlDraft.model_validate(obj), None
    except ValidationError as e:
        return None, f"Invalid SQL draft payload: {e}"


def parse_summary_answer(content: str) -> tuple[str | None, str | None]:
    try:
        obj = _load_json_object(content)
    except json.JSONDecodeError as e:
        return None, f"Invalid summary JSON: {e}"
    if not isinstance(obj, dict):
        return None, "Summary JSON must be an object."
    ans = obj.get("answer")
    if isinstance(ans, str) and ans.strip():
        return ans.strip(), None
    return None, "Summary missing answer field."


def _result_preview_for_summary(result_json: dict[str, Any], max_chars: int) -> str:
    raw = json.dumps(result_json, default=str)
    if len(raw) <= max_chars:
        return raw
    return raw[: max_chars - 20] + "\n... (truncated)"


def _default_answer(draft: AgentSqlDraft, qres: QueryResult) -> str:
    prefix = draft.explanation.strip() or "Query completed."
    parts = [f"Returned {qres.row_count} row{'s' if qres.row_count != 1 else ''}."]
    if qres.rows:
        first = qres.rows[0]
        preview = ", ".join(f"{k}={v}" for k, v in list(first.items())[:3])
        if preview:
            parts.append(f"Preview: {preview}.")
    return f"{prefix}\n\n{' '.join(parts)}"
