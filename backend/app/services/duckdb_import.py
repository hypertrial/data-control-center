"""Inspect and snapshot tables and views from an external local DuckDB database."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings
from app.errors import AppError, CODES
from app.models.api import DuckDbRelationRef, DuckDbRelationSummary, DuckDbSourceResponse
from app.services.duckdb_timeout import apply_statement_timeout
from app.services.registry import (
    DatasetRegistry,
    RegisteredDataset,
    guard_reserved_identifier,
    slugify_file_stem,
)
from app.services.upload_validation import validate_duckdb_upload
from app.telemetry import emit

DUCKDB_SOURCES_DIR = "duckdb_sources"
DUCKDB_LOCAL_SOURCES_DIR = "local"
LOCAL_SOURCE_PREFIX = "loc_"
_SOURCE_ID_LEN = 16


class DuckDbImportError(RuntimeError):
    """Raised with a sanitized message for import job failures."""


class DuckDbImportCancelled(DuckDbImportError):
    """Raised when a DuckDB import observes a requested cancellation."""


def _check_cancelled(cancel_requested: Callable[[], bool] | None) -> None:
    if cancel_requested is not None and cancel_requested():
        raise DuckDbImportCancelled("DuckDB import canceled.")


def _workspace_path(settings: Settings) -> Path:
    p = settings.workspace_db_path
    if not p.is_absolute():
        p = Path.cwd() / p
    return p.resolve()


def _upload_root(settings: Settings) -> Path:
    upload_dir = settings.upload_dir
    if not upload_dir.is_absolute():
        upload_dir = Path.cwd() / upload_dir
    return upload_dir.resolve()


def _staged_upload_dir(upload_id: str, settings: Settings) -> Path:
    if len(upload_id) != _SOURCE_ID_LEN or not all(c in "0123456789abcdef" for c in upload_id):
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Invalid DuckDB upload id.")
    return _upload_root(settings) / DUCKDB_SOURCES_DIR / upload_id


def _local_sources_dir(settings: Settings) -> Path:
    return _upload_root(settings) / DUCKDB_SOURCES_DIR / DUCKDB_LOCAL_SOURCES_DIR


def _local_metadata_path(source_id: str, settings: Settings) -> Path:
    if not source_id.startswith(LOCAL_SOURCE_PREFIX):
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Invalid DuckDB source id.")
    suffix = source_id[len(LOCAL_SOURCE_PREFIX) :]
    if len(suffix) != _SOURCE_ID_LEN or not all(c in "0123456789abcdef" for c in suffix):
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Invalid DuckDB source id.")
    return _local_sources_dir(settings) / f"{source_id}.json"


def _is_local_source_id(source_id: str) -> bool:
    return source_id.startswith(LOCAL_SOURCE_PREFIX)


def _is_upload_source_id(source_id: str) -> bool:
    return (
        len(source_id) == _SOURCE_ID_LEN
        and all(c in "0123456789abcdef" for c in source_id)
        and not _is_local_source_id(source_id)
    )


def register_local_duckdb_open(
    raw_path: str,
    *,
    registry: DatasetRegistry,
    settings: Settings,
) -> DuckDbSourceResponse:
    if not settings.enable_duckdb_local_open:
        raise AppError(
            status_code=403,
            code=CODES.PATH_NOT_ALLOWED,
            message="Opening DuckDB files from disk is disabled.",
        )
    p = Path(raw_path).expanduser()
    if not p.is_absolute():
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Path must be absolute.")
    p = p.resolve()
    registry.ensure_registration_allowed(p)
    if p.suffix.lower() != ".duckdb":
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Path must point to a .duckdb file.")
    if not p.is_file():
        raise AppError(status_code=404, code=CODES.NOT_FOUND, message="DuckDB file not found.")
    reject_workspace_duckdb_upload(p, settings=settings)
    validate_duckdb_upload(p, settings)

    source_id = f"{LOCAL_SOURCE_PREFIX}{uuid.uuid4().hex[:_SOURCE_ID_LEN]}"
    meta_dir = _local_sources_dir(settings)
    meta_dir.mkdir(parents=True, exist_ok=True)
    meta_path = _local_metadata_path(source_id, settings)
    meta_path.write_text(
        json.dumps({"path": str(p), "filename": p.name, "created_at": time.time()}),
        encoding="utf-8",
    )
    return DuckDbSourceResponse(source_id=source_id, filename=p.name, source_kind="local")


def pick_and_register_local_duckdb(
    *,
    registry: DatasetRegistry,
    settings: Settings,
) -> DuckDbSourceResponse:
    if not settings.enable_duckdb_native_pick:
        raise AppError(
            status_code=403,
            code=CODES.PATH_NOT_ALLOWED,
            message="Native DuckDB file picker is disabled.",
        )
    from app.services.duckdb_native_pick import native_pick_available, pick_local_duckdb_path

    if not native_pick_available():
        raise AppError(
            status_code=503,
            code=CODES.INTERNAL_ERROR,
            message="Native file picker is not available on this system.",
        )
    try:
        picked = pick_local_duckdb_path()
    except Exception as exc:
        raise AppError(
            status_code=503,
            code=CODES.INTERNAL_ERROR,
            message="Native file picker failed. Enter an absolute path instead.",
        ) from exc
    if picked is None:
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="File selection was cancelled.")
    return register_local_duckdb_open(str(picked), registry=registry, settings=settings)


def resolve_staged_duckdb_upload(upload_id: str, *, settings: Settings) -> Path:
    batch_dir = _staged_upload_dir(upload_id, settings)
    if not batch_dir.is_dir():
        raise AppError(status_code=404, code=CODES.NOT_FOUND, message="DuckDB upload not found.")
    candidates = sorted(p for p in batch_dir.iterdir() if p.is_file() and p.suffix.lower() == ".duckdb")
    if not candidates:
        raise AppError(status_code=404, code=CODES.NOT_FOUND, message="DuckDB upload not found.")
    if len(candidates) > 1:
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="DuckDB upload is invalid.")
    source = candidates[0].resolve()
    if source == _workspace_path(settings):
        raise AppError(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="Cannot import the active Data Control Center workspace database.",
        )
    return source


def resolve_local_duckdb_source(source_id: str, *, registry: DatasetRegistry, settings: Settings) -> Path:
    meta_path = _local_metadata_path(source_id, settings)
    if not meta_path.is_file():
        raise AppError(status_code=404, code=CODES.NOT_FOUND, message="DuckDB source not found.")
    try:
        payload = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AppError(status_code=404, code=CODES.NOT_FOUND, message="DuckDB source not found.") from exc
    raw = payload.get("path")
    if not isinstance(raw, str) or not raw.strip():
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="DuckDB source is invalid.")
    p = Path(raw).expanduser().resolve()
    registry.ensure_registration_allowed(p)
    if not p.is_file() or p.suffix.lower() != ".duckdb":
        raise AppError(status_code=404, code=CODES.NOT_FOUND, message="DuckDB file not found.")
    reject_workspace_duckdb_upload(p, settings=settings)
    return p


def resolve_duckdb_source(source_id: str, *, registry: DatasetRegistry, settings: Settings) -> Path:
    if _is_local_source_id(source_id):
        return resolve_local_duckdb_source(source_id, registry=registry, settings=settings)
    if _is_upload_source_id(source_id):
        return resolve_staged_duckdb_upload(source_id, settings=settings)
    raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Invalid DuckDB source id.")


def cleanup_duckdb_local_opens(settings: Settings) -> None:
    root = _local_sources_dir(settings)
    if not root.is_dir():
        return
    ttl_seconds = settings.duckdb_local_open_ttl_hours * 3600
    cutoff = time.time() - ttl_seconds
    for meta in root.glob("*.json"):
        try:
            if meta.stat().st_mtime <= cutoff:
                meta.unlink(missing_ok=True)
        except OSError:
            continue


def reject_workspace_duckdb_upload(path: Path, *, settings: Settings) -> None:
    if path.resolve() == _workspace_path(settings):
        raise AppError(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="Cannot import the active Data Control Center workspace database.",
        )


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
