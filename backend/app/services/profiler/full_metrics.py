"""Best-effort full-table profile metrics from registered DuckDB views."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import polars as pl

from app.config import Settings
from app.models.api import GrainKeyCandidate, StructureConfidence
from app.services.duckdb_timeout import apply_statement_timeout
from app.services.workspace import Workspace, sanitize_sql_identifier


@dataclass
class FullColumnMetric:
    unique_count: int
    min_value: str | None = None
    max_value: str | None = None
    top_values: list[dict[str, Any]] | None = None


@dataclass
class FullProfileMetrics:
    duplicate_row_pct: float | None = None
    column_metrics: dict[str, FullColumnMetric] = field(default_factory=dict)
    grain_candidates: list[GrainKeyCandidate] | None = None
    warnings: list[str] = field(default_factory=list)


def _quote_ident(raw: str) -> str:
    return '"' + raw.replace('"', '""') + '"'


def _confidence_from_ratio(
    ratio: float,
    high_threshold: float,
    medium_threshold: float,
) -> StructureConfidence:
    if ratio >= high_threshold:
        return StructureConfidence.high
    if ratio >= medium_threshold:
        return StructureConfidence.medium
    return StructureConfidence.low


class _FullMetricReader:
    def __init__(
        self,
        workspace: Workspace,
        settings: Settings,
        view_name: str,
        row_count: int,
        *,
        budget_deadline: float | None = None,
    ) -> None:
        self.workspace = workspace
        self.settings = settings
        self.view_name = sanitize_sql_identifier(view_name)
        self.row_count = row_count
        query_deadline = time.monotonic() + settings.profile_full_metrics_timeout_seconds
        if budget_deadline is not None:
            query_deadline = min(query_deadline, budget_deadline)
        self.deadline = query_deadline
        self.warnings: list[str] = []

    def remaining(self) -> float:
        return max(0.0, self.deadline - time.monotonic())

    def _execute_one(self, sql: str):
        remaining = self.remaining()
        if remaining <= 0:
            raise TimeoutError("full profile metric budget exhausted")
        with self.workspace.read_db() as con:
            con.execute("PRAGMA disable_progress_bar")
            apply_statement_timeout(con, min(self.settings.profile_full_metrics_timeout_seconds, remaining))
            return con.execute(sql).fetchone()

    def _execute_all(self, sql: str):
        remaining = self.remaining()
        if remaining <= 0:
            raise TimeoutError("full profile metric budget exhausted")
        with self.workspace.read_db() as con:
            con.execute("PRAGMA disable_progress_bar")
            apply_statement_timeout(con, min(self.settings.profile_full_metrics_timeout_seconds, remaining))
            return con.execute(sql).fetchall()

    def duplicate_row_pct(self, names: list[str]) -> float | None:
        if self.row_count <= 0 or not names:
            return None
        cols = ", ".join(_quote_ident(n) for n in names)
        sql = (
            "SELECT COALESCE(SUM(n), 0) AS duplicate_rows "
            f"FROM (SELECT COUNT(*) AS n FROM {self.view_name} GROUP BY {cols} HAVING COUNT(*) > 1)"
        )
        row = self._execute_one(sql)
        if not row:
            return None
        return round(int(row[0]) / self.row_count * 100, 4)

    def column_metric(self, name: str, dtype: pl.DataType) -> FullColumnMetric:
        q = _quote_ident(name)
        unique_expr = f'COUNT(DISTINCT {q}) + CASE WHEN COUNT(*) FILTER (WHERE {q} IS NULL) > 0 THEN 1 ELSE 0 END'
        select_exprs = [f"{unique_expr} AS unique_count"]
        if dtype.is_numeric() or dtype in (pl.Date, pl.Datetime, pl.Time):
            select_exprs.extend([f"MIN({q}) AS min_value", f"MAX({q}) AS max_value"])
        sql = f"SELECT {', '.join(select_exprs)} FROM {self.view_name}"
        row = self._execute_one(sql)
        if not row:
            raise RuntimeError("full column metric query returned no row")
        min_value = str(row[1]) if len(row) > 1 and row[1] is not None else None
        max_value = str(row[2]) if len(row) > 2 and row[2] is not None else None
        return FullColumnMetric(unique_count=int(row[0]), min_value=min_value, max_value=max_value)

    def top_values(self, name: str, limit: int = 8) -> list[dict[str, Any]]:
        q = _quote_ident(name)
        rows = self._execute_all(
            f"SELECT {q} AS value, COUNT(*) AS n "
            f"FROM {self.view_name} "
            "GROUP BY 1 "
            f"ORDER BY n DESC, CAST({q} AS VARCHAR) ASC NULLS LAST "
            f"LIMIT {int(limit)}"
        )
        return [{"value": row[0], "count": int(row[1])} for row in rows]

    def validate_grain_candidates(
        self,
        candidates: list[GrainKeyCandidate],
    ) -> list[GrainKeyCandidate]:
        if self.row_count <= 0:
            return []
        out: list[GrainKeyCandidate] = []
        for candidate in candidates:
            if not candidate.columns:
                continue
            cols = ", ".join(_quote_ident(c) for c in candidate.columns)
            row = self._execute_one(
                f"SELECT COUNT(*) AS d FROM (SELECT {cols} FROM {self.view_name} GROUP BY {cols})"
            )
            distinct = int(row[0]) if row else 0
            ratio = distinct / self.row_count
            conf = _confidence_from_ratio(
                ratio,
                self.settings.profile_structure_high_confidence_threshold,
                self.settings.profile_structure_medium_confidence_threshold,
            )
            if conf != StructureConfidence.low:
                out.append(
                    GrainKeyCandidate(
                        columns=list(candidate.columns),
                        uniqueness_ratio=round(ratio, 6),
                        confidence=conf,
                        rank=1,
                    )
                )
        conf_rank = {
            StructureConfidence.high: 3,
            StructureConfidence.medium: 2,
            StructureConfidence.low: 1,
        }
        out.sort(
            key=lambda x: (conf_rank.get(x.confidence, 1), x.uniqueness_ratio, -len(x.columns)),
            reverse=True,
        )
        for idx, candidate in enumerate(out, start=1):
            candidate.rank = idx
        return out


def collect_full_profile_metrics(
    workspace: Workspace,
    settings: Settings,
    view_name: str,
    names: list[str],
    dtypes: list[pl.DataType],
    row_count: int,
    grain_candidates: list[GrainKeyCandidate],
    top_value_columns: list[str],
    *,
    include_duplicate: bool = True,
    include_columns: bool = True,
    budget_deadline: float | None = None,
) -> FullProfileMetrics:
    reader = _FullMetricReader(
        workspace,
        settings,
        view_name,
        row_count,
        budget_deadline=budget_deadline,
    )
    metrics = FullProfileMetrics()

    if include_duplicate:
        try:
            metrics.duplicate_row_pct = reader.duplicate_row_pct(names)
        except Exception:  # noqa: BLE001
            metrics.warnings.append("Full duplicate-row metric was unavailable; sample duplicate metric is shown.")

    if include_columns:
        for name, dtype in zip(names, dtypes, strict=False):
            try:
                metrics.column_metrics[name] = reader.column_metric(name, dtype)
            except Exception:  # noqa: BLE001
                metrics.warnings.append("Some full column metrics were unavailable; sample metrics are shown where needed.")
                break

    for name in top_value_columns:
        metric = metrics.column_metrics.setdefault(name, FullColumnMetric(unique_count=0))
        try:
            metric.top_values = reader.top_values(name)
        except Exception:  # noqa: BLE001
            metrics.warnings.append("Some full top-value metrics were unavailable; sample top values are shown where needed.")

    if grain_candidates:
        try:
            metrics.grain_candidates = reader.validate_grain_candidates(grain_candidates)
        except Exception:  # noqa: BLE001
            metrics.grain_candidates = None
            metrics.warnings.append("Full grain-key validation was unavailable; sample grain confidence is shown.")

    metrics.warnings.extend(reader.warnings)
    metrics.warnings = list(dict.fromkeys(metrics.warnings))
    return metrics
