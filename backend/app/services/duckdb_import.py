"""Inspect and snapshot relations from an external local DuckDB database."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings
from app.errors import AppError, CODES
from app.models.api import DuckDbRelationRef, DuckDbRelationSummary
from app.services.registry import (
    DatasetRegistry,
    RegisteredDataset,
    guard_reserved_identifier,
    slugify_file_stem,
)

ATTACH_ALIAS = "_dcc_import_src"
DUCKDB_SOURCES_DIR = "duckdb_sources"
_UPLOAD_ID_LEN = 16


class DuckDbImportError(RuntimeError):
    """Raised with a sanitized message for import job failures."""


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
    if len(upload_id) != _UPLOAD_ID_LEN or not all(c in "0123456789abcdef" for c in upload_id):
        raise AppError(status_code=400, code=CODES.BAD_REQUEST, message="Invalid DuckDB upload id.")
    return _upload_root(settings) / DUCKDB_SOURCES_DIR / upload_id


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


def _set_timeout(con: duckdb.DuckDBPyConnection, timeout_seconds: float) -> None:
    try:
        con.execute(f"SET statement_timeout='{max(100, int(timeout_seconds * 1000))}ms'")
    except Exception as exc:  # noqa: BLE001
        if "unrecognized configuration parameter" not in str(exc):
            raise


def _connect_source(source_path: Path) -> duckdb.DuckDBPyConnection:
    return duckdb.connect(str(source_path), read_only=True)


def _relation_expr(schema_name: str, relation_name: str, *, attached: bool) -> str:
    if attached:
        return f"{_quote_ident(ATTACH_ALIAS)}.{_quote_ident(schema_name)}.{_quote_ident(relation_name)}"
    return f"{_quote_ident(schema_name)}.{_quote_ident(relation_name)}"


def _relation_row_count(
    con: duckdb.DuckDBPyConnection,
    *,
    schema_name: str,
    relation_name: str,
    settings: Settings,
) -> int | None:
    try:
        _set_timeout(con, settings.registration_count_timeout_seconds)
        row = con.execute(
            f"SELECT COUNT(*) AS c FROM {_relation_expr(schema_name, relation_name, attached=False)}"
        ).fetchone()
        return int(row[0]) if row else None
    except Exception:
        return None


def inspect_duckdb_relations(
    source_path: Path,
    *,
    settings: Settings,
) -> list[DuckDbRelationSummary]:
    try:
        con = _connect_source(source_path)
    except Exception as exc:  # noqa: BLE001
        raise AppError(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="DuckDB file could not be opened.",
        ) from exc
    try:
        rows = con.execute(
            """
            SELECT t.table_schema, t.table_name, t.table_type, COUNT(c.column_name) AS column_count
            FROM information_schema.tables t
            LEFT JOIN information_schema.columns c
              ON c.table_schema = t.table_schema
             AND c.table_name = t.table_name
            WHERE t.table_type IN ('BASE TABLE', 'VIEW')
              AND lower(t.table_schema) NOT IN ('information_schema', 'pg_catalog')
              AND lower(t.table_schema) NOT LIKE 'duckdb_%'
            GROUP BY t.table_schema, t.table_name, t.table_type
            ORDER BY t.table_schema, t.table_name
            """
        ).fetchall()
        out: list[DuckDbRelationSummary] = []
        for schema_name, name, table_type, column_count in rows:
            rel_type = "view" if str(table_type).upper() == "VIEW" else "table"
            out.append(
                DuckDbRelationSummary(
                    schema_name=str(schema_name),
                    name=str(name),
                    type=rel_type,
                    column_count=int(column_count or 0),
                    row_count=_relation_row_count(
                        con,
                        schema_name=str(schema_name),
                        relation_name=str(name),
                        settings=settings,
                    ),
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


def _snapshot_relation(
    con: duckdb.DuckDBPyConnection,
    *,
    rel: DuckDbRelationRef,
    export_path: Path,
) -> None:
    sql = (
        f"COPY (SELECT * FROM {_relation_expr(rel.schema_name, rel.name, attached=True)}) "
        f"TO {_quote_string(str(export_path))} (FORMAT PARQUET)"
    )
    try:
        con.execute(sql)
    except Exception as exc:  # noqa: BLE001
        label = (rel.alias or rel.name).strip() or rel.name
        raise DuckDbImportError(f"Unable to copy DuckDB relation {label}.") from exc


def import_duckdb_relations(
    *,
    source_path: Path,
    relations: list[DuckDbRelationRef],
    registry: DatasetRegistry,
    settings: Settings,
    queue_prepare: Callable[[str], str],
    on_progress: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    if not relations:
        raise DuckDbImportError("Select at least one DuckDB relation to import.")

    available = inspect_duckdb_relations(source_path, settings=settings)
    _validate_requested_relations(available, relations)

    batch_dir = _upload_root(settings) / "duckdb_imports" / uuid.uuid4().hex[:16]
    batch_dir.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    registered: list[RegisteredDataset] = []
    taken_paths: set[Path] = set()

    con = duckdb.connect(":memory:")
    try:
        _set_timeout(con, settings.query_timeout_seconds)
        con.execute(
            f"ATTACH {_quote_string(str(source_path))} AS {_quote_ident(ATTACH_ALIAS)} (READ_ONLY)"
        )
        for idx, rel in enumerate(relations):
            stem = _export_stem(source_path, rel)
            export_path = _unique_export_path(batch_dir, stem, taken_paths)
            copied.append(export_path)
            _snapshot_relation(con, rel=rel, export_path=export_path)
            ds = registry.register_path(export_path, compute_counts=False)
            registered.append(ds)
            queue_prepare(ds.dataset_id)
            if on_progress is not None:
                on_progress((idx + 1) / len(relations))
    except DuckDbImportError:
        cleanup_unregistered_import_files(copied, registered)
        _cleanup_empty_dir(batch_dir)
        raise
    except Exception as exc:  # noqa: BLE001
        cleanup_unregistered_import_files(copied, registered)
        _cleanup_empty_dir(batch_dir)
        raise DuckDbImportError("DuckDB import failed.") from exc
    finally:
        try:
            con.execute(f"DETACH {_quote_ident(ATTACH_ALIAS)}")
        except Exception:
            pass
        con.close()

    summaries = [registry.to_summary(ds).model_dump(mode="json") for ds in registered]
    return {"datasets": summaries}


def _cleanup_empty_dir(path: Path) -> None:
    try:
        if path.exists() and path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    except OSError:
        pass


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
