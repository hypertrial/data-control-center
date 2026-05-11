"""Dataset registration and inspection."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.api.deps import RegistryDep, SettingsDep, WorkspaceDep
from app.models.api import (
    ColumnProfile,
    DatasetProfile,
    DatasetSummary,
    QualityIssue,
    RegisterFileRequest,
    RegisterFolderRequest,
)
from app.services.profiler import build_profile
from app.services.registry import SUPPORTED_EXTENSIONS
from app.services.workspace import sanitize_sql_identifier

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def _safe_upload_filename(raw: str) -> str:
    name = Path(raw).name
    if not name or name != Path(name).name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    if ".." in name or "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return name


@router.post("/upload", response_model=list[DatasetSummary])
async def upload_datasets(
    registry: RegistryDep,
    settings: SettingsDep,
    files: Annotated[list[UploadFile], File(default_factory=list)],
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    upload_root = settings.upload_dir
    if not upload_root.is_absolute():
        upload_root = Path.cwd() / upload_root
    upload_root.mkdir(parents=True, exist_ok=True)
    batch_dir = upload_root / uuid.uuid4().hex[:16]
    batch_dir.mkdir(parents=True)
    summaries: list[DatasetSummary] = []
    skipped: list[str] = []
    for uf in files:
        raw_name = uf.filename or ""
        safe = _safe_upload_filename(raw_name)
        ext = Path(safe).suffix.lower()
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
                    if size > settings.upload_max_bytes_per_file:
                        raise HTTPException(
                            status_code=400,
                            detail=f"File exceeds max size ({settings.upload_max_bytes_per_file} bytes): {safe}",
                        )
                    out.write(chunk)
        except HTTPException:
            dest.unlink(missing_ok=True)
            raise
        try:
            ds = registry.register_path(dest)
            summaries.append(registry.to_summary(ds))
        except ValueError:
            dest.unlink(missing_ok=True)
            skipped.append(safe)
    if not summaries:
        raise HTTPException(
            status_code=400,
            detail="No supported data files in upload "
            + (f"(skipped: {', '.join(skipped)})" if skipped else ""),
        )
    return summaries


@router.get("", response_model=list[DatasetSummary])
def list_datasets(registry: RegistryDep) -> list[DatasetSummary]:
    return [registry.to_summary(ds) for ds in registry.list_all()]


@router.post("/register-file", response_model=DatasetSummary)
def register_file(body: RegisterFileRequest, registry: RegistryDep) -> DatasetSummary:
    p = Path(body.path)
    try:
        ds = registry.register_path(p)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except (ValueError, IsADirectoryError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return registry.to_summary(ds)


@router.post("/register-folder", response_model=list[DatasetSummary])
def register_folder(body: RegisterFolderRequest, registry: RegistryDep) -> list[DatasetSummary]:
    p = Path(body.path)
    try:
        dss = registry.register_folder(p, recursive=body.recursive)
    except NotADirectoryError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return [registry.to_summary(ds) for ds in dss]


@router.get("/{dataset_id}", response_model=DatasetSummary)
def get_dataset(dataset_id: str, registry: RegistryDep) -> DatasetSummary:
    ds = registry.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return registry.to_summary(ds)


def _cached_profile(dataset_id: str, registry: RegistryDep, workspace: WorkspaceDep) -> DatasetProfile:
    ds = registry.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Dataset not found")
    cached = workspace.load_profile_cache(dataset_id)
    if cached:
        return DatasetProfile.model_validate(cached)
    prof = build_profile(ds)
    workspace.save_profile_cache(dataset_id, prof.model_dump(mode="json"))
    return prof


@router.get("/{dataset_id}/profile", response_model=DatasetProfile)
def get_profile(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
) -> DatasetProfile:
    return _cached_profile(dataset_id, registry, workspace)


@router.get("/{dataset_id}/columns", response_model=list[ColumnProfile])
def get_columns(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
):
    prof = _cached_profile(dataset_id, registry, workspace)
    return prof.column_profiles


@router.get("/{dataset_id}/quality-issues", response_model=list[QualityIssue])
def get_quality(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
) -> list[QualityIssue]:
    prof = _cached_profile(dataset_id, registry, workspace)
    return prof.quality_issues


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
        raise HTTPException(status_code=404, detail="Dataset not found")
    ps = page_size or settings.sample_default_page_size
    if ps > settings.sample_max_page_size:
        raise HTTPException(
            status_code=400,
            detail=f"page_size must be <= {settings.sample_max_page_size}",
        )
    offset = (page - 1) * ps
    con = registry.workspace.connection
    view = ds.view_name
    safe_view = sanitize_sql_identifier(view)
    try:
        res = con.execute(f"SELECT * FROM {safe_view} LIMIT {int(ps)} OFFSET {int(offset)}")
        cols_meta = res.description or []
        colnames = [c[0] for c in cols_meta]
        fetched = res.fetchall()
        rows = [{colnames[i]: row[i] for i in range(len(colnames))} for row in fetched]
        return {
            "page": page,
            "page_size": ps,
            "row_count": len(rows),
            "columns": colnames,
            "rows": rows,
        }
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(e)) from e
