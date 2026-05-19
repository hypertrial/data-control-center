"""Jobs API/service and error handler coverage."""

from __future__ import annotations

import asyncio
import threading
import time
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.errors import AppError, CODES, app_error_handler, http_error_handler, unhandled_error_handler
from app.services.jobs import JobService
from app.services.workspace import Workspace


def _settings(tmp_path: Path, *, local_api_token: str | None = "test-local-token"):
    from app.config import Settings

    return Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
        local_api_token=local_api_token,
    )


def _wait_for_workspace_job(ws: Workspace, job_id: str, *, timeout: float = 2.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = ws.jobs.job_get(job_id)
        if row and row["status"] in {"completed", "failed", "canceled"}:
            return row
        time.sleep(0.01)
    raise AssertionError(f"job {job_id} did not finish")


def test_job_service_completed_and_request_cancel_missing(tmp_path: Path) -> None:
    ws = Workspace(_settings(tmp_path))
    svc = JobService(ws, max_workers=1)
    try:
        job_id = svc.submit(kind="dataset_count", dataset_id="ds_001", fn=lambda _job_id: {"ok": True})
        row = _wait_for_workspace_job(ws, job_id)
        assert row["status"] == "completed"
        assert row["result"] == {"ok": True}
        assert not svc.request_cancel("missing")
    finally:
        ws.close()


def test_job_service_failed_path(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    token = settings.local_api_token or ""
    db_path = str(ws.path)
    svc = JobService(ws, max_workers=1, redact_secrets=(token,) if token else ())
    try:
        def boom(_job_id: str) -> dict:
            raise RuntimeError(f"failed at {db_path} with {token}")

        job_id = svc.submit(kind="profile_refresh", dataset_id="ds_001", fn=boom)
        row = _wait_for_workspace_job(ws, job_id)
        assert row["status"] == "failed"
        assert row["error_code"] == CODES.JOB_FAILED
        msg = row["error_message"]
        assert msg.startswith("RuntimeError:")
        assert db_path not in msg
        assert token not in msg
        assert "<path>" in msg
        assert "<redacted>" in msg
        assert len(msg) <= 240
    finally:
        ws.close()


def test_job_service_cancel_after_success_and_error(tmp_path: Path) -> None:
    ws = Workspace(_settings(tmp_path))
    svc = JobService(ws, max_workers=1)
    gate = threading.Event()
    release = threading.Event()
    job_ids: list[str] = []

    def cancel_after_return(job_id: str) -> dict:
        job_ids.append(job_id)
        gate.set()
        release.wait(timeout=1.0)
        svc.request_cancel(job_id)
        return {"ok": True}

    try:
        job_id = svc.submit(kind="profile_refresh", dataset_id="ds_001", fn=cancel_after_return)
        assert gate.wait(timeout=1.0)
        release.set()
        row = _wait_for_workspace_job(ws, job_id)
        assert row["status"] == "canceled"

        gate.clear()
        release.clear()

        def cancel_then_raise(job_id: str) -> dict:
            job_ids.append(job_id)
            gate.set()
            release.wait(timeout=1.0)
            svc.request_cancel(job_id)
            raise RuntimeError("boom")

        job_id2 = svc.submit(kind="profile_refresh", dataset_id="ds_001", fn=cancel_then_raise)
        assert gate.wait(timeout=1.0)
        release.set()
        row2 = _wait_for_workspace_job(ws, job_id2)
        assert row2["status"] == "canceled"
    finally:
        ws.close()


def test_jobs_api_list_get_and_cancel(client) -> None:
    ws = client.app.state.workspace
    ws.jobs.job_insert("j1", "profile_refresh", "ds_001", "queued")

    listing = client.get("/api/jobs")
    assert listing.status_code == 200
    assert any(job["job_id"] == "j1" for job in listing.json())

    filtered = client.get("/api/jobs?status=queued")
    assert filtered.status_code == 200
    assert [job["job_id"] for job in filtered.json()] == ["j1"]

    detail = client.get("/api/jobs/j1")
    assert detail.status_code == 200
    assert detail.json()["job_id"] == "j1"

    assert client.get("/api/jobs/missing").status_code == 404

    canceled = client.post("/api/jobs/j1/cancel")
    assert canceled.status_code == 200
    assert canceled.json()["status"] == "queued"

    assert client.post("/api/jobs/missing/cancel").status_code == 404


def test_app_error_handler() -> None:
    res = asyncio.run(
        app_error_handler(
            None,  # type: ignore[arg-type]
            AppError(status_code=418, code="TEAPOT", message="short", details={"x": 1}),
        )
    )
    assert res.status_code == 418
    assert b"TEAPOT" in res.body


def test_http_error_handler_string_and_default_detail() -> None:
    res1 = asyncio.run(http_error_handler(None, HTTPException(status_code=400, detail="bad")))  # type: ignore[arg-type]
    assert res1.status_code == 400
    assert b"bad" in res1.body

    res2 = asyncio.run(http_error_handler(None, HTTPException(status_code=500, detail=["x"])))  # type: ignore[arg-type]
    assert res2.status_code == 500
    assert b"Internal server error" in res2.body


def test_unhandled_error_handler(monkeypatch: pytest.MonkeyPatch) -> None:
    logged: list[str] = []

    def fake_exception(msg: str, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        logged.append(msg % args)

    monkeypatch.setattr("app.errors.logger.exception", fake_exception)
    res = asyncio.run(unhandled_error_handler(None, RuntimeError("boom")))  # type: ignore[arg-type]
    assert res.status_code == 500
    assert logged and "Unhandled API error" in logged[0]
