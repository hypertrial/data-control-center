"""Agent prompt templates and user message builders."""

from __future__ import annotations

import re
from typing import Any

from app.models.api import AgentAskRequest
from app.services import ask_store
from app.services.registry import DatasetRegistry

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
        "- Most common / mode / top by frequency / highest count: GROUP BY the dimension column, "
        "ORDER BY COUNT(*) DESC (or COUNT of that column), then LIMIT. Without GROUP BY, "
        "ORDER BY COUNT(...) cannot rank categories; do not fake it with ANY_VALUE alone.\n"
        "- Prefer quoted identifiers for column names when they contain spaces or special characters "
        'using double quotes, e.g. "col name".\n'
    )
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


def _build_user_block(registry: DatasetRegistry, req: AgentAskRequest, ctx: str) -> str:
    hist = ""
    if req.conversation_id and req.use_history:
        with registry.workspace.lock_db() as con:
            turns = ask_store.last_turns_for_context(
                con,
                req.conversation_id,
                n=3,
            )
        hist = ask_store.format_history_block(turns)
    return (
        f"{hist}"
        f"Datasets and schema:\n{ctx}\n\n"
        f"User question:\n{req.question.strip()}\n\n"
        'Return JSON object with keys "sql" (string) and "explanation" (string). /no_think'
    )
