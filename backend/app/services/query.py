"""Ad-hoc SQL execution with hardened guardrails, timeout, and telemetry."""

from __future__ import annotations

from dataclasses import dataclass

from app.config import Settings
from app.models.api import QueryRequest, QueryResult, QueryResultColumn
from app.services.registry import DatasetRegistry
from app.services.sql_validate import validate_workspace_sql
from app.telemetry import emit


@dataclass
class QueryExecError(Exception):
    message: str
    code: str


def _apply_statement_timeout(con: object, timeout_seconds: float) -> None:
    timeout_ms = max(100, int(timeout_seconds * 1000))
    try:
        con.execute(f"SET statement_timeout='{timeout_ms}ms'")
    except Exception as exc:  # noqa: BLE001
        if "unrecognized configuration parameter" not in str(exc):
            raise


def execute_query(
    registry: DatasetRegistry,
    settings: Settings,
    req: QueryRequest,
) -> QueryResult:
    views = {ds.view_name for ds in registry.list_all()}
    refs: set[str] = set()
    err, normalized = validate_workspace_sql(req.sql, views)
    if err:
        return QueryResult(columns=[], rows=[], row_count=0, error=err)

    assert normalized is not None

    limit = min(req.max_rows or settings.query_max_rows, settings.query_max_rows)
    fetch_cap = limit + 1
    wrapped = f"SELECT * FROM ({normalized}) AS _dcc_sub LIMIT {int(fetch_cap)}"

    try:
        with registry.workspace.read_db() as con:
            _apply_statement_timeout(con, settings.query_timeout_seconds)
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
            return QueryResult(columns=[], rows=[], row_count=0, error="Query timed out.")
        return QueryResult(columns=[], rows=[], row_count=0, error="Query failed.")
