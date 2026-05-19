"""Dataset profile cache, refresh, and derived column/quality routes."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.datasets_jobs import _queue_profile_job
from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import (
    ColumnProfile,
    DatasetProfile,
    JobCreateResponse,
    JobStatus,
    NullPctChange,
    ProfileDiffResponse,
    ProfileHistoryEntry,
    QualityIssue,
)
from app.services.profile_diff import diff_profile_dicts
from app.services.profiler import CURRENT_PROFILE_STRUCTURE_VERSION
from app.telemetry import timed_event

router = APIRouter()

__all__ = ["router"]


def _cached_profile_readonly(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> DatasetProfile:
    if not registry.get(dataset_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    cached = workspace.profiles.load_profile_cache(dataset_id)
    if cached and cached.get("structure_version") == CURRENT_PROFILE_STRUCTURE_VERSION:
        return DatasetProfile.model_validate(cached)
    if cached:
        workspace.profiles.delete_profile_cache(dataset_id)
    job_id = _queue_profile_job(dataset_id, jobs, registry, workspace, settings)
    raise to_http_error(
        status_code=404,
        code=CODES.PROFILE_NOT_READY,
        message="Profile is not ready yet. Wait for the profiling job to finish.",
        details={"dataset_id": dataset_id, "job_id": job_id},
    )


@router.get("/{dataset_id}/profile", response_model=DatasetProfile)
def get_profile(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> DatasetProfile:
    with timed_event("dataset.profile.get", dataset_id=dataset_id):
        return _cached_profile_readonly(dataset_id, registry, workspace, jobs, settings)


@router.post("/{dataset_id}/profile/refresh", response_model=JobCreateResponse)
def refresh_profile(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> JobCreateResponse:
    if not registry.get(dataset_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")

    job_id = _queue_profile_job(dataset_id, jobs, registry, workspace, settings)
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
    rows = workspace.profiles.list_profile_history(dataset_id, limit)
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
    hist = workspace.profiles.list_profile_history(dataset_id, 50)

    if a and b:
        ma = workspace.profiles.get_profile_history_meta(a)
        mb = workspace.profiles.get_profile_history_meta(b)
        if not ma or ma["dataset_id"] != dataset_id:
            raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Unknown history snapshot a")
        if not mb or mb["dataset_id"] != dataset_id:
            raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Unknown history snapshot b")
        blob_a = workspace.profiles.load_profile_history_blob(a)
        blob_b = workspace.profiles.load_profile_history_blob(b)
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
    blob_new = workspace.profiles.load_profile_history_blob(id_new)
    blob_old = workspace.profiles.load_profile_history_blob(id_old)
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
    jobs: JobsDep,
    settings: SettingsDep,
):
    prof = _cached_profile_readonly(dataset_id, registry, workspace, jobs, settings)
    return prof.column_profiles


@router.get("/{dataset_id}/quality-issues", response_model=list[QualityIssue])
def get_quality(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> list[QualityIssue]:
    prof = _cached_profile_readonly(dataset_id, registry, workspace, jobs, settings)
    return prof.quality_issues
