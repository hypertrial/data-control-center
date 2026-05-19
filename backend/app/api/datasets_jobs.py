"""Shared dataset background job helpers."""

from __future__ import annotations

from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.services.profiler import build_profile
from app.telemetry import emit


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


def _profile_refresh_fn(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
):
    def _refresh(job_id: str) -> dict:
        if workspace.jobs.job_cancel_requested(job_id):
            return {"dataset_id": dataset_id, "status": "canceled"}
        ds = registry.get(dataset_id)
        if not ds:
            return {"dataset_id": dataset_id, "status": "missing"}
        workspace.profiles.delete_profile_cache(dataset_id)
        prof = build_profile(ds, settings)
        if workspace.jobs.job_cancel_requested(job_id):  # pragma: no cover
            return {"dataset_id": dataset_id, "status": "canceled"}
        workspace.profiles.save_profile_cache(dataset_id, prof.model_dump(mode="json"))
        return {"dataset_id": dataset_id, "quality_score": prof.quality_score}

    return _refresh


def _queue_profile_job(
    dataset_id: str,
    jobs: JobsDep,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> str:
    existing = workspace.jobs.job_find_active_for_dataset(dataset_id, "profile_refresh")
    if existing:
        return existing
    return jobs.submit(
        kind="profile_refresh",
        dataset_id=dataset_id,
        fn=_profile_refresh_fn(dataset_id, registry, workspace, settings),
    )
