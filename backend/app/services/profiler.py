"""Polars-based profiling and quality heuristics."""

from __future__ import annotations

import math
import re
import time
from typing import Any

import polars as pl

from app.config import get_settings
from app.models.api import (
    ColumnProfile,
    DatasetProfile,
    EntityIdCandidate,
    GrainKeyCandidate,
    MeasureCandidate,
    QualityIssue,
    QualitySeverity,
    SemanticType,
    StructureConfidence,
    TemporalColumnInfo,
    TemporalKind,
)
from app.services.registry import RegisteredDataset
from app.telemetry import emit

ID_NAME_PATTERN = re.compile(
    r"(^|_)(id|key|uuid|guid|pk|sk)(_|$)", re.IGNORECASE
)
DATE_NAME_PATTERN = re.compile(r"(date|time|timestamp|ts|dt|created|updated)", re.IGNORECASE)
DISCRETE_TIME_NAME_PATTERN = re.compile(r"(year|season|period|quarter|month|week|day)", re.IGNORECASE)


def _lazy_frame_for(ds: RegisteredDataset) -> pl.LazyFrame:
    p = ds.source_path
    if ds.format == "parquet":
        return pl.scan_parquet(p)
    if ds.format == "csv":
        return pl.scan_csv(p, infer_schema_length=10_000, try_parse_dates=True)
    if ds.format == "json":
        suf = p.suffix.lower()
        if suf in (".jsonl", ".ndjson"):
            return pl.scan_ndjson(p, infer_schema_length=10_000)
        return pl.read_json(p).lazy()
    raise ValueError(f"Unsupported format: {ds.format}")


def _infer_semantic(
    col: str,
    dtype: pl.DataType,
    null_pct: float,
    n_unique: int,
    row_count: int,
    sample_vals: list[Any],
) -> SemanticType:
    name_l = col.lower()
    if ID_NAME_PATTERN.search(name_l):
        return SemanticType.id_like
    if dtype in (pl.Int8, pl.Int16, pl.Int32, pl.Int64, pl.UInt32, pl.UInt64):
        if n_unique == row_count and row_count > 0:
            return SemanticType.id_like
        return SemanticType.numeric
    if dtype in (pl.Float32, pl.Float64):
        return SemanticType.numeric
    if dtype == pl.Boolean:
        return SemanticType.boolean_like
    if dtype in (pl.Date, pl.Datetime, pl.Time):
        return SemanticType.datetime
    if dtype == pl.Utf8:
        if DATE_NAME_PATTERN.search(name_l):
            return SemanticType.datetime
        # boolean-like strings
        uniq = {str(v).strip().lower() for v in sample_vals if v is not None}
        if uniq <= {"true", "false", "t", "f", "yes", "no", "1", "0"} and len(uniq) <= 2:
            return SemanticType.boolean_like
        ratio = n_unique / row_count if row_count else 0
        if ratio < 0.05 and n_unique < 50:
            return SemanticType.categorical
        if ratio < 0.5:
            return SemanticType.categorical
        return SemanticType.text
    return SemanticType.unknown


def _top_values(series: pl.Series, k: int = 8) -> list[dict[str, Any]]:
    vc = series.value_counts(sort=True).head(k)
    out = []
    for row in vc.iter_rows(named=True):
        val = row.get(series.name)
        cnt = row.get("count", row.get("counts"))
        out.append({"value": val, "count": int(cnt) if cnt is not None else 0})
    return out


def _numeric_histogram(series: pl.Series, bins: int = 12) -> list[dict[str, Any]] | None:
    clean = series.drop_nulls()
    if clean.len() < 2:
        return None
    try:
        mn = float(clean.min())  # type: ignore[arg-type]
        mx = float(clean.max())  # type: ignore[arg-type]
    except Exception:
        return None
    if not math.isfinite(mn) or not math.isfinite(mx) or mn == mx:
        return None
    # Equal-width bins via explicit break points (Polars requires a Sequence for `breaks`).
    try:
        edges = [mn + (mx - mn) * i / bins for i in range(bins + 1)]
        binned = clean.cut(breaks=edges)
        counts = binned.value_counts().sort(by=binned.name)
        hist = []
        for row in counts.iter_rows(named=True):
            bin_key = binned.name
            hist.append(
                {"bin": str(row.get(bin_key)), "count": int(row.get("count", 0))}
            )
        return hist
    except Exception:
        return None


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


def _build_composite_key_candidates(
    df_sample: pl.DataFrame,
    candidate_cols: list[str],
    high_threshold: float,
    medium_threshold: float,
    max_pair_checks: int,
    max_triple_checks: int,
) -> list[GrainKeyCandidate]:
    out: list[GrainKeyCandidate] = []
    sample_rows = max(1, len(df_sample))
    checked_pairs = 0
    checked_triples = 0

    # Pairs first.
    for i in range(len(candidate_cols)):
        if checked_pairs >= max_pair_checks:
            break
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
                if conf == StructureConfidence.high:
                    break
        if out and out[-1].confidence == StructureConfidence.high:
            break

    # If no strong pairs, try triples under strict cap.
    if not out:
        for i in range(len(candidate_cols)):
            if checked_triples >= max_triple_checks:
                break
            for j in range(i + 1, len(candidate_cols)):
                if checked_triples >= max_triple_checks:
                    break
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
                        if conf == StructureConfidence.high:
                            break
                if out and out[-1].confidence == StructureConfidence.high:
                    break
            if out and out[-1].confidence == StructureConfidence.high:
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


def build_profile(ds: RegisteredDataset) -> DatasetProfile:
    settings = get_settings()
    profiling_started = time.monotonic()
    lf = _lazy_frame_for(ds)
    schema = lf.collect_schema()
    names = schema.names()
    dtypes = [schema[n] for n in names]

    stats_exprs = [pl.len().alias("_row_count")]
    stats_exprs.extend(pl.col(col).null_count().alias(f"__nulls_{idx}") for idx, col in enumerate(names))
    stats = lf.select(stats_exprs).collect()
    row_count = int(stats["_row_count"][0])
    col_count = len(names)

    # Sample for inference (bounded by settings for predictable runtime).
    sample_n = min(
        settings.profile_structure_sample_max_rows,
        max(settings.profile_structure_sample_min_rows, row_count),
    )
    df_sample = lf.head(sample_n).collect()

    col_profiles: list[ColumnProfile] = []
    total_cells = row_count * col_count if col_count else 0
    null_cells = 0

    numeric_cols: list[str] = []
    cat_cols: list[str] = []
    dt_cols: list[str] = []
    temporal_cols: list[TemporalColumnInfo] = []
    id_candidates: list[str] = []
    entity_candidates: list[EntityIdCandidate] = []

    semantic_started = time.monotonic()
    for idx, (col, dtype) in enumerate(zip(names, dtypes, strict=False)):
        nulls_full = int(stats[f"__nulls_{idx}"][0]) if row_count else 0
        null_pct = (nulls_full / row_count * 100) if row_count else 0.0
        null_cells += nulls_full

        n_unique = int(df_sample[col].n_unique())
        # cardinality on sample
        cardinality = n_unique

        sem = _infer_semantic(
            col,
            dtype,
            null_pct,
            n_unique,
            min(row_count, sample_n),
            df_sample[col].head(50).to_list(),
        )

        min_v = max_v = None
        top_vals: list[dict[str, Any]] = []
        hist: list[dict[str, Any]] | None = None
        flags: list[str] = []

        if sem == SemanticType.numeric or dtype in (pl.Float32, pl.Float64, pl.Int64, pl.Int32):
            if dtype.is_numeric():
                numeric_cols.append(col)
                st = df_sample[col].drop_nulls()
                if st.len() > 0:
                    min_v = str(st.min())
                    max_v = str(st.max())
                    hist = _numeric_histogram(df_sample[col])
                top_vals = _top_values(df_sample[col].cast(pl.Utf8, strict=False), k=8)
        elif sem in (SemanticType.categorical, SemanticType.boolean_like):
            cat_cols.append(col)
            top_vals = _top_values(df_sample[col], k=8)
        elif sem == SemanticType.datetime or dtype in (pl.Date, pl.Datetime):
            dt_cols.append(col)
            st = df_sample[col].drop_nulls()
            if st.len() > 0:
                min_v = str(st.min())
                max_v = str(st.max())
            temporal_cols.append(
                TemporalColumnInfo(
                    name=col,
                    kind=TemporalKind.continuous_datetime,
                    confidence=StructureConfidence.high,
                )
            )
        elif sem == SemanticType.id_like:
            id_candidates.append(col)
            confidence = StructureConfidence.high if null_pct <= 1 else StructureConfidence.medium
            entity_candidates.append(EntityIdCandidate(name=col, confidence=confidence))
            top_vals = _top_values(df_sample[col].cast(pl.Utf8, strict=False), k=5)
        elif dtype == pl.Utf8:
            top_vals = _top_values(df_sample[col], k=8)

        if _is_discrete_temporal_column(col, dtype, df_sample[col], row_count):
            if not any(x.name == col for x in temporal_cols):
                t_conf = StructureConfidence.high if DISCRETE_TIME_NAME_PATTERN.search(col.lower()) else StructureConfidence.medium
                temporal_cols.append(
                    TemporalColumnInfo(
                        name=col,
                        kind=TemporalKind.discrete_period,
                        confidence=t_conf,
                    )
                )

        if null_pct > 30:
            flags.append("high_missingness")
        if null_pct > 5 and sem == SemanticType.id_like:
            flags.append("id_with_nulls")
        if row_count and n_unique == 1 and col_count:
            flags.append("constant_column")

        col_profiles.append(
            ColumnProfile(
                name=col,
                physical_type=str(dtype),
                semantic_type=sem,
                null_pct=round(null_pct, 4),
                unique_count=n_unique if row_count <= sample_n else None,
                cardinality=cardinality,
                min_value=min_v,
                max_value=max_v,
                top_values=top_vals,
                quality_flags=flags,
                histogram=hist,
            )
        )

    # Duplicate row pct (sample-based)
    dup_pct = None
    if row_count > 0 and col_count and len(df_sample):
        try:
            dups_sample = int(df_sample.is_duplicated().sum())
            dup_pct = round(dups_sample / len(df_sample) * 100, 4)
        except Exception:
            dup_pct = None

    missing_cell_pct = (
        round(null_cells / total_cells * 100, 4) if total_cells else None
    )

    issues = _detect_quality_issues(
        ds, col_profiles, row_count, null_cells, total_cells, sample_n
    )

    # Quality score 0-100
    penalty = sum(i.score_impact for i in issues)
    quality_score = max(0.0, min(100.0, 100.0 - penalty))

    semantic_elapsed_ms = int((time.monotonic() - semantic_started) * 1000)

    temporal_cols.sort(
        key=lambda x: (x.confidence == StructureConfidence.high, x.kind == TemporalKind.continuous_datetime),
        reverse=True,
    )
    primary_temporal = temporal_cols[0] if temporal_cols else None
    primary_date = primary_temporal.name if primary_temporal else None

    measure_started = time.monotonic()
    measure_candidates = _rank_measure_candidates(df_sample, col_profiles)
    measure_elapsed_ms = int((time.monotonic() - measure_started) * 1000)
    measures = [c.name for c in measure_candidates[:8]]

    key_candidate_pool = []
    for c in col_profiles:
        if c.null_pct > 5:
            continue
        if c.semantic_type in (SemanticType.id_like, SemanticType.categorical):
            key_candidate_pool.append(c.name)
    key_candidate_pool.extend([t.name for t in temporal_cols])
    key_candidate_pool = list(dict.fromkeys(key_candidate_pool))[: settings.profile_structure_max_key_candidates]
    key_search_started = time.monotonic()
    grain_candidates = _build_composite_key_candidates(
        df_sample=df_sample,
        candidate_cols=key_candidate_pool,
        high_threshold=settings.profile_structure_high_confidence_threshold,
        medium_threshold=settings.profile_structure_medium_confidence_threshold,
        max_pair_checks=settings.profile_structure_max_pair_checks,
        max_triple_checks=settings.profile_structure_max_triple_checks,
    )
    key_search_elapsed_ms = int((time.monotonic() - key_search_started) * 1000)
    primary_grain = grain_candidates[0].columns if grain_candidates else []
    key_candidates = []
    for g in grain_candidates:
        key_candidates.extend(g.columns)
    key_candidates = list(dict.fromkeys(key_candidates))

    grain_col = primary_grain[0] if len(primary_grain) == 1 else None

    narrative_parts = [
        f"Dataset **{ds.source_path.name}** has **{row_count:,}** rows and **{col_count}** columns.",
    ]
    if primary_grain:
        if len(primary_grain) == 1:
            narrative_parts.append(f"This appears to be **one row per `{primary_grain[0]}`**.")
        else:
            joined = " + ".join(f"`{x}`" for x in primary_grain)
            narrative_parts.append(f"This appears to be one row per composite grain: **{joined}**.")
    elif grain_col:
        narrative_parts.append(f"This appears to be **one row per `{grain_col}`**.")
    elif id_candidates:
        narrative_parts.append(f"Likely identifier columns: {', '.join(f'`{x}`' for x in id_candidates[:5])}.")
    if primary_date:
        narrative_parts.append(f"Primary date-like column: `{primary_date}`.")
    if measures:
        narrative_parts.append(f"Main numeric fields: {', '.join(f'`{m}`' for m in measures[:5])}.")
    top_issues = sorted(issues, key=lambda x: (-_severity_order(x.severity), -x.score_impact))[:5]
    if top_issues:
        narrative_parts.append("Main quality risks: " + "; ".join(i.title for i in top_issues) + ".")

    structure_warnings: list[str] = []
    if not primary_grain:
        structure_warnings.append("No high-confidence row grain key was identified in bounded analysis.")
    if primary_temporal is None:
        structure_warnings.append("No temporal axis was detected; trends may require manual column selection.")
    if grain_candidates and grain_candidates[0].confidence == StructureConfidence.medium:
        structure_warnings.append("Primary grain key confidence is medium (sample-based uniqueness).")

    emit(
        "profile.structure.inference",
        dataset_id=ds.dataset_id,
        row_count=row_count,
        column_count=col_count,
        temporal_candidates=len(temporal_cols),
        entity_candidates=len(entity_candidates),
        grain_candidates=len(grain_candidates),
        semantic_elapsed_ms=semantic_elapsed_ms,
        key_search_elapsed_ms=key_search_elapsed_ms,
        measure_elapsed_ms=measure_elapsed_ms,
        elapsed_ms=int((time.monotonic() - profiling_started) * 1000),
    )

    return DatasetProfile(
        dataset_id=ds.dataset_id,
        name=ds.source_path.name,
        rows=row_count,
        columns=col_count,
        file_size_bytes=ds.file_size_bytes,
        missing_cell_pct=missing_cell_pct,
        duplicate_row_pct=dup_pct,
        numeric_column_count=len({c.name for c in col_profiles if c.semantic_type == SemanticType.numeric}),
        categorical_column_count=len(
            {c.name for c in col_profiles if c.semantic_type == SemanticType.categorical}
        ),
        datetime_column_count=len(
            {c.name for c in col_profiles if c.semantic_type == SemanticType.datetime}
        ),
        potential_id_columns=id_candidates[:15],
        potential_key_columns=key_candidates[:15],
        quality_score=round(quality_score, 2),
        narrative="\n\n".join(narrative_parts),
        likely_grain=(
            f"One row per {primary_grain[0]}."
            if len(primary_grain) == 1
            else f"One row per {' + '.join(primary_grain)}."
            if primary_grain
            else None
        ),
        primary_date_column=primary_date,
        main_numeric_measures=measures,
        structure_version="v2",
        temporal_columns=temporal_cols,
        entity_id_columns=entity_candidates[:15],
        grain_key_candidates=grain_candidates[:15],
        primary_grain_key_columns=primary_grain,
        primary_temporal_column=primary_temporal,
        measure_candidates=measure_candidates[:20],
        structure_warnings=structure_warnings,
        column_profiles=col_profiles,
        quality_issues=sorted(
            issues,
            key=lambda x: (-_severity_order(x.severity), -x.score_impact),
        ),
    )


def _severity_order(sev: QualitySeverity) -> int:
    return {QualitySeverity.critical: 3, QualitySeverity.warning: 2, QualitySeverity.info: 1}.get(
        sev, 0
    )


def _detect_quality_issues(
    ds: RegisteredDataset,
    cols: list[ColumnProfile],
    row_count: int,
    null_cells: int,
    total_cells: int,
    sample_rows: int,
) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    view = ds.view_name
    # Role-specific metrics (e.g. goalkeeper attributes) are often conditionally sparse.
    role_sparse_cols = [c for c in cols if c.name.lower().startswith("gk_") and c.null_pct >= 60]
    role_sparse_ratio = len(role_sparse_cols) / max(1, len(cols))

    if total_cells and null_cells / total_cells > 0.15:
        if cols:
            conds = " AND ".join(f'"{c.name}" IS NOT NULL' for c in cols[:8])
            sql = f"SELECT COUNT(*) FILTER (WHERE {conds}) AS complete_rows, COUNT(*) AS total FROM {view};"
        else:
            sql = None
        issues.append(
            QualityIssue(
                id=f"{ds.dataset_id}_missing_mass",
                severity=QualitySeverity.warning,
                category="missingness",
                title="High overall missingness",
                description=f"{null_cells / total_cells * 100:.1f}% of cells are null across the dataset.",
                why_it_matters="Downstream joins, metrics, and ML features may be biased or unstable.",
                affected_columns=[c.name for c in cols if c.null_pct > 15][:20],
                examples=[],
                suggested_sql=sql,
                score_impact=min(25.0, (null_cells / total_cells) * 40),
            )
        )

    # duplicate primary candidate (sample-uniqueness vs effective rows)
    eff = min(row_count, sample_rows) if row_count else sample_rows
    for c in cols:
        if c.semantic_type == SemanticType.id_like and eff > 0:
            if c.unique_count is not None and c.unique_count < eff * 0.99:
                dup_pct = (1 - c.unique_count / eff) * 100
                issues.append(
                    QualityIssue(
                        id=f"{ds.dataset_id}_dup_{c.name}",
                        severity=QualitySeverity.critical,
                        category="keys",
                        title=f"Duplicate values in likely key column `{c.name}`",
                        description=f"Column `{c.name}` has ~{dup_pct:.2f}% non-unique values in the profiled sample.",
                        why_it_matters="If this is a primary key, the table grain may not be what you expect.",
                        affected_columns=[c.name],
                        examples=[v.get("value") for v in c.top_values[:3]],
                        suggested_sql=f'SELECT "{c.name}", COUNT(*) AS n FROM {view} GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 20;',
                        score_impact=min(35.0, dup_pct / 2),
                    )
                )

    for c in cols:
        if c.null_pct > 25:
            sev = QualitySeverity.warning
            score_impact = min(15.0, c.null_pct / 3)
            why = "May indicate ingestion gaps or optional fields that need business rules."
            if c.name.lower().startswith("gk_") and role_sparse_ratio >= 0.08:
                sev = QualitySeverity.info
                score_impact = min(4.0, c.null_pct / 10)
                why = "Likely role-specific metric with expected sparsity for non-goalkeepers."
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_miss_{c.name}",
                    severity=sev,
                    category="missingness",
                    title=f"High null rate in `{c.name}`",
                    description=f"{c.null_pct:.1f}% values are null.",
                    why_it_matters=why,
                    affected_columns=[c.name],
                    examples=[],
                    suggested_sql=f'SELECT COUNT(*) FILTER (WHERE "{c.name}" IS NULL) AS nulls FROM {view};',
                    score_impact=score_impact,
                )
            )
        if "constant_column" in c.quality_flags:
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_const_{c.name}",
                    severity=QualitySeverity.info,
                    category="variance",
                    title=f"Constant or near-constant column `{c.name}`",
                    description="All sampled values are the same.",
                    why_it_matters="Low information columns can often be dropped from modeling or dashboards.",
                    affected_columns=[c.name],
                    examples=[c.top_values[0]["value"]] if c.top_values else [],
                    suggested_sql=f'SELECT DISTINCT "{c.name}" FROM {view};',
                    score_impact=2.0,
                )
            )
        if c.semantic_type == SemanticType.categorical and c.cardinality and c.cardinality > 200:
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_hicard_{c.name}",
                    severity=QualitySeverity.info,
                    category="cardinality",
                    title=f"High-cardinality categorical `{c.name}`",
                    description=f"~{c.cardinality} distinct values in sample.",
                    why_it_matters="May need grouping, hashing, or feature engineering for ML.",
                    affected_columns=[c.name],
                    examples=[],
                    suggested_sql=f'SELECT "{c.name}", COUNT(*) AS n FROM {view} GROUP BY 1 ORDER BY n DESC LIMIT 20;',
                    score_impact=3.0,
                )
            )

    return issues
