"""Structure inference: grain keys, temporal columns, measures."""

from __future__ import annotations

from typing import Any

import polars as pl

from app.models.api import (
    ColumnProfile,
    EntityIdCandidate,
    GrainKeyCandidate,
    MeasureCandidate,
    SemanticType,
    StructureConfidence,
    TemporalColumnInfo,
    TemporalKind,
)
from app.services.profiler.patterns import (
    DISCRETE_TIME_NAME_PATTERN,
    _entity_name_strength,
    _normalize_column_name,
)

def _confidence_from_ratio(
    ratio: float, high_threshold: float, medium_threshold: float
) -> StructureConfidence:
    if ratio >= high_threshold:
        return StructureConfidence.high
    if ratio >= medium_threshold:
        return StructureConfidence.medium
    return StructureConfidence.low


def _is_discrete_temporal_column(
    col_name: str,
    dtype: pl.DataType,
    sample_series: pl.Series,
    row_count: int,
) -> bool:
    lname = col_name.lower()
    looks_like_name = DISCRETE_TIME_NAME_PATTERN.search(lname) is not None

    if dtype in (pl.Date, pl.Datetime, pl.Time):
        return False

    if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt32, pl.UInt64):
        vals = sample_series.drop_nulls()
        if vals.is_empty():
            return looks_like_name
        try:
            mn = int(vals.min())  # type: ignore[arg-type]
            mx = int(vals.max())  # type: ignore[arg-type]
            n_unique = int(vals.n_unique())
        except Exception:
            return looks_like_name
        in_year_range = 1900 <= mn <= 2100 and 1900 <= mx <= 2100
        compact_cardinality = n_unique <= max(24, int(max(1, row_count) * 0.1))
        return in_year_range or (looks_like_name and compact_cardinality)

    if dtype == pl.Utf8:
        if not looks_like_name:
            return False
        vals = sample_series.drop_nulls().head(500).to_list()
        if not vals:
            return True
        numeric_like = 0
        for raw in vals:
            s = str(raw).strip()
            if s.isdigit():
                numeric_like += 1
        return numeric_like / max(1, len(vals)) >= 0.8

    return False


def _rank_measure_candidates(
    df_sample: pl.DataFrame,
    col_profiles: list[ColumnProfile],
) -> list[MeasureCandidate]:
    out: list[MeasureCandidate] = []
    for c in col_profiles:
        if c.semantic_type != SemanticType.numeric:
            continue
        series = df_sample.get_column(c.name)
        clean = series.drop_nulls()
        spread_score = 0.0
        if not clean.is_empty():
            try:
                spread_score = float(clean.std() or 0.0)
            except Exception:
                spread_score = 0.0
        completeness = max(0.0, 100.0 - c.null_pct) / 100.0
        uniqueness = 0.0
        if c.cardinality is not None and len(df_sample):
            uniqueness = min(1.0, c.cardinality / max(1, len(df_sample)))
        score = (min(1.0, spread_score / 50.0) * 0.5) + (completeness * 0.35) + (uniqueness * 0.15)
        conf = _confidence_from_ratio(score, 0.8, 0.55)
        out.append(MeasureCandidate(name=c.name, score=round(score, 4), confidence=conf))
    out.sort(key=lambda x: x.score, reverse=True)
    return out


def _build_key_candidate_pool(
    col_profiles: list[ColumnProfile],
    temporal_cols: list[TemporalColumnInfo],
    max_cols: int,
) -> list[str]:
    """Prioritize identifier-ish columns so wide schemas still find entity + period grain."""
    scored: list[tuple[float, int, str]] = []
    for order, c in enumerate(col_profiles):
        if c.null_pct > 5:
            continue
        norm = _normalize_column_name(c.name)
        ent = _entity_name_strength(norm)
        pri = 0.0
        if c.semantic_type == SemanticType.id_like:
            pri = 300.0 + ent * 30.0 - c.null_pct
        elif c.semantic_type == SemanticType.categorical:
            pri = 150.0 + ent * 20.0 - c.null_pct
            if ent >= 2 and c.cardinality and c.cardinality >= max(5, len(col_profiles)):
                pri += 40.0
        elif c.semantic_type == SemanticType.numeric and ent >= 2:
            pri = 115.0 + min(60.0, (c.cardinality or 0) / 50.0) - c.null_pct
        if pri > 0:
            scored.append((pri, -order, c.name))
    scored.sort(key=lambda x: (-x[0], x[1]))
    non_temp_pool = list(dict.fromkeys([name for _, _, name in scored]))
    temporal_names = [t.name for t in temporal_cols]
    budget = max(0, max_cols - len(temporal_names))
    return non_temp_pool[:budget] + temporal_names


def _build_grain_key_candidates(
    df_sample: pl.DataFrame,
    candidate_cols: list[str],
    high_threshold: float,
    medium_threshold: float,
    max_pair_checks: int,
    max_triple_checks: int,
) -> list[GrainKeyCandidate]:
    """Collect single-column, pair, and triple key candidates (no early stop on first hit)."""
    out: list[GrainKeyCandidate] = []
    sample_rows = max(1, len(df_sample))
    if not candidate_cols or not len(df_sample):
        return out

    for col in candidate_cols:
        d = int(df_sample.select(pl.col(col).n_unique().alias("d")).item())
        ratio = d / sample_rows
        conf = _confidence_from_ratio(ratio, high_threshold, medium_threshold)
        if conf != StructureConfidence.low:
            out.append(
                GrainKeyCandidate(
                    columns=[col],
                    uniqueness_ratio=round(ratio, 6),
                    confidence=conf,
                    rank=1,
                )
            )

    checked_pairs = 0
    for i in range(len(candidate_cols)):
        for j in range(i + 1, len(candidate_cols)):
            if checked_pairs >= max_pair_checks:
                break
            cols = [candidate_cols[i], candidate_cols[j]]
            checked_pairs += 1
            d = int(df_sample.select(pl.struct(cols).n_unique().alias("d")).item())
            ratio = d / sample_rows
            conf = _confidence_from_ratio(ratio, high_threshold, medium_threshold)
            if conf != StructureConfidence.low:
                out.append(
                    GrainKeyCandidate(
                        columns=cols,
                        uniqueness_ratio=round(ratio, 6),
                        confidence=conf,
                        rank=1,
                    )
                )
        if checked_pairs >= max_pair_checks:
            break

    has_high = any(c.confidence == StructureConfidence.high for c in out)
    if not has_high and max_triple_checks > 0:
        checked_triples = 0
        for i in range(len(candidate_cols)):
            for j in range(i + 1, len(candidate_cols)):
                for k in range(j + 1, len(candidate_cols)):
                    if checked_triples >= max_triple_checks:
                        break
                    cols = [candidate_cols[i], candidate_cols[j], candidate_cols[k]]
                    checked_triples += 1
                    d = int(df_sample.select(pl.struct(cols).n_unique().alias("d")).item())
                    ratio = d / sample_rows
                    conf = _confidence_from_ratio(ratio, high_threshold, medium_threshold)
                    if conf != StructureConfidence.low:
                        out.append(
                            GrainKeyCandidate(
                                columns=cols,
                                uniqueness_ratio=round(ratio, 6),
                                confidence=conf,
                                rank=1,
                            )
                        )
                if checked_triples >= max_triple_checks:
                    break
            if checked_triples >= max_triple_checks:
                break

    conf_rank = {
        StructureConfidence.high: 3,
        StructureConfidence.medium: 2,
        StructureConfidence.low: 1,
    }
    out.sort(
        key=lambda x: (conf_rank.get(x.confidence, 1), x.uniqueness_ratio, -len(x.columns)),
        reverse=True,
    )
    for idx, cand in enumerate(out, start=1):
        cand.rank = idx
    return out


def _pick_primary_grain_columns(
    candidates: list[GrainKeyCandidate],
    entity_names: set[str],
    temporal_name: str | None,
) -> list[str]:
    """Prefer high-confidence (entity column + primary temporal) panels when ties exist."""
    if not candidates:
        return []
    conf_rank = {
        StructureConfidence.high: 3,
        StructureConfidence.medium: 2,
        StructureConfidence.low: 1,
    }

    def panel_score(colset: set[str]) -> int:
        if not temporal_name or temporal_name not in colset:
            return 0
        if not entity_names.intersection(colset):
            return 0
        return 2 if len(colset) >= 2 else 0

    def sort_key(c: GrainKeyCandidate) -> tuple:
        cols = set(c.columns)
        return (
            panel_score(cols),
            conf_rank.get(c.confidence, 0),
            c.uniqueness_ratio,
            -len(c.columns),
        )

    best = max(candidates, key=sort_key)
    return list(best.columns)


def _merge_entity_candidates(
    from_id_semantic: list[EntityIdCandidate],
    col_profiles: list[ColumnProfile],
) -> list[EntityIdCandidate]:
    by_name: dict[str, StructureConfidence] = {}
    for e in from_id_semantic:
        by_name[e.name] = e.confidence

    for c in col_profiles:
        if c.null_pct > 10:
            continue
        norm = _normalize_column_name(c.name)
        ent = _entity_name_strength(norm)
        if ent < 2:
            continue
        if c.semantic_type not in (
            SemanticType.id_like,
            SemanticType.numeric,
            SemanticType.text,
            SemanticType.categorical,
        ):
            continue
        if c.name in by_name:
            continue
        if c.semantic_type in (SemanticType.categorical, SemanticType.text):
            if ent < 3 or not c.cardinality or c.cardinality < 25:
                continue
        if c.semantic_type == SemanticType.numeric and ent < 3:
            continue
        conf = StructureConfidence.high if c.null_pct <= 1 else StructureConfidence.medium
        if ent >= 3:
            conf = StructureConfidence.high if c.null_pct <= 2 else StructureConfidence.medium
        by_name[c.name] = conf

    out = [EntityIdCandidate(name=n, confidence=s) for n, s in by_name.items()]
    out.sort(
        key=lambda x: (
            {StructureConfidence.high: 0, StructureConfidence.medium: 1, StructureConfidence.low: 2}.get(
                x.confidence, 3
            ),
            x.name,
        )
    )
    return out
