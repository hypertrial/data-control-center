"""Ad-hoc SQL execution with hardened guardrails, timeout, and telemetry."""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.models.api import QueryRequest, QueryResult, QueryResultColumn
from app.services.duckdb_timeout import apply_statement_timeout
from app.services.registry import DatasetRegistry
from app.services.query_errors import MSG_QUERY_TIMEOUT, sanitize_query_execution_error
from app.services.sql_validate import validate_workspace_sql_details
from app.telemetry import emit


@dataclass
class QueryExecError(Exception):
    message: str
    code: str


def execute_query(
    registry: DatasetRegistry,
    settings: Settings,
    req: QueryRequest,
) -> QueryResult:
    views = {ds.view_name for ds in registry.list_all()}
    validation = validate_workspace_sql_details(req.sql, views)
    if validation.error:
        return QueryResult(columns=[], rows=[], row_count=0, error=validation.error)

    normalized = validation.normalized_sql
    assert normalized is not None
    refs = validation.relation_refs

    limit = min(req.max_rows or settings.query_max_rows, settings.query_max_rows)
    fetch_cap = limit + 1
    wrapped = f"SELECT * FROM ({normalized}) AS _dcc_sub LIMIT {int(fetch_cap)}"

    try:
        with registry.workspace.read_db() as con:
            apply_statement_timeout(con, settings.query_timeout_seconds)
            res = con.execute(wrapped)
            cols_meta = res.description or []
            colnames = [c[0] for c in cols_meta]
            fetched: list[tuple[object, ...]] = []
            while len(fetched) < fetch_cap:
                row = res.fetchone()
                if row is None:
                    break
                fetched.append(row)

        truncated = len(fetched) > limit
        trimmed = fetched[:limit]
        rows = [{colnames[i]: row[i] for i in range(len(colnames))} for row in trimmed]
        cols = [QueryResultColumn(name=c, type=None) for c in colnames]
        emit(
            "query.execute",
            relation_count=len(refs),
            row_count=len(rows),
            truncated=truncated,
            timeout_seconds=settings.query_timeout_seconds,
            success=True,
        )
        return QueryResult(columns=cols, rows=rows, row_count=len(rows), truncated=truncated)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        timeout = "timeout" in msg.lower()
        emit(
            "query.execute",
            relation_count=len(refs),
            timeout_seconds=settings.query_timeout_seconds,
            success=False,
            timeout=timeout,
            error=type(e).__name__,
        )
        if timeout:
            return QueryResult(columns=[], rows=[], row_count=0, error=MSG_QUERY_TIMEOUT)
        return QueryResult(columns=[], rows=[], row_count=0, error=sanitize_query_execution_error(e))
