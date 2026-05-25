"""Shared dataset background job helpers."""

from __future__ import annotations

from collections.abc import Callable

from app.api.deps import JobsDep, RegistryDep, SettingsDep, WorkspaceDep
from app.services.profiler import build_profile
from app.services.profiler.budget import ProfileTimeBudget
from app.services.registry import RegisteredDataset
from app.services.workspace import Workspace
from app.telemetry import emit


def _fast_row_and_column_count(
    ds: RegisteredDataset,
    settings: SettingsDep,
    workspace: WorkspaceDep,
) -> tuple[int | None, int | None]:
    rows: int | None = None
    if ds.format == "parquet" and settings.profile_use_parquet_metadata_count:
        rows = workspace.query_parquet_row_count(ds.source_path)
    if rows is None:
        rows = workspace.query_count(ds.view_name, settings.registration_count_timeout_seconds)
    cols = ds.column_count
    if cols is None:
        cols = workspace.query_column_count(ds.view_name)
    return rows, cols


def _dataset_prepare_fn(
    dataset_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> Callable[[str], dict]:
    def _run(job_id: str) -> dict:
        if workspace.jobs.job_cancel_requested(job_id):
            return {"dataset_id": dataset_id, "status": "canceled"}

        workspace.jobs.job_update(job_id, progress=0.10)
        ds = registry.get(dataset_id)
        if not ds:
            return {"dataset_id": dataset_id, "status": "missing"}

        workspace.profiles.delete_profile_cache(dataset_id)

        if workspace.jobs.job_cancel_requested(job_id):
            return {"dataset_id": dataset_id, "status": "canceled"}

        workspace.jobs.job_update(job_id, progress=0.20)
        rows, cols = _fast_row_and_column_count(ds, settings, workspace)
        registry.set_counts(dataset_id, rows, cols)
        emit("dataset.count", dataset_id=dataset_id, row_count=rows, column_count=cols)

        def on_progress(frac: float) -> None:
            workspace.jobs.job_update(
                job_id,
                progress=0.25 + 0.60 * min(1.0, max(0.0, frac)),
            )

        budget = ProfileTimeBudget(settings, ds.file_size_bytes)
        prof = build_profile(
            ds,
            settings,
            workspace,
            on_progress=on_progress,
            budget=budget,
            cancel_requested=lambda: workspace.jobs.job_cancel_requested(job_id),
        )

        if workspace.jobs.job_cancel_requested(job_id):
            return {"dataset_id": dataset_id, "status": "canceled"}

        workspace.jobs.job_update(job_id, progress=0.95)
        workspace.profiles.save_profile_cache(dataset_id, prof.model_dump(mode="json"))
        registry.set_counts(dataset_id, prof.rows, prof.columns)

        return {"dataset_id": dataset_id, "quality_score": prof.quality_score}

    return _run


def _active_prepare_job_id(workspace: Workspace, dataset_id: str) -> str | None:
    return workspace.jobs.job_find_any_active_for_dataset(dataset_id)


def _queue_dataset_prepare_job(
    dataset_id: str,
    jobs: JobsDep,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> str:
    existing = _active_prepare_job_id(workspace, dataset_id)
    if existing:
        return existing
    return jobs.submit(
        kind="dataset_prepare",
        dataset_id=dataset_id,
        fn=_dataset_prepare_fn(dataset_id, registry, workspace, settings),
    )


def _queue_profile_job(
    dataset_id: str,
    jobs: JobsDep,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> str:
    existing = _active_prepare_job_id(workspace, dataset_id)
    if existing:
        return existing
    return jobs.submit(
        kind="profile_refresh",
        dataset_id=dataset_id,
        fn=_dataset_prepare_fn(dataset_id, registry, workspace, settings),
    )
