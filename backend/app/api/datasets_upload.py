"""Dataset upload and path registration routes."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.api.datasets_jobs import _queue_dataset_prepare_job
from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import DatasetSummary, RegisterFileRequest, RegisterFolderRequest
from app.services.registry import SUPPORTED_EXTENSIONS
from app.services.upload_validation import UploadValidationError, validate_upload_file
from app.telemetry import emit

router = APIRouter()


def _safe_upload_filename(raw: str) -> str:
    name = Path(raw).name
    if not name or name != Path(name).name:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Invalid filename")
    if ".." in name or "/" in name or "\\" in name:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Invalid filename")
    return name


@router.post("/upload", response_model=list[DatasetSummary])
async def upload_datasets(
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
    jobs: JobsDep,
    files: Annotated[list[UploadFile], File(default_factory=list)],
):
    if not files:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="No files uploaded")
    if len(files) > settings.upload_max_files_per_batch:
        emit("security.upload_reject", reason="too_many_files", count=len(files))
        raise to_http_error(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message=f"Too many files uploaded; max is {settings.upload_max_files_per_batch}",
        )
    upload_root = settings.upload_dir
    if not upload_root.is_absolute():
        upload_root = Path.cwd() / upload_root
    upload_root.mkdir(parents=True, exist_ok=True)
    batch_dir = upload_root / uuid.uuid4().hex[:16]
    batch_dir.mkdir(parents=True)

    summaries: list[DatasetSummary] = []
    skipped: list[str] = []
    batch_size = 0
    for uf in files:
        raw_name = uf.filename or ""
        safe = _safe_upload_filename(raw_name)
        ext = Path(safe).suffix.lower()
        if ext == ".duckdb":
            skipped.append(safe)
            continue
        if ext not in SUPPORTED_EXTENSIONS:
            skipped.append(safe)
            continue
        dest = batch_dir / safe
        if dest.exists():
            stem, sfx = Path(safe).stem, Path(safe).suffix
            dest = batch_dir / f"{stem}_{uuid.uuid4().hex[:6]}{sfx}"
        size = 0
        try:
            with dest.open("wb") as out:
                while chunk := await uf.read(1024 * 1024):
                    size += len(chunk)
                    batch_size += len(chunk)
                    if size > settings.upload_max_bytes_per_file:
                        emit("security.upload_reject", reason="file_too_large", filename=safe)
                        raise to_http_error(
                            status_code=400,
                            code=CODES.BAD_REQUEST,
                            message=f"File exceeds max size ({settings.upload_max_bytes_per_file} bytes): {safe}",
                        )
                    if batch_size > settings.upload_max_batch_bytes:
                        emit("security.upload_reject", reason="batch_too_large")
                        raise to_http_error(
                            status_code=400,
                            code=CODES.BAD_REQUEST,
                            message=f"Upload batch exceeds max size ({settings.upload_max_batch_bytes} bytes)",
                        )
                    out.write(chunk)
        except Exception:
            dest.unlink(missing_ok=True)
            raise

        try:
            validate_upload_file(dest, settings)
            ds = registry.register_path(dest, compute_counts=False)
            summaries.append(registry.to_summary(ds))
            _queue_dataset_prepare_job(ds.dataset_id, jobs, registry, workspace, settings)
        except (ValueError, UploadValidationError) as exc:
            dest.unlink(missing_ok=True)
            emit("security.upload_reject", reason=type(exc).__name__, filename=safe)
            skipped.append(safe)

    if not summaries:
        detail = "No supported data files in upload"
        duckdb_only = skipped and all(Path(name).suffix.lower() == ".duckdb" for name in skipped)
        if duckdb_only:
            detail = "DuckDB files must use the DuckDB import flow, not dataset upload"
        elif skipped:
            detail += f" (skipped: {', '.join(skipped)})"
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message=detail)

    return summaries


@router.post("/register-file", response_model=DatasetSummary)
def register_file(
    body: RegisterFileRequest,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> DatasetSummary:
    if not settings.enable_path_registration:
        emit("security.path_registration_denied", kind="file")
        raise to_http_error(
            status_code=403,
            code=CODES.PATH_NOT_ALLOWED,
            message="Path registration is disabled. Upload files through the local UI or enable DCC_ENABLE_PATH_REGISTRATION.",
        )
    p = Path(body.path)
    try:
        ds = registry.register_path(p, compute_counts=False)
        _queue_dataset_prepare_job(ds.dataset_id, jobs, registry, workspace, settings)
    except FileNotFoundError:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="File not found")
    except IsADirectoryError:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Path must be a file")
    except ValueError as exc:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message=str(exc))
    return registry.to_summary(ds)


@router.post("/register-folder", response_model=list[DatasetSummary])
def register_folder(
    body: RegisterFolderRequest,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> list[DatasetSummary]:
    if not settings.enable_path_registration:
        emit("security.path_registration_denied", kind="folder")
        raise to_http_error(
            status_code=403,
            code=CODES.PATH_NOT_ALLOWED,
            message="Path registration is disabled. Upload files through the local UI or enable DCC_ENABLE_PATH_REGISTRATION.",
        )
    p = Path(body.path)
    try:
        dss = registry.register_folder(p, recursive=body.recursive)
        for ds in dss:
            _queue_dataset_prepare_job(ds.dataset_id, jobs, registry, workspace, settings)
    except NotADirectoryError:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Path must be a directory")
    return [registry.to_summary(ds) for ds in dss]
