"""Ad-hoc SQL execution with basic guardrails."""

from __future__ import annotations

import re

from app.config import Settings
from app.models.api import QueryRequest, QueryResult, QueryResultColumn
from app.services.registry import DatasetRegistry

FORBIDDEN = re.compile(
    r"\b(ATTACH|DETACH|INSTALL|LOAD\s+EXTENSION|COPY\s+DATABASE|EXPORT\s+DATABASE)\b",
    re.IGNORECASE,
)


def _references_registered_view(sql: str, view_names: set[str]) -> bool:
    for v in view_names:
        if re.search(rf"\b{re.escape(v)}\b", sql):
            return True
    return False


def execute_query(
    registry: DatasetRegistry,
    settings: Settings,
    req: QueryRequest,
) -> QueryResult:
    if FORBIDDEN.search(req.sql):
        return QueryResult(
            columns=[],
            rows=[],
            row_count=0,
            error="SQL contains a forbidden keyword for this workspace.",
        )
    views = {ds.view_name for ds in registry.list_all()}
    if views and not _references_registered_view(req.sql, views):
        return QueryResult(
            columns=[],
            rows=[],
            row_count=0,
            error="SQL must reference at least one registered dataset view (e.g. v_ds_001).",
        )
    limit = min(req.max_rows or settings.query_max_rows, settings.query_max_rows)
    con = registry.workspace.connection
    try:
        res = con.execute(req.sql)
        cols_meta = res.description or []
        colnames = [c[0] for c in cols_meta]
        fetched = res.fetchall()
        rows: list[dict[str, object]] = [
            {colnames[i]: row[i] for i in range(len(colnames))} for row in fetched
        ]
        truncated = len(rows) > limit
        rows = rows[:limit]
        cols = [QueryResultColumn(name=c, type=None) for c in colnames]
        return QueryResult(
            columns=cols,
            rows=rows,
            row_count=len(rows),
            truncated=truncated,
        )
    except Exception as e:  # noqa: BLE001
        return QueryResult(columns=[], rows=[], row_count=0, error=str(e))
