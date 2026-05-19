"""Dataset listing, metadata, and sample row routes."""

from __future__ import annotations

import logging

import duckdb
from fastapi import APIRouter, Query, Response

from app.api.deps import RegistryDep, SettingsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import DatasetSummary
from app.services.workspace import sanitize_sql_identifier

logger = logging.getLogger(__name__)

router = APIRouter()


def _sample_rows_http_error(exc: Exception):
    msg = str(exc).lower()
    if isinstance(exc, duckdb.Error):
        if "timeout" in msg or "interrupted" in msg:
            return to_http_error(
                status_code=408,
                code=CODES.SQL_TIMEOUT,
                message="Sample query timed out",
            )
        if "does not exist" in msg or "catalog error" in msg:
            return to_http_error(
                status_code=404,
                code=CODES.NOT_FOUND,
                message="Dataset view is not available",
            )
        return to_http_error(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="Unable to read sample rows",
        )
    logger.exception("sample_rows failed")
    return to_http_error(
        status_code=500,
        code=CODES.INTERNAL_ERROR,
        message="Unable to read sample rows",
    )


def list_datasets(registry: RegistryDep, workspace: WorkspaceDep) -> list[DatasetSummary]:
    out: list[DatasetSummary] = []
    for ds in registry.list_all():
        s = registry.to_summary(ds)
        qs: int | None = None
        cached = workspace.load_profile_cache(ds.dataset_id)
        if isinstance(cached, dict):
            raw = cached.get("quality_score")
            if raw is not None:
                try:
                    qs = int(raw)
                except (TypeError, ValueError):
                    qs = None
        out.append(s.model_copy(update={"quality_score": qs}))
    return out


@router.get("/{dataset_id}", response_model=DatasetSummary)
def get_dataset(dataset_id: str, registry: RegistryDep) -> DatasetSummary:
    ds = registry.get(dataset_id)
    if not ds:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    return registry.to_summary(ds)


@router.delete("/{dataset_id}", status_code=204)
def delete_dataset(dataset_id: str, registry: RegistryDep) -> Response:
    if not registry.unregister(dataset_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    return Response(status_code=204)


@router.get("/{dataset_id}/sample")
def sample_rows(
    dataset_id: str,
    registry: RegistryDep,
    settings: SettingsDep,
    page: int = Query(1, ge=1),
    page_size: int | None = Query(None, ge=1),
):
    ds = registry.get(dataset_id)
    if not ds:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")

    ps = page_size or settings.sample_default_page_size
    if ps > settings.sample_max_page_size:
        raise to_http_error(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message=f"page_size must be <= {settings.sample_max_page_size}",
        )

    offset = (page - 1) * ps
    safe_view = sanitize_sql_identifier(ds.view_name)

    try:
        with registry.workspace.read_db() as con:
            try:
                timeout_ms = max(100, int(settings.query_timeout_seconds * 1000))
                con.execute(f"SET statement_timeout='{timeout_ms}ms'")
            except Exception as exc:  # noqa: BLE001
                if "unrecognized configuration parameter" not in str(exc):
                    raise
            res = con.execute(f"SELECT * FROM {safe_view} LIMIT {int(ps)} OFFSET {int(offset)}")
            cols_meta = res.description or []
            colnames = [c[0] for c in cols_meta]
            fetched = res.fetchall()

        rows = [{colnames[i]: row[i] for i in range(len(colnames))} for row in fetched]
        total_rows = ds.row_count
        if total_rows is None:
            total_rows = registry.workspace.query_count(ds.view_name, settings.registration_count_timeout_seconds)
        total_rows = total_rows if total_rows is not None else 0
        return {
            "page": page,
            "page_size": ps,
            "row_count": len(rows),
            "total_rows": total_rows,
            "columns": colnames,
            "rows": rows,
        }
    except Exception as exc:  # noqa: BLE001
        raise _sample_rows_http_error(exc)
