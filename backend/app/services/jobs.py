"""In-process job runner for long-running profile/count work."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from app.errors import CODES
from app.services.workspace import Workspace
from app.telemetry import emit

JobFn = Callable[[str], dict]


class JobService:
    def __init__(self, workspace: Workspace, max_workers: int = 2) -> None:
        self._workspace = workspace
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="dcc-job")
        self._lock = threading.Lock()

    def submit(self, *, kind: str, dataset_id: str | None, fn: JobFn) -> str:
        job_id = uuid.uuid4().hex
        self._workspace.job_insert(job_id, kind, dataset_id, "queued")

        def _run() -> None:
            self._workspace.job_update(job_id, status="running", progress=0.05)
            try:
                result = fn(job_id)
                if self._workspace.job_cancel_requested(job_id):
                    self._workspace.job_update(
                        job_id,
                        status="canceled",
                        progress=1.0,
                        finished=True,
                    )
                    emit("job.complete", job_id=job_id, kind=kind, status="canceled")
                    return

                self._workspace.job_update(
                    job_id,
                    status="completed",
                    progress=1.0,
                    result_json=result,
                    finished=True,
                )
                emit("job.complete", job_id=job_id, kind=kind, status="completed")
            except Exception as exc:  # noqa: BLE001
                if self._workspace.job_cancel_requested(job_id):
                    self._workspace.job_update(
                        job_id,
                        status="canceled",
                        progress=1.0,
                        finished=True,
                    )
                    emit("job.complete", job_id=job_id, kind=kind, status="canceled")
                    return

                self._workspace.job_update(
                    job_id,
                    status="failed",
                    progress=1.0,
                    error_code=CODES.JOB_FAILED,
                    error_message="Job failed.",
                    finished=True,
                )
                emit(
                    "job.complete",
                    job_id=job_id,
                    kind=kind,
                    status="failed",
                    error_type=type(exc).__name__,
                )

        self._executor.submit(_run)
        emit("job.submitted", job_id=job_id, kind=kind, dataset_id=dataset_id)
        return job_id

    def request_cancel(self, job_id: str) -> bool:
        ok = self._workspace.job_request_cancel(job_id)
        if ok:
            emit("job.cancel_requested", job_id=job_id)
        return ok

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)
