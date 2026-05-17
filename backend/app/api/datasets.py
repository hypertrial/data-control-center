"""Dataset registration and inspection."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, Query, Response, UploadFile

from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import (
    ColumnProfile,
    DatasetProfile,
    DatasetSummary,
    JobCreateResponse,
    JobStatus,
    NullPctChange,
    ProfileDiffResponse,
    ProfileHistoryEntry,
    QualityIssue,
    RegisterFileRequest,
    RegisterFolderRequest,
)
from app.services.profile_diff import diff_profile_dicts
from app.services.profiler import CURRENT_PROFILE_STRUCTURE_VERSION, build_profile
from app.services.registry import SUPPORTED_EXTENSIONS
from app.services.workspace import sanitize_sql_identifier
from app.telemetry import emit, timed_event

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


def _safe_upload_filename(raw: str) -> str:
    name = Path(raw).name
    if not name or name != Path(name).name:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Invalid filename")
    if ".." in name or "/" in name or "\\" in name:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Invalid filename")
    return name


def _queue_count_job(dataset_id: str, jobs: JobsDep, registry: RegistryDep, settings: SettingsDep) -> str:
    def _count(_: str) -> dict:
        ds = registry.get(dataset_id)
        if not ds:
            return {"dataset_id": dataset_id, "row_count": None, "column_count": None}
        rows = registry.workspace.query_count(ds.view_name, settings.registration_count_timeout_seconds)
        cols = ds.column_count
        if cols is None:
            _, cols = registry.workspace.get_row_column_counts(ds.view_name)
        registry.set_counts(dataset_id, rows, cols)
        emit("dataset.count", dataset_id=dataset_id, row_count=rows, column_count=cols)
        return {"dataset_id": dataset_id, "row_count": rows, "column_count": cols}

    return jobs.submit(kind="dataset_count", dataset_id=dataset_id, fn=_count)


@router.post("/upload", response_model=list[DatasetSummary])
async def upload_datasets(
    registry: RegistryDep,
    settings: SettingsDep,
    jobs: JobsDep,
    files: Annotated[list[UploadFile], File(default_factory=list)],
):
    if not files:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="No files uploaded")
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
                        raise to_http_error(
                            status_code=400,
                            code=CODES.BAD_REQUEST,
                            message=f"File exceeds max size ({settings.upload_max_bytes_per_file} bytes): {safe}",
                        )
                    out.write(chunk)
        except Exception:
            dest.unlink(missing_ok=True)
            raise

        try:
            ds = registry.register_path(dest, compute_counts=False)
            summaries.append(registry.to_summary(ds))
            _queue_count_job(ds.dataset_id, jobs, registry, settings)
        except ValueError:
            dest.unlink(missing_ok=True)
            skipped.append(safe)

    if not summaries:
        detail = "No supported data files in upload"
        if skipped:
            detail += f" (skipped: {', '.join(skipped)})"
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message=detail)

    return summaries


@router.get("", response_model=list[DatasetSummary])
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


@router.post("/register-file", response_model=DatasetSummary)
def register_file(
    body: RegisterFileRequest,
    registry: RegistryDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> DatasetSummary:
    p = Path(body.path)
    try:
        ds = registry.register_path(p, compute_counts=False)
        _queue_count_job(ds.dataset_id, jobs, registry, settings)
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
    jobs: JobsDep,
    settings: SettingsDep,
) -> list[DatasetSummary]:
    p = Path(body.path)
    try:
        dss = registry.register_folder(p, recursive=body.recursive)
        for ds in dss:
            _queue_count_job(ds.dataset_id, jobs, registry, settings)
    except NotADirectoryError:
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Path must be a directory")
    return [registry.to_summary(ds) for ds in dss]


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


def _cached_profile(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> DatasetProfile:
    ds = registry.get(dataset_id)
    if not ds:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    cached = workspace.load_profile_cache(dataset_id)
    if cached and cached.get("structure_version") == CURRENT_PROFILE_STRUCTURE_VERSION:
        return DatasetProfile.model_validate(cached)
    prof = build_profile(ds, settings)
    workspace.save_profile_cache(dataset_id, prof.model_dump(mode="json"))
    return prof


@router.get("/{dataset_id}/profile", response_model=DatasetProfile)
def get_profile(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> DatasetProfile:
    with timed_event("dataset.profile.get", dataset_id=dataset_id):
        return _cached_profile(dataset_id, registry, workspace, settings)


@router.post("/{dataset_id}/profile/refresh", response_model=JobCreateResponse)
def refresh_profile(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> JobCreateResponse:
    ds = registry.get(dataset_id)
    if not ds:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")

    def _refresh(job_id: str) -> dict:
        if workspace.job_cancel_requested(job_id):
            return {"dataset_id": dataset_id, "status": "canceled"}
        workspace.delete_profile_cache(dataset_id)
        prof = build_profile(ds, settings)
        if workspace.job_cancel_requested(job_id):  # pragma: no cover
            return {"dataset_id": dataset_id, "status": "canceled"}
        workspace.save_profile_cache(dataset_id, prof.model_dump(mode="json"))
        return {"dataset_id": dataset_id, "quality_score": prof.quality_score}

    job_id = jobs.submit(kind="profile_refresh", dataset_id=dataset_id, fn=_refresh)
    return JobCreateResponse(job_id=job_id, status=JobStatus.queued)


@router.get("/{dataset_id}/profile/history", response_model=list[ProfileHistoryEntry])
def profile_history(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    limit: int = Query(10, ge=1, le=50),
) -> list[ProfileHistoryEntry]:
    if not registry.get(dataset_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    rows = workspace.list_profile_history(dataset_id, limit)
    return [ProfileHistoryEntry(**r) for r in rows]


@router.get("/{dataset_id}/profile/diff", response_model=ProfileDiffResponse)
def profile_diff_route(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    a: str | None = Query(None),
    b: str | None = Query(None),
) -> ProfileDiffResponse:
    if not registry.get(dataset_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    hist = workspace.list_profile_history(dataset_id, 50)

    if a and b:
        ma = workspace.get_profile_history_meta(a)
        mb = workspace.get_profile_history_meta(b)
        if not ma or ma["dataset_id"] != dataset_id:
            raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Unknown history snapshot a")
        if not mb or mb["dataset_id"] != dataset_id:
            raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Unknown history snapshot b")
        blob_a = workspace.load_profile_history_blob(a)
        blob_b = workspace.load_profile_history_blob(b)
        if not blob_a or not blob_b:
            raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Profile snapshot not found")
        diff = diff_profile_dicts(blob_a, blob_b)
        return ProfileDiffResponse(
            history_id_a=a,
            history_id_b=b,
            created_at_a=ma["created_at"],
            created_at_b=mb["created_at"],
            new_columns=diff["new_columns"],
            removed_columns=diff["removed_columns"],
            null_pct_changes=[NullPctChange(**x) for x in diff["null_pct_changes"]],
            quality_score_delta=diff["quality_score_delta"],
        )

    if len(hist) < 2:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="At least two profile snapshots are required for diff")

    id_new, id_old = hist[0]["history_id"], hist[1]["history_id"]
    blob_new = workspace.load_profile_history_blob(id_new)
    blob_old = workspace.load_profile_history_blob(id_old)
    if not blob_new or not blob_old:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Profile snapshot not found")

    diff = diff_profile_dicts(blob_old, blob_new)
    return ProfileDiffResponse(
        history_id_a=id_old,
        history_id_b=id_new,
        created_at_a=hist[1]["created_at"],
        created_at_b=hist[0]["created_at"],
        new_columns=diff["new_columns"],
        removed_columns=diff["removed_columns"],
        null_pct_changes=[NullPctChange(**x) for x in diff["null_pct_changes"]],
        quality_score_delta=diff["quality_score_delta"],
    )


@router.get("/{dataset_id}/columns", response_model=list[ColumnProfile])
def get_columns(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
):
    prof = _cached_profile(dataset_id, registry, workspace, settings)
    return prof.column_profiles


@router.get("/{dataset_id}/quality-issues", response_model=list[QualityIssue])
def get_quality(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> list[QualityIssue]:
    prof = _cached_profile(dataset_id, registry, workspace, settings)
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
    except Exception:  # noqa: BLE001
        raise to_http_error(status_code=400, code=CODES.BAD_REQUEST, message="Unable to read sample rows")
