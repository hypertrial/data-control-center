"""DuckDB relation inspection and snapshot import routes."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.datasets_jobs import _queue_dataset_prepare_job
from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.models.api import (
    DuckDbImportRequest,
    DuckDbInspectRequest,
    DuckDbRelationSummary,
    JobCreateResponse,
    JobStatus,
)
from app.services.duckdb_import import (
    import_duckdb_relations,
    inspect_duckdb_relations,
    resolve_duckdb_source_path,
)

router = APIRouter(prefix="/duckdb")


@router.post("/inspect", response_model=list[DuckDbRelationSummary])
def inspect_duckdb(
    body: DuckDbInspectRequest,
    registry: RegistryDep,
    settings: SettingsDep,
) -> list[DuckDbRelationSummary]:
    source_path = resolve_duckdb_source_path(body.path, registry=registry, settings=settings)
    return inspect_duckdb_relations(source_path, settings=settings)


@router.post("/import", response_model=JobCreateResponse)
def import_duckdb(
    body: DuckDbImportRequest,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    jobs: JobsDep,
    settings: SettingsDep,
) -> JobCreateResponse:
    source_path = resolve_duckdb_source_path(body.path, registry=registry, settings=settings)

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
