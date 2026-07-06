"""Full-table profiler metric helper branches."""

from __future__ import annotations

import pytest

from app.config import Settings
from app.models.api import GrainKeyCandidate
from app.services.profiler import full_metrics
from app.services.profiler.builder import _sample_duplicate_row_pct


class _Con:
    def __init__(self, exc: Exception | None = None) -> None:
        self.exc = exc

    def execute(self, _sql: str):
        if self.exc is not None:
            raise self.exc
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []


class _ReadCtx:
    def __init__(self, con: _Con) -> None:
        self.con = con

    def __enter__(self):
        return self.con

    def __exit__(self, *_args):
        return False


class _Workspace:
    def __init__(self, con: _Con | None = None) -> None:
        self.con = con or _Con()

    def read_db(self):
        return _ReadCtx(self.con)


def test_sample_duplicate_pct_empty_sample_branch() -> None:
    assert _sample_duplicate_row_pct(0, 1, []) is None


def test_reader_execute_budget_exhaustion_branches() -> None:
    reader = full_metrics._FullMetricReader(_Workspace(), Settings(), "valid_view", 1)
    reader.deadline = 0
    with pytest.raises(TimeoutError):
        reader._execute_one("SELECT 1")
    with pytest.raises(TimeoutError):
        reader._execute_all("SELECT 1")


def test_reader_empty_duplicate_and_empty_grain_branches() -> None:
    reader = full_metrics._FullMetricReader(_Workspace(), Settings(), "valid_view", 0)
    assert reader.duplicate_row_pct(["a"]) is None
    assert reader.duplicate_row_pct([]) is None
    assert reader.validate_grain_candidates([GrainKeyCandidate(columns=[])]) == []
    reader = full_metrics._FullMetricReader(_Workspace(), Settings(), "valid_view", 1)
    assert reader.validate_grain_candidates([GrainKeyCandidate(columns=[])]) == []


def test_reader_none_rows_branches(monkeypatch: pytest.MonkeyPatch) -> None:
    reader = full_metrics._FullMetricReader(_Workspace(), Settings(), "valid_view", 10)
    monkeypatch.setattr(reader, "_execute_one", lambda _sql: None)
    assert reader.duplicate_row_pct(["a"]) is None
    with pytest.raises(RuntimeError, match="returned no row"):
        reader.column_metric("a", full_metrics.pl.Utf8)


def test_collect_full_profile_metrics_top_value_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    def bad_top_values(self, _name: str, limit: int = 8):  # noqa: ARG001
        raise RuntimeError("top")

    monkeypatch.setattr(full_metrics._FullMetricReader, "top_values", bad_top_values)
    out = full_metrics.collect_full_profile_metrics(
        _Workspace(),
        Settings(),
        "valid_view",
        names=[],
        dtypes=[],
        row_count=1,
        grain_candidates=[],
        top_value_columns=["c"],
        include_duplicate=False,
        include_columns=False,
    )
    assert any("top-value" in warning for warning in out.warnings)
