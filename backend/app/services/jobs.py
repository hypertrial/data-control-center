"""In-process job runner for long-running profile/count work."""

from __future__ import annotations

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from app.errors import CODES
from app.services.job_errors import sanitized_job_error_detail
from app.services.workspace import Workspace
from app.telemetry import emit

JobFn = Callable[[str], dict]


def _redact_path_fragments(workspace_path: Path) -> tuple[str, ...]:
    resolved = workspace_path.resolve()
    parent = resolved.parent
    return (
        str(resolved),
        str(workspace_path),
        str(parent),
    )


class JobService:
    def __init__(
        self,
        workspace: Workspace,
        max_workers: int = 2,
        *,
        redact_secrets: tuple[str, ...] = (),
    ) -> None:
        self._workspace = workspace
        self._redact_paths = _redact_path_fragments(workspace.path)
        self._redact_secrets = redact_secrets
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="dcc-job")
        self._lock = threading.Lock()

    def submit(self, *, kind: str, dataset_id: str | None, fn: JobFn) -> str:
        job_id = uuid.uuid4().hex
        self._workspace.jobs.job_insert(job_id, kind, dataset_id, "queued")

        def _run() -> None:
            self._workspace.jobs.job_update(job_id, status="running", progress=0.05)
            try:
                result = fn(job_id)
                if self._workspace.jobs.job_cancel_requested(job_id):
                    self._workspace.jobs.job_update(
                        job_id,
                        status="canceled",
                        progress=1.0,
                        finished=True,
                    )
                    emit("job.complete", job_id=job_id, kind=kind, status="canceled")
                    return

                self._workspace.jobs.job_update(
                    job_id,
                    status="completed",
                    progress=1.0,
                    result_json=result,
                    finished=True,
                )
                emit("job.complete", job_id=job_id, kind=kind, status="completed")
            except Exception as exc:  # noqa: BLE001
                if self._workspace.jobs.job_cancel_requested(job_id):
                    self._workspace.jobs.job_update(
                        job_id,
                        status="canceled",
                        progress=1.0,
                        finished=True,
                    )
                    emit("job.complete", job_id=job_id, kind=kind, status="canceled")
                    return

                error_message = sanitized_job_error_detail(
                    exc,
                    redact_paths=self._redact_paths,
                    redact_secrets=self._redact_secrets,
                )
                self._workspace.jobs.job_update(
                    job_id,
                    status="failed",
                    progress=1.0,
                    error_code=CODES.JOB_FAILED,
                    error_message=error_message,
                    finished=True,
                )
                emit(
                    "job.complete",
                    job_id=job_id,
                    kind=kind,
                    status="failed",
                    error_type=type(exc).__name__,
                    error_message_summary=error_message,
                )

        self._executor.submit(_run)
        emit("job.submitted", job_id=job_id, kind=kind, dataset_id=dataset_id)
        return job_id

    def request_cancel(self, job_id: str) -> bool:
        ok = self._workspace.jobs.job_request_cancel(job_id)
        if ok:
            emit("job.cancel_requested", job_id=job_id)
        return ok

    def shutdown(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=False)
