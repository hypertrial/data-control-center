"""DuckDB source registration and resolution helpers."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from app.config import Settings
from app.errors import AppError, CODES
from app.models.api import DuckDbSourceResponse
from app.services.registry import DatasetRegistry
from app.services.upload_validation import validate_duckdb_upload

DUCKDB_SOURCES_DIR = "duckdb_sources"
DUCKDB_LOCAL_SOURCES_DIR = "local"
LOCAL_SOURCE_PREFIX = "loc_"
_SOURCE_ID_LEN = 16


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
