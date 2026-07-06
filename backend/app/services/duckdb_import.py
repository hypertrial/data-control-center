"""Inspect and snapshot tables and views from an external local DuckDB database."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings
from app.errors import AppError, CODES
from app.models.api import DuckDbRelationRef, DuckDbRelationSummary
from app.services.duckdb_sources import (
    DUCKDB_SOURCES_DIR,
    LOCAL_SOURCE_PREFIX,
    _local_metadata_path,
    _upload_root,
    _workspace_path,
    cleanup_duckdb_local_opens,
    pick_and_register_local_duckdb,
    register_local_duckdb_open,
    reject_workspace_duckdb_upload,
    resolve_duckdb_source,
    resolve_staged_duckdb_upload,
)
from app.services.duckdb_timeout import apply_statement_timeout
from app.services.registry import (
    DatasetRegistry,
    RegisteredDataset,
    guard_reserved_identifier,
    slugify_file_stem,
)
from app.telemetry import emit

__all__ = [
    "DUCKDB_SOURCES_DIR",
    "LOCAL_SOURCE_PREFIX",
    "_local_metadata_path",
    "_upload_root",
    "_workspace_path",
    "cleanup_duckdb_local_opens",
    "pick_and_register_local_duckdb",
    "register_local_duckdb_open",
    "reject_workspace_duckdb_upload",
    "resolve_duckdb_source",
    "resolve_staged_duckdb_upload",
]


class DuckDbImportError(RuntimeError):
    """Raised with a sanitized message for import job failures."""


class DuckDbImportCancelled(DuckDbImportError):
    """Raised when a DuckDB import observes a requested cancellation."""


def _check_cancelled(cancel_requested: Callable[[], bool] | None) -> None:
    if cancel_requested is not None and cancel_requested():
        raise DuckDbImportCancelled("DuckDB import canceled.")


def _quote_ident(raw: str) -> str:
    return '"' + raw.replace('"', '""') + '"'


def _quote_string(raw: str) -> str:
    return "'" + raw.replace("'", "''") + "'"


def _connect_source(
    source_path: Path,
    *,
    allowed_dirs: list[Path] | None = None,
) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(str(source_path), read_only=True)
    if allowed_dirs:
        con.execute("SET allowed_directories = ?", [[str(d) for d in allowed_dirs]])
    con.execute("SET enable_external_access = false")
    return con


def _relation_expr(schema_name: str, relation_name: str) -> str:
    return f"{_quote_ident(schema_name)}.{_quote_ident(relation_name)}"


def _relation_table_type(
    con: duckdb.DuckDBPyConnection,
    *,
    schema_name: str,
    relation_name: str,
) -> str | None:
    row = con.execute(
        """
        SELECT table_type
        FROM information_schema.tables
        WHERE table_schema = ?
          AND table_name = ?
          AND table_type IN ('BASE TABLE', 'VIEW')
        LIMIT 1
        """,
        [schema_name, relation_name],
    ).fetchone()
    return str(row[0]).upper() if row else None


def _inspect_table_type_filter(settings: Settings) -> str:
    if settings.enable_duckdb_view_import:
        return "t.table_type IN ('BASE TABLE', 'VIEW')"
    return "t.table_type = 'BASE TABLE'"


def _ensure_view_import_allowed(
    con: duckdb.DuckDBPyConnection,
    *,
    schema_name: str,
    relation_name: str,
    settings: Settings,
) -> None:
    if settings.enable_duckdb_view_import:
        return
    if _relation_table_type(con, schema_name=schema_name, relation_name=relation_name) == "VIEW":
        raise _relation_not_importable_error()


def _relation_not_importable_error() -> AppError:
    return AppError(
        status_code=400,
        code=CODES.BAD_REQUEST,
        message="Selected DuckDB relation is not available for import.",
    )


def _relation_row_count(
    con: duckdb.DuckDBPyConnection,
    *,
    schema_name: str,
    relation_name: str,
    settings: Settings,
) -> int | None:
    try:
        apply_statement_timeout(con, settings.registration_count_timeout_seconds)
        row = con.execute(
            f"SELECT COUNT(*) AS c FROM {_relation_expr(schema_name, relation_name)}"
        ).fetchone()
        return int(row[0]) if row else None
    except Exception:
        return None


def count_duckdb_relation(
    source_path: Path,
    *,
    schema_name: str,
    relation_name: str,
    settings: Settings,
) -> int | None:
    try:
        con = _connect_source(source_path)
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="DuckDB file could not be opened.",
        ) from exc
    try:
        _ensure_view_import_allowed(
            con,
            schema_name=schema_name,
            relation_name=relation_name,
            settings=settings,
        )
        return _relation_row_count(
            con,
            schema_name=schema_name,
            relation_name=relation_name,
            settings=settings,
        )
    finally:
        con.close()


def inspect_duckdb_relations(
    source_path: Path,
    *,
    settings: Settings,
    include_row_counts: bool | None = None,
) -> list[DuckDbRelationSummary]:
    if include_row_counts is None:
        include_row_counts = settings.duckdb_inspect_include_row_counts
    try:
        con = _connect_source(source_path)
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="DuckDB file could not be opened.",
        ) from exc
    try:
        type_filter = _inspect_table_type_filter(settings)
        rows = con.execute(
            f"""
            SELECT t.table_schema, t.table_name, t.table_type, COUNT(c.column_name) AS column_count
            FROM information_schema.tables t
            LEFT JOIN information_schema.columns c
              ON c.table_schema = t.table_schema
             AND c.table_name = t.table_name
            WHERE {type_filter}
              AND lower(t.table_schema) NOT IN ('information_schema', 'pg_catalog')
              AND lower(t.table_schema) NOT LIKE 'duckdb_%'
            GROUP BY t.table_schema, t.table_name, t.table_type
            ORDER BY t.table_schema, t.table_name
            """
        ).fetchall()
        out: list[DuckDbRelationSummary] = []
        for schema_name, name, table_type, column_count in rows:
            rel_type = "view" if str(table_type).upper() == "VIEW" else "table"
            row_count: int | None = None
            if include_row_counts:
                row_count = _relation_row_count(
                    con,
                    schema_name=str(schema_name),
                    relation_name=str(name),
                    settings=settings,
                )
            out.append(
                DuckDbRelationSummary(
                    schema_name=str(schema_name),
                    name=str(name),
                    type=rel_type,
                    column_count=int(column_count or 0),
                    row_count=row_count,
                )
            )
        return out
    except AppError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="DuckDB file could not be inspected.",
        ) from exc
    finally:
        con.close()


def _export_stem(source_path: Path, rel: DuckDbRelationRef) -> str:
    raw = (rel.alias or "").strip() or f"{source_path.stem}__{rel.schema_name}__{rel.name}"
    slug = slugify_file_stem(raw, uuid.uuid4().hex[:8])
    return guard_reserved_identifier(slug)


def _unique_export_path(batch_dir: Path, stem: str, taken: set[Path]) -> Path:
    candidate = batch_dir / f"{stem}.parquet"
    n = 2
    while candidate in taken or candidate.exists():
        candidate = batch_dir / f"{stem}_{n}.parquet"
        n += 1
    taken.add(candidate)
    return candidate


def _relation_key(schema_name: str, name: str) -> tuple[str, str]:
    return schema_name, name


def _validate_requested_relations(
    available: list[DuckDbRelationSummary],
    requested: list[DuckDbRelationRef],
) -> None:
    allowed = {_relation_key(r.schema_name, r.name) for r in available}
    for rel in requested:
        if _relation_key(rel.schema_name, rel.name) not in allowed:
            raise DuckDbImportError("Selected DuckDB relation is not available for import.")


def _snapshot_copy_error_message(exc: BaseException, *, label: str) -> str:
    detail = str(exc).lower()
    if "timeout" in detail or "statement_timeout" in detail:
        return (
            f"Export timed out for {label}. Try fewer relations or raise "
            "DCC_DUCKDB_IMPORT_TIMEOUT_SECONDS."
        )
    if "disabled by configuration" in detail or "permission error" in detail:
        return (
            f"{label} could not be exported: its definition reads external files, "
            "attaches another database, or accesses the network, which Data Control "
            "Center blocks for security. Materialize it as a table in the source "
            "database, or export it manually."
        )
    return f"Unable to copy DuckDB relation {label}."


def _is_external_access_blocked(exc: BaseException) -> bool:
    detail = str(exc).lower()
    return "disabled by configuration" in detail or "permission error" in detail


def _snapshot_relation(
    con: duckdb.DuckDBPyConnection,
    *,
    rel: DuckDbRelationRef,
    export_path: Path,
) -> None:
    # Use the source file connection (not ATTACH under another alias) so views that
    # reference catalog-qualified names (e.g. oddsfox.schema.table) still resolve.
    sql = (
        f"COPY (SELECT * FROM {_relation_expr(rel.schema_name, rel.name)}) "
        f"TO {_quote_string(str(export_path))} (FORMAT PARQUET)"
    )
    try:
        con.execute(sql)
    except Exception as exc:  # noqa: BLE001
        label = (rel.alias or rel.name).strip() or rel.name
        if _is_external_access_blocked(exc):
            emit(
                "security.duckdb_view_export_blocked",
                schema=rel.schema_name,
                name=rel.name,
            )
        raise DuckDbImportError(_snapshot_copy_error_message(exc, label=label)) from exc


def import_duckdb_relations(
    *,
    source_path: Path,
    relations: list[DuckDbRelationRef],
    registry: DatasetRegistry,
    settings: Settings,
    queue_prepare: Callable[[str], str],
    on_progress: Callable[[float], None] | None = None,
    cancel_requested: Callable[[], bool] | None = None,
) -> dict[str, Any]:
    if not relations:
        raise DuckDbImportError("Select at least one DuckDB relation to import.")

    available = inspect_duckdb_relations(source_path, settings=settings, include_row_counts=False)
    _validate_requested_relations(available, relations)

    batch_dir = _upload_root(settings) / "duckdb_imports" / uuid.uuid4().hex[:16]
    batch_dir.mkdir(parents=True, exist_ok=True)
    batch_dir = batch_dir.resolve()
    copied: list[Path] = []
    registered: list[RegisteredDataset] = []
    taken_paths: set[Path] = set()
    snapshots: list[Path] = []

    con: duckdb.DuckDBPyConnection | None = None
    try:
        _check_cancelled(cancel_requested)
        con = _connect_source(source_path, allowed_dirs=[batch_dir])
        apply_statement_timeout(con, settings.duckdb_import_timeout_seconds)
        if not settings.enable_duckdb_view_import:
            for rel in relations:
                _ensure_view_import_allowed(
                    con,
                    schema_name=rel.schema_name,
                    relation_name=rel.name,
                    settings=settings,
                )
        for idx, rel in enumerate(relations):
            _check_cancelled(cancel_requested)
            stem = _export_stem(source_path, rel)
            export_path = _unique_export_path(batch_dir, stem, taken_paths)
            copied.append(export_path)
            _snapshot_relation(con, rel=rel, export_path=export_path)
            snapshots.append(export_path)
            if on_progress is not None:
                on_progress((idx + 1) / max(1, len(relations)) * 0.75)
        _check_cancelled(cancel_requested)
        for export_path in snapshots:
            ds = registry.register_path(export_path, compute_counts=False)
            registered.append(ds)
        _check_cancelled(cancel_requested)
        for idx, ds in enumerate(registered):
            queue_prepare(ds.dataset_id)
            if on_progress is not None:
                on_progress(0.75 + (idx + 1) / max(1, len(snapshots)) * 0.25)
    except DuckDbImportError:
        rollback_imported_datasets(registry, copied, registered)
        _cleanup_empty_dir(batch_dir)
        raise
    except AppError:
        rollback_imported_datasets(registry, copied, registered)
        _cleanup_empty_dir(batch_dir)
        raise
    except Exception as exc:  # noqa: BLE001
        rollback_imported_datasets(registry, copied, registered)
        _cleanup_empty_dir(batch_dir)
        raise DuckDbImportError("DuckDB import failed.") from exc
    finally:
        if con is not None:
            con.close()

    summaries = [registry.to_summary(ds).model_dump(mode="json") for ds in registered]
    return {"datasets": summaries}


def _cleanup_empty_dir(path: Path) -> None:
    try:
        if path.exists() and path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    except OSError:
        pass


def rollback_imported_datasets(
    registry: DatasetRegistry,
    copied: list[Path],
    registered: list[RegisteredDataset],
) -> None:
    for ds in reversed(registered):
        try:
            registry.unregister(ds.dataset_id)
        except Exception:  # noqa: BLE001
            pass
    cleanup_unregistered_import_files(copied, [])


def cleanup_unregistered_import_files(copied: list[Path], registered: list[RegisteredDataset]) -> None:
    registered_paths = {ds.source_path.resolve() for ds in registered}
    parents = {path.parent for path in copied}
    for path in copied:
        try:
            if path.resolve() not in registered_paths:
                path.unlink(missing_ok=True)
        except OSError:
            pass
    for parent in parents:
        _cleanup_empty_dir(parent)
