"""Local LLM (Ollama) agent: natural-language questions to validated DuckDB SQL."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.models.api import (
    AgentAskRequest,
    AgentAskResponse,
    AgentSqlDraft,
    QueryRequest,
    QueryResult,
)
from app.services.query import execute_query
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace, sanitize_sql_identifier

logger = logging.getLogger(__name__)


def _ollama_error_body(response: httpx.Response) -> str:
    """Ollama JSON error field, e.g. model not found (often returned as HTTP 404)."""
    try:
        payload = response.json()
        if isinstance(payload, dict):
            err = payload.get("error")
            if isinstance(err, str) and err.strip():
                return err.strip()
    except Exception:
        pass
    text = (response.text or "").strip()
    return text[:500] if text else ""


OLLAMA_SQL_DRAFT_FORMAT: dict[str, Any] = {
    "type": "object",
    "properties": {
        "sql": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": ["sql"],
}

OLLAMA_SUMMARY_FORMAT: dict[str, Any] = {
    "type": "object",
    "properties": {"answer": {"type": "string"}},
    "required": ["answer"],
}


def _system_prompt() -> str:
    return (
        "You are a data analyst assistant for a local Data Control Center. "
        "The database is DuckDB. Each registered dataset is exposed as a view. "
        "Do not think step-by-step. You must output only valid JSON when asked, "
        "with no markdown or extra text.\n\n"
        "Rules for SQL:\n"
        "- Exactly one SELECT or WITH statement (no semicolons chaining multiple statements).\n"
        "- Use DuckDB syntax.\n"
        "- The query MUST reference at least one of the provided view names as a whole identifier "
        "(e.g. SELECT * FROM my_view).\n"
        "- Read-only: never use ATTACH, INSTALL, COPY, CREATE, DROP, INSERT, UPDATE, DELETE, "
        "PRAGMA, or other mutating operations.\n"
        "- Do not invent filters. Only add WHERE/HAVING conditions that the user explicitly asked "
        "for or that directly remove nulls from the selected/grouped column itself.\n"
        "- Aggregate queries: GROUP BY only raw non-aggregated columns/expressions that also "
        "appear in SELECT. Never put aggregate functions such as COUNT, SUM, AVG, MIN, MAX, "
        "or ANY_VALUE in GROUP BY.\n"
        "- Prefer quoted identifiers for column names when they contain spaces or special characters "
        'using double quotes, e.g. "col name".\n'
    )


def _pragma_column_summaries(con: Any, view_name: str, max_cols: int = 80) -> list[str]:
    safe = sanitize_sql_identifier(view_name)
    rows = con.execute(
        f"SELECT name, type FROM pragma_table_info('{safe}') ORDER BY cid"
    ).fetchall()
    out: list[str] = []
    for name, typ in rows[:max_cols]:
        out.append(f"{name}:{typ}")
    if len(rows) > max_cols:
        out.append(f"... +{len(rows) - max_cols} more columns")
    return out


def build_dataset_context(
    registry: DatasetRegistry,
    workspace: Workspace,
    dataset_ids: list[str] | None,
    max_columns: int = 40,
) -> tuple[str | None, str | None]:
    """
    Return (context_block, error_message).

    error_message is set when no datasets match the filter.
    """
    lines: list[str] = []
    for ds in registry.list_all():
        if dataset_ids is not None and ds.dataset_id not in dataset_ids:
            continue
        prof_raw = workspace.load_profile_cache(ds.dataset_id)
        col_bits: list[str] = []
        if isinstance(prof_raw, dict):
            columns = prof_raw.get("column_profiles") or []
            for c in columns[:max_columns]:
                if isinstance(c, dict) and c.get("name"):
                    pt = c.get("physical_type", "?")
                    col_bits.append(f"{c['name']}:{pt}")
            if len(columns) > max_columns:
                col_bits.append(f"... +{len(columns) - max_columns} more columns")
        if not col_bits:
            col_bits = _pragma_column_summaries(
                workspace.connection,
                ds.view_name,
                max_cols=max_columns,
            )
        if not col_bits:
            col_bits = ["(no columns resolved)"]
        narrative = ""
        if isinstance(prof_raw, dict) and prof_raw.get("narrative"):
            narrative = str(prof_raw["narrative"]).replace("\n", " ").strip()[:400]
        line = (
            f"- dataset_id={ds.dataset_id} view={ds.view_name!r} file={ds.source_path.name!r} "
            f"rows={ds.row_count} cols={ds.column_count}\n"
            f"  columns: {', '.join(col_bits)}"
        )
        if narrative:
            line += f"\n  summary: {narrative}"
        lines.append(line)

    if not lines:
        if dataset_ids is not None:
            return None, "No datasets available for the given dataset_ids filter."
        return None, "No datasets are registered. Add or upload a dataset first."

    return "\n".join(lines), None


def ollama_chat(
    settings: Settings,
    messages: list[dict[str, str]],
    format_schema: dict[str, Any] | None = None,
) -> str:
    """POST /api/chat; return assistant message content."""
    url = f"{settings.llm_base_url.rstrip('/')}/api/chat"
    body: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "stream": False,
        "think": settings.llm_think,
        "options": {
            "temperature": settings.llm_temperature,
            "num_predict": (
                settings.llm_sql_num_predict
                if format_schema == OLLAMA_SQL_DRAFT_FORMAT
                else settings.llm_summary_num_predict
            ),
        },
    }
    if format_schema is not None:
        body["format"] = format_schema

    timeout = httpx.Timeout(settings.llm_timeout_seconds)
    with httpx.Client(timeout=timeout) as client:
        r = client.post(url, json=body)
        try:
            r.raise_for_status()
        except httpx.HTTPStatusError as e:
            detail = _ollama_error_body(e.response)
            if detail:
                hint = ""
                if e.response.status_code == 404 and "not found" in detail.lower():
                    hint = (
                        f" If the model name is wrong, run `ollama pull {settings.llm_model}` "
                        "or set DCC_LLM_MODEL to a model from `ollama list`."
                    )
                raise httpx.HTTPStatusError(
                    f"{e} — {detail}{hint}",
                    request=e.request,
                    response=e.response,
                ) from e
            raise
        data = r.json()
    msg = data.get("message") if isinstance(data, dict) else None
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content")
    return content if isinstance(content, str) else ""


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


def _sql_retry_prompt(err_text: str) -> str:
    hint = ""
    if "GROUP BY clause cannot contain aggregates" in err_text:
        hint = (
            " DuckDB does not allow aggregate functions in GROUP BY. Move aggregates "
            "to SELECT/HAVING/ORDER BY only, and GROUP BY the raw dimension columns."
        )
    return (
        f"The SQL failed when executed: {err_text}.{hint} "
        'Return corrected JSON with keys "sql" and "explanation" only.'
    )


def _should_retry_empty_result(sql: str) -> bool:
    """Retry once when an otherwise-valid query likely filtered away all rows."""
    return bool(re.search(r"\b(WHERE|HAVING)\b", sql, flags=re.IGNORECASE))


def _empty_result_retry_prompt() -> str:
    return (
        "The SQL executed successfully but returned 0 rows. If you added filters that were not "
        "explicitly requested, remove them. Do not filter by ID/null columns unless the user asked "
        "for that or the filtered column is the selected/grouped result column. Return corrected "
        'JSON with keys "sql" and "explanation" only.'
    )


def run_agent_ask(
    registry: DatasetRegistry,
    settings: Settings,
    req: AgentAskRequest,
    ollama_call=ollama_chat,
) -> AgentAskResponse:
    model_name = settings.llm_model
    ctx, ctx_err = build_dataset_context(
        registry,
        registry.workspace,
        req.dataset_ids,
        settings.agent_context_max_columns,
    )
    if ctx_err:
        return AgentAskResponse(model=model_name, error=ctx_err)

    cap = min(settings.agent_max_rows, settings.query_max_rows)
    limit = min(req.max_rows or cap, cap)

    user_block = (
        f"Datasets and schema:\n{ctx}\n\n"
        f"User question:\n{req.question.strip()}\n\n"
        'Return JSON object with keys "sql" (string) and "explanation" (string). /no_think'
    )
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _system_prompt()},
        {"role": "user", "content": user_block},
    ]

    last_content_err: str | None = None

    for attempt in range(max(1, settings.agent_sql_attempts)):
        try:
            content = ollama_call(settings, messages, OLLAMA_SQL_DRAFT_FORMAT)
        except httpx.ConnectError as e:
            logger.warning("Ollama connection failed: %s", e)
            return AgentAskResponse(
                model=model_name,
                error=(
                    f"Ollama is not reachable at {settings.llm_base_url}. "
                    f"Start Ollama and run `ollama pull {settings.llm_model}` "
                    "if the model is not installed."
                ),
            )
        except httpx.HTTPError as e:
            logger.warning("Ollama HTTP error: %s", e)
            return AgentAskResponse(
                model=model_name,
                error=f"Ollama at {settings.llm_base_url} failed: {e}",
            )
        except Exception as e:  # noqa: BLE001
            logger.exception("Ollama request failed")
            return AgentAskResponse(
                model=model_name,
                error=f"Ollama request failed: {e}",
            )

        draft, parse_err = parse_sql_draft(content)
        if parse_err or draft is None:
            last_content_err = parse_err or "Unknown parse error"
            if attempt + 1 >= settings.agent_sql_attempts:
                return AgentAskResponse(model=model_name, error=last_content_err)
            messages.append({"role": "assistant", "content": content})
            messages.append(
                {
                    "role": "user",
                    "content": (
                        f"Your previous reply was invalid: {last_content_err}. "
                        'Reply with only JSON: {{"sql":"...","explanation":"..."}}.'
                    ),
                }
            )
            continue

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
                messages.append({"role": "assistant", "content": content})
                messages.append({"role": "user", "content": _empty_result_retry_prompt()})
                continue

            if not settings.agent_summarize_with_llm:
                return AgentAskResponse(
                    answer=_default_answer(draft, qres),
                    sql=draft.sql,
                    explanation=draft.explanation or None,
                    query_result=qres,
                    model=model_name,
                )

            summary_messages = [
                {
                    "role": "system",
                    "content": (
                        "Summarize the query result for the user in clear language. "
                        "Be concise. Return JSON {\"answer\": \"...\"} only."
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
                scontent = ollama_call(settings, summary_messages, OLLAMA_SUMMARY_FORMAT)
                parsed_ans, serr = parse_summary_answer(scontent)
                answer = parsed_ans or (
                    f"{draft.explanation}\n\n(Summarization issue: {serr})".strip()
                    if serr
                    else (draft.explanation or "Query completed.")
                )
            except (httpx.HTTPError, OSError) as e:
                answer = (
                    f"{draft.explanation}\n\n(Summarization unavailable: {e})".strip()
                )

            return AgentAskResponse(
                answer=answer,
                sql=draft.sql,
                explanation=draft.explanation or None,
                query_result=qres,
                model=model_name,
            )

        err_text = qres.error or "Unknown SQL error"
        if attempt + 1 >= settings.agent_sql_attempts:
            return AgentAskResponse(
                model=model_name,
                sql=draft.sql,
                explanation=draft.explanation or None,
                query_result=qres,
                error=err_text,
            )

        messages.append({"role": "assistant", "content": content})
        messages.append(
            {
                "role": "user",
                "content": _sql_retry_prompt(err_text),
            }
        )

    raise AssertionError("run_agent_ask: expected all paths to return")  # pragma: no cover
