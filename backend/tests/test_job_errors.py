"""Tests for sanitized job error messages."""

from __future__ import annotations

from app.services.job_errors import sanitized_job_error_detail


def test_sanitized_job_error_detail_basic() -> None:
    exc = RuntimeError("something broke")
    out = sanitized_job_error_detail(exc)
    assert out == "RuntimeError: something broke"
    assert len(out) <= 240


def test_sanitized_job_error_detail_redacts_paths_and_secrets() -> None:
    exc = RuntimeError("/tmp/w.duckdb failed token-secret-here")
    out = sanitized_job_error_detail(
        exc,
        redact_paths=("/tmp/w.duckdb", "/tmp"),
        redact_secrets=("token-secret-here",),
    )
    assert "/tmp" not in out
    assert "token-secret-here" not in out
    assert "<path>" in out
    assert "<redacted>" in out


def test_sanitized_job_error_detail_empty_message() -> None:
    exc = RuntimeError()
    assert sanitized_job_error_detail(exc) == "RuntimeError"


def test_sanitized_job_error_detail_collapses_whitespace_and_caps_length() -> None:
    exc = ValueError("a\n\n" + "x" * 300)
    out = sanitized_job_error_detail(exc)
    assert "\n" not in out
    assert len(out) == 240
