"""Polling job API."""

from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import JobsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import JobCreateResponse, JobDetail, JobSummary, JobStatus

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobSummary])
def list_jobs(
    workspace: WorkspaceDep,
    limit: int = Query(default=100, ge=1, le=500),
    status: str | None = Query(default=None),
) -> list[JobSummary]:
    rows = workspace.jobs.jobs_list(limit=limit, status=status)
    return [JobSummary.model_validate(r) for r in rows]


@router.get("/{job_id}", response_model=JobDetail)
def get_job(job_id: str, workspace: WorkspaceDep) -> JobDetail:
    row = workspace.jobs.job_get(job_id)
    if not row:
        raise to_http_error(status_code=404, code=CODES.JOB_NOT_FOUND, message="Job not found")
    return JobDetail.model_validate(row)


@router.post("/{job_id}/cancel", response_model=JobCreateResponse)
def cancel_job(job_id: str, jobs: JobsDep, workspace: WorkspaceDep) -> JobCreateResponse:
    if not jobs.request_cancel(job_id):
        raise to_http_error(status_code=404, code=CODES.JOB_NOT_FOUND, message="Job not found")
    row = workspace.jobs.job_get(job_id)
    status = JobStatus(row["status"] if row else "queued")
    return JobCreateResponse(job_id=job_id, status=status)
