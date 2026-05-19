"""Polars-based profiling and quality heuristics."""

from app.services.profiler.builder import build_profile
from app.services.profiler.columns import (
    _derive_column_profiles,
    _infer_semantic,
    _numeric_describe_strings,
    _numeric_histogram,
    _series_quantile_str,
    _top_values,
)
from app.services.profiler.io import _collect_profile_frame_inputs, _lazy_frame_for
from app.services.profiler.patterns import CURRENT_PROFILE_STRUCTURE_VERSION
from app.services.profiler.quality import (
    _build_profile_narrative,
    _detect_quality_issues,
    _severity_order,
)
from app.services.profiler.structure import (
    _build_grain_key_candidates,
    _build_key_candidate_pool,
    _confidence_from_ratio,
    _is_discrete_temporal_column,
    _merge_entity_candidates,
    _pick_primary_grain_columns,
    _rank_measure_candidates,
)
from app.services.profiler.patterns import _entity_name_strength

__all__ = [
    "CURRENT_PROFILE_STRUCTURE_VERSION",
    "build_profile",
    "_build_grain_key_candidates",
    "_build_key_candidate_pool",
    "_confidence_from_ratio",
    "_detect_quality_issues",
    "_entity_name_strength",
    "_infer_semantic",
    "_is_discrete_temporal_column",
    "_lazy_frame_for",
    "_merge_entity_candidates",
    "_numeric_describe_strings",
    "_numeric_histogram",
    "_rank_measure_candidates",
    "_series_quantile_str",
    "_severity_order",
    "_top_values",
]
