"""Unified dataset_prepare background job."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.api.datasets_jobs import _fast_row_and_column_count, _queue_dataset_prepare_job
from app.config import Settings
from app.services.registry import RegisteredDataset
from app.services.workspace import Workspace


def _settings(tmp_path: Path) -> Settings:
    return Settings(workspace_db_path=tmp_path / "ws.duckdb")


def test_queue_dataset_prepare_dedupes_active_job(tmp_path: Path) -> None:
    ws = Workspace(_settings(tmp_path))
    registry = MagicMock()
    registry.get.return_value = None
    submitted: list[str] = []

    class Jobs:
        def submit(self, *, kind, dataset_id, fn):  # noqa: ANN001
            submitted.append(kind)
            ws.jobs.job_insert("j-active", kind, dataset_id, "running")
            return "j-active"

    try:
        ws.jobs.job_insert("j-active", "dataset_prepare", "ds_1", "running")
        job_id = _queue_dataset_prepare_job("ds_1", Jobs(), registry, ws, _settings(tmp_path))
        assert job_id == "j-active"
        assert submitted == []
    finally:
        ws.close()


def test_fast_row_count_prefers_parquet_metadata(tmp_path: Path) -> None:
    pq = tmp_path / "n.parquet"
    import duckdb

    con = duckdb.connect()
    con.execute(f"COPY (SELECT * FROM range(7)) TO '{pq}' (FORMAT PARQUET)")
    con.close()

    ws = Workspace(_settings(tmp_path))
    ws.register_file_view("v_pq", pq, "parquet")
    ds = RegisteredDataset(
        dataset_id="ds_pq",
        source_path=pq,
        source_label=pq.name,
        view_name="v_pq",
        format="parquet",
        row_count=None,
        column_count=1,
        file_size_bytes=pq.stat().st_size,
    )
    settings = Settings(
        workspace_db_path=tmp_path / "ws.duckdb",
        profile_use_parquet_metadata_count=True,
    )
    try:
        rows, cols = _fast_row_and_column_count(ds, settings, ws)
        assert rows == 7
        assert cols == 1
    finally:
        ws.close()


def test_prepare_fn_returns_canceled_after_profile(monkeypatch) -> None:
    from app.api.datasets_jobs import _dataset_prepare_fn
    from app.models.api import DatasetProfile, MetricScope

    registry = MagicMock()
    ds = MagicMock()
    ds.dataset_id = "ds_x"
    ds.file_size_bytes = 1
    registry.get.return_value = ds

    workspace = MagicMock()
    cancel_checks = {"n": 0}

    def cancel_requested(_job_id: str) -> bool:
        cancel_checks["n"] += 1
        return cancel_checks["n"] >= 3

    workspace.jobs.job_cancel_requested.side_effect = cancel_requested

    profile = DatasetProfile(
        dataset_id="ds_x",
        name="n",
        rows=1,
        columns=1,
        quality_score=90.0,
        grain_key_scope=MetricScope.full,
    )
    monkeypatch.setattr("app.api.datasets_jobs.build_profile", lambda *a, **k: profile)
    monkeypatch.setattr("app.api.datasets_jobs._fast_row_and_column_count", lambda *a, **k: (1, 1))

    fn = _dataset_prepare_fn("ds_x", registry, workspace, Settings())
    assert fn("job_x") == {"dataset_id": "ds_x", "status": "canceled"}


def test_prepare_fn_passes_cancellation_callback_into_profile(monkeypatch) -> None:
    from app.api.datasets_jobs import _dataset_prepare_fn
    from app.services.profiler.builder import ProfileBuildCancelled

    registry = MagicMock()
    ds = MagicMock()
    ds.dataset_id = "ds_x"
    ds.file_size_bytes = 1
    registry.get.return_value = ds

    workspace = MagicMock()
    workspace.jobs.job_cancel_requested.side_effect = [False, False, True]
    monkeypatch.setattr("app.api.datasets_jobs._fast_row_and_column_count", lambda *a, **k: (1, 1))

    def fake_build_profile(*_args, cancel_requested=None, **_kwargs):  # noqa: ANN001
        assert cancel_requested is not None
        assert cancel_requested()
        raise ProfileBuildCancelled("Profile build canceled.")

    monkeypatch.setattr("app.api.datasets_jobs.build_profile", fake_build_profile)
    fn = _dataset_prepare_fn("ds_x", registry, workspace, Settings())
    with pytest.raises(ProfileBuildCancelled):
        fn("job_x")


def test_profile_cancel_check_raises() -> None:
    from app.services.profiler.builder import ProfileBuildCancelled, _check_cancelled

    with pytest.raises(ProfileBuildCancelled):
        _check_cancelled(lambda: True)
