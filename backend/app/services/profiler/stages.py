"""Typed intermediate results for the profiling pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.models.api import (
    ColumnProfile,
    EntityIdCandidate,
    GrainKeyCandidate,
    MeasureCandidate,
    MetricScope,
    StructureConfidence,
    TemporalColumnInfo,
)
from app.services.profiler.full_metrics import FullProfileMetrics


@dataclass
class ProfileInputs:
    names: list[str]
    dtypes: dict[str, str]
    stats: dict[str, Any]
    row_count: int
    col_count: int
    df_sample: Any
    profile_sample_rows: int
    sample_n: int
    metric_scope: MetricScope
    total_cells: int


@dataclass
class FullMetricsResult:
    metrics: FullProfileMetrics | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class ColumnDerivationResult:
    col_profiles: list[ColumnProfile]
    null_cells: int
    temporal_cols: list[TemporalColumnInfo]
    entity_candidates: list[EntityIdCandidate]
    sample_dup_pct: float | None
    dup_pct: float | None
    dup_scope: MetricScope | None
    missing_cell_pct: float | None
    semantic_elapsed_ms: int


@dataclass
class StructureInferenceResult:
    temporal_cols: list[TemporalColumnInfo]
    primary_temporal: TemporalColumnInfo | None
    primary_date: str | None
    measure_candidates: list[MeasureCandidate]
    measures: list[str]
    entity_final: list[EntityIdCandidate]
    entity_name_set: set[str]
    id_column_names: list[str]
    grain_candidates: list[GrainKeyCandidate]
    grain_key_scope: MetricScope
    primary_grain: list[str]
    key_candidates: list[str]
    key_search_elapsed_ms: int
    measure_elapsed_ms: int
    top_value_columns: list[str]
    primary_grain_conf: StructureConfidence | None
