"""DuckDB relation inspection and snapshot import routes."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.api.datasets_jobs import _queue_dataset_prepare_job
from app.api.datasets_upload import _safe_upload_filename
from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import (
    DuckDbCapabilitiesResponse,
    DuckDbImportRequest,
    DuckDbInspectRequest,
    DuckDbOpenLocalRequest,
    DuckDbRelationCountRequest,
    DuckDbRelationCountResponse,
    DuckDbRelationSummary,
    DuckDbSourceResponse,
    JobCreateResponse,
    JobStatus,
)
from app.services.duckdb_import import (
    DUCKDB_SOURCES_DIR,
    count_duckdb_relation,
    import_duckdb_relations,
    inspect_duckdb_relations,
    pick_and_register_local_duckdb,
    register_local_duckdb_open,
    reject_workspace_duckdb_upload,
    resolve_duckdb_source,
)
from app.services.upload_validation import UploadValidationError, validate_duckdb_upload
from app.telemetry import emit

router = APIRouter(prefix="/duckdb")


@router.get("/capabilities", response_model=DuckDbCapabilitiesResponse)
def duckdb_capabilities(settings: SettingsDep) -> DuckDbCapabilitiesResponse:
    from app.services.duckdb_native_pick import native_pick_available

    return DuckDbCapabilitiesResponse(
        local_open_enabled=settings.enable_duckdb_local_open,
        upload_soft_max_bytes=settings.duckdb_upload_soft_max_bytes,
        inspect_include_row_counts_default=settings.duckdb_inspect_include_row_counts,
        native_pick_enabled=settings.enable_duckdb_native_pick and native_pick_available(),
    )


@router.post("/upload", response_model=DuckDbSourceResponse)
async def upload_duckdb(
    settings: SettingsDep,
    file: Annotated[UploadFile | None, File()] = None,
) -> DuckDbSourceResponse:
    if file is None:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="No DuckDB file uploaded")
    raw_name = file.filename or ""
    safe = _safe_upload_filename(raw_name)
    if Path(safe).suffix.lower() != ".duckdb":
        raise to_http_error(
            status_code=400,
            code=CODES.BAD_REQUEST,
            message="Upload must be a .duckdb file",
        )

    upload_root = settings.upload_dir
    if not upload_root.is_absolute():
        upload_root = Path.cwd() / upload_root
    upload_root.mkdir(parents=True, exist_ok=True)

    source_id = uuid.uuid4().hex[:16]
    batch_dir = upload_root.resolve() / DUCKDB_SOURCES_DIR / source_id
    batch_dir.mkdir(parents=True)
    dest = batch_dir / safe
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > settings.upload_max_bytes_per_file:
                    emit("security.upload_reject", reason="file_too_large", filename=safe)
                    raise to_http_error(
                        status_code=400,
                        code=CODES.BAD_REQUEST,
                        message=f"File exceeds max size ({settings.upload_max_bytes_per_file} bytes)",
                    )
                out.write(chunk)
    except Exception:
        dest.unlink(missing_ok=True)
        try:
            batch_dir.rmdir()
        except OSError:
            pass
        raise

    try:
        reject_workspace_duckdb_upload(dest, settings=settings)
        validate_duckdb_upload(dest, settings)
    except UploadValidationError as exc:
        dest.unlink(missing_ok=True)
        try:
            batch_dir.rmdir()
        except OSError:
            pass
        emit("security.upload_reject", reason=type(exc).__name__, filename=safe)
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message=str(exc)) from exc

    return DuckDbSourceResponse(source_id=source_id, filename=safe, source_kind="upload")


@router.post("/open-local", response_model=DuckDbSourceResponse)
def open_local_duckdb(
    body: DuckDbOpenLocalRequest,
    registry: RegistryDep,
    settings: SettingsDep,
) -> DuckDbSourceResponse:
    return register_local_duckdb_open(body.path, registry=registry, settings=settings)


@router.post("/pick-local", response_model=DuckDbSourceResponse)
def pick_local_duckdb(
    registry: RegistryDep,
    settings: SettingsDep,
) -> DuckDbSourceResponse:
    return pick_and_register_local_duckdb(registry=registry, settings=settings)


@router.post("/inspect", response_model=list[DuckDbRelationSummary])
def inspect_duckdb(
    body: DuckDbInspectRequest,
    registry: RegistryDep,
    settings: SettingsDep,
) -> list[DuckDbRelationSummary]:
    source_path = resolve_duckdb_source(body.source_id, registry=registry, settings=settings)
    return inspect_duckdb_relations(
        source_path,
        settings=settings,
        include_row_counts=body.include_row_counts,
    )


@router.post("/relation-count", response_model=DuckDbRelationCountResponse)
def duckdb_relation_count(
    body: DuckDbRelationCountRequest,
    registry: RegistryDep,
    settings: SettingsDep,
) -> DuckDbRelationCountResponse:
    source_path = resolve_duckdb_source(body.source_id, registry=registry, settings=settings)
    row_count = count_duckdb_relation(
        source_path,
        schema_name=body.schema_name,
        relation_name=body.name,
        settings=settings,
    )
    return DuckDbRelationCountResponse(row_count=row_count)


@router.post("/import", response_model=JobCreateResponse)
def import_duckdb(
    body: DuckDbImportRequest,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> JobCreateResponse:
    source_path = resolve_duckdb_source(body.source_id, registry=registry, settings=settings)

    def _run(job_id: str) -> dict:
        if workspace.jobs.job_cancel_requested(job_id):
            return {"datasets": [], "status": "canceled"}
        workspace.jobs.job_update(job_id, progress=0.10)

        def queue_prepare(dataset_id: str) -> str:
            return _queue_dataset_prepare_job(dataset_id, jobs, registry, workspace, settings)

        def on_progress(frac: float) -> None:
            workspace.jobs.job_update(job_id, progress=0.10 + 0.80 * min(1.0, max(0.0, frac)))

        result = import_duckdb_relations(
            source_path=source_path,
            relations=body.relations,
            registry=registry,
            settings=settings,
            queue_prepare=queue_prepare,
            on_progress=on_progress,
        )
        workspace.jobs.job_update(job_id, progress=0.95)
        return result

    job_id = jobs.submit(kind="duckdb_import", dataset_id=None, fn=_run)
    return JobCreateResponse(job_id=job_id, status=JobStatus.queued)
