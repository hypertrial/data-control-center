"""Polars-based profiling and quality heuristics."""

from __future__ import annotations

import math
import re
import time
from typing import Any

import polars as pl

from app.config import Settings
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

# Bump when structure inference output shape or semantics change materially (cache invalidation).
CURRENT_PROFILE_STRUCTURE_VERSION = "v4"

ID_NAME_PATTERN = re.compile(
    r"(^|_)(id|key|uuid|guid|pk|sk|code)(_|$)", re.IGNORECASE
)
# Whole-column names that are commonly entity or surrogate keys (after normalization).
ENTITY_TOKEN_PATTERN = re.compile(
    r"^(pid|uid|sku|upc|ean|uuid|guid)$|"
    r"(^|_)(player|user|entity|customer|account|member|product|vendor|tenant)"
    r"_(id|key|code|no)($|_)",
    re.IGNORECASE,
)
DATE_NAME_PATTERN = re.compile(r"(date|time|timestamp|ts|dt|created|updated)", re.IGNORECASE)
DISCRETE_TIME_NAME_PATTERN = re.compile(r"(year|season|period|quarter|month|week|day)", re.IGNORECASE)


def _normalize_column_name(col: str) -> str:
    """Snake-case-ish lower name for rule matching (handles camelCase)."""
    spaced = col.strip().replace(" ", "_")
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", spaced).lower()


def _entity_name_strength(norm: str) -> int:
    """Higher means more likely an entity / identifier column by name alone."""
    if ID_NAME_PATTERN.search(norm):
        return 3
    if ENTITY_TOKEN_PATTERN.search(norm):
        return 2
    return 0


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
    name_l = _normalize_column_name(col)
    if ID_NAME_PATTERN.search(name_l) or ENTITY_TOKEN_PATTERN.search(name_l):
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


def _series_quantile_str(series: pl.Series, q: float) -> str | None:
    try:
        if series.len() == 0:
            return None
        v = series.quantile(q, interpolation="linear")
        if v is None:
            return None
        fv = float(v)
        if not math.isfinite(fv):
            return None
        return str(v)
    except Exception:
        return None


def _numeric_describe_strings(st: pl.Series) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    """Mean, std, p25, median, p75 as strings from a numeric non-null series."""
    mean_v = std_v = p25_v = med_v = p75_v = None
    if st.len() == 0:
        return mean_v, std_v, p25_v, med_v, p75_v
    try:
        m = st.mean()
        if m is not None:
            fm = float(m)
            if math.isfinite(fm):
                mean_v = str(m)
    except (TypeError, ValueError):
        pass
    try:
        sd = st.std()
        if sd is not None:
            fsd = float(sd)
            if math.isfinite(fsd):
                std_v = str(sd)
    except (TypeError, ValueError):
        pass
    p25_v = _series_quantile_str(st, 0.25)
    p75_v = _series_quantile_str(st, 0.75)
    try:
        med = st.median()
        if med is not None:
            if isinstance(med, float | int):
                fd = float(med)
                if math.isfinite(fd):
                    med_v = str(med)
            else:
                med_v = str(med)
    except (TypeError, ValueError):
        pass
    return mean_v, std_v, p25_v, med_v, p75_v


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


def _collect_profile_frame_inputs(
    ds: RegisteredDataset,
    settings: Settings,
) -> tuple[
    pl.LazyFrame,
    list[str],
    list[pl.DataType],
    pl.DataFrame,
    int,
    int,
    pl.DataFrame,
    int,
]:
    lf = _lazy_frame_for(ds)
    schema = lf.collect_schema()
    names = schema.names()
    dtypes = [schema[n] for n in names]

    stats_exprs = [pl.len().alias("_row_count")]
    stats_exprs.extend(pl.col(col).null_count().alias(f"__nulls_{idx}") for idx, col in enumerate(names))
    stats = lf.select(stats_exprs).collect()
    row_count = int(stats["_row_count"][0])
    col_count = len(names)

    sample_n = min(
        settings.profile_structure_sample_max_rows,
        max(settings.profile_structure_sample_min_rows, row_count),
    )
    df_sample = lf.head(sample_n).collect()
    profile_sample_rows = len(df_sample)
    return lf, names, dtypes, stats, row_count, col_count, df_sample, profile_sample_rows


def _derive_column_profiles(
    names: list[str],
    dtypes: list[pl.DataType],
    stats: pl.DataFrame,
    row_count: int,
    df_sample: pl.DataFrame,
    sample_n: int,
    profile_sample_rows: int,
) -> tuple[
    list[ColumnProfile],
    int,
    list[TemporalColumnInfo],
    list[EntityIdCandidate],
]:
    col_profiles: list[ColumnProfile] = []
    null_cells = 0
    temporal_cols: list[TemporalColumnInfo] = []
    entity_candidates: list[EntityIdCandidate] = []

    for idx, (col, dtype) in enumerate(zip(names, dtypes, strict=False)):
        nulls_full = int(stats[f"__nulls_{idx}"][0]) if row_count else 0
        null_pct = (nulls_full / row_count * 100) if row_count else 0.0
        null_cells += nulls_full

        n_unique = int(df_sample[col].n_unique())
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
                st = df_sample[col].drop_nulls()
                if st.len() > 0:
                    min_v = str(st.min())
                    max_v = str(st.max())
                    hist = _numeric_histogram(df_sample[col])
                top_vals = _top_values(df_sample[col].cast(pl.Utf8, strict=False), k=8)
        elif sem in (SemanticType.categorical, SemanticType.boolean_like):
            top_vals = _top_values(df_sample[col], k=8)
        elif sem == SemanticType.datetime or dtype in (pl.Date, pl.Datetime):
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
            confidence = StructureConfidence.high if null_pct <= 1 else StructureConfidence.medium
            entity_candidates.append(EntityIdCandidate(name=col, confidence=confidence))
            top_vals = _top_values(df_sample[col].cast(pl.Utf8, strict=False), k=5)
        elif dtype == pl.Utf8:
            top_vals = _top_values(df_sample[col], k=8)

        if _is_discrete_temporal_column(col, dtype, df_sample[col], row_count):
            if not any(x.name == col for x in temporal_cols):
                t_conf = (
                    StructureConfidence.high
                    if DISCRETE_TIME_NAME_PATTERN.search(col.lower())
                    else StructureConfidence.medium
                )
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
        if row_count and n_unique == 1:
            flags.append("constant_column")

        unique_pct = round((n_unique / profile_sample_rows) * 100, 4) if profile_sample_rows else None
        mean_value = std_value = median_value = p25_value = p75_value = None
        top_value_str: str | None = None
        top_count_val: int | None = None
        top_pct_val: float | None = None

        if dtype.is_numeric():
            st_nn = df_sample[col].drop_nulls()
            if st_nn.len() > 0:
                mean_value, std_value, p25_value, median_value, p75_value = _numeric_describe_strings(st_nn)
        elif sem == SemanticType.datetime or dtype in (pl.Date, pl.Datetime):
            st_nn = df_sample[col].drop_nulls()
            if st_nn.len() > 0:
                med = st_nn.median()
                if med is not None:
                    median_value = str(med)

        if not dtype.is_numeric() and top_vals:
            raw = top_vals[0]["value"]
            top_value_str = "(null)" if raw is None else str(raw)
            top_count_val = int(top_vals[0].get("count", 0))
            top_pct_val = round((top_count_val / profile_sample_rows) * 100, 4) if profile_sample_rows else None

        col_profiles.append(
            ColumnProfile(
                name=col,
                physical_type=str(dtype),
                semantic_type=sem,
                null_pct=round(null_pct, 4),
                non_null_count=(row_count - nulls_full) if row_count else None,
                null_count=nulls_full,
                unique_count=n_unique,
                unique_pct=unique_pct,
                cardinality=cardinality,
                min_value=min_v,
                max_value=max_v,
                mean_value=mean_value,
                std_value=std_value,
                median_value=median_value,
                p25_value=p25_value,
                p75_value=p75_value,
                top_value=top_value_str,
                top_count=top_count_val,
                top_pct=top_pct_val,
                top_values=top_vals,
                quality_flags=flags,
                histogram=hist,
            )
        )

    return col_profiles, null_cells, temporal_cols, entity_candidates


def _build_profile_narrative(
    ds: RegisteredDataset,
    row_count: int,
    col_count: int,
    primary_grain: list[str],
    id_column_names: list[str],
    primary_date: str | None,
    measures: list[str],
    issues: list[QualityIssue],
) -> list[str]:
    narrative_parts = [
        f"Dataset **{ds.source_path.name}** has **{row_count:,}** rows and **{col_count}** columns.",
    ]
    if primary_grain:
        if len(primary_grain) == 1:
            narrative_parts.append(f"This appears to be **one row per `{primary_grain[0]}`**.")
        else:
            joined = " + ".join(f"`{x}`" for x in primary_grain)
            narrative_parts.append(f"This appears to be one row per composite grain: **{joined}**.")
    elif id_column_names:
        narrative_parts.append(f"Likely identifier columns: {', '.join(f'`{x}`' for x in id_column_names[:5])}.")
    if primary_date:
        narrative_parts.append(f"Primary date-like column: `{primary_date}`.")
    if measures:
        narrative_parts.append(f"Main numeric fields: {', '.join(f'`{m}`' for m in measures[:5])}.")
    top_issues = sorted(issues, key=lambda x: (-_severity_order(x.severity), -x.score_impact))[:5]
    if top_issues:
        narrative_parts.append("Main quality risks: " + "; ".join(i.title for i in top_issues) + ".")
    return narrative_parts


def build_profile(ds: RegisteredDataset, settings: Settings) -> DatasetProfile:
    profiling_started = time.monotonic()
    _lf, names, dtypes, stats, row_count, col_count, df_sample, profile_sample_rows = _collect_profile_frame_inputs(
        ds, settings
    )
    sample_n = profile_sample_rows
    total_cells = row_count * col_count if col_count else 0
    semantic_started = time.monotonic()
    col_profiles, null_cells, temporal_cols, entity_candidates = _derive_column_profiles(
        names,
        dtypes,
        stats,
        row_count,
        df_sample,
        sample_n,
        profile_sample_rows,
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

    entity_final = _merge_entity_candidates(entity_candidates, col_profiles)
    entity_name_set = {e.name for e in entity_final}
    id_column_names = [e.name for e in entity_final]

    key_candidate_pool = _build_key_candidate_pool(
        col_profiles,
        temporal_cols,
        settings.profile_structure_max_key_candidates,
    )
    key_search_started = time.monotonic()
    grain_candidates = _build_grain_key_candidates(
        df_sample=df_sample,
        candidate_cols=key_candidate_pool,
        high_threshold=settings.profile_structure_high_confidence_threshold,
        medium_threshold=settings.profile_structure_medium_confidence_threshold,
        max_pair_checks=settings.profile_structure_max_pair_checks,
        max_triple_checks=settings.profile_structure_max_triple_checks,
    )
    key_search_elapsed_ms = int((time.monotonic() - key_search_started) * 1000)
    primary_grain = _pick_primary_grain_columns(grain_candidates, entity_name_set, primary_date)
    key_candidates: list[str] = []
    for g in grain_candidates:
        key_candidates.extend(g.columns)
    key_candidates = list(dict.fromkeys(key_candidates))

    issues = _detect_quality_issues(
        ds,
        col_profiles,
        row_count,
        null_cells,
        total_cells,
        sample_n,
        primary_grain_columns=primary_grain,
    )

    penalty = sum(i.score_impact for i in issues)
    quality_score = max(0.0, min(100.0, 100.0 - penalty))

    narrative_parts = _build_profile_narrative(
        ds,
        row_count,
        col_count,
        primary_grain,
        id_column_names,
        primary_date,
        measures,
        issues,
    )

    structure_warnings: list[str] = []
    if not primary_grain:
        structure_warnings.append("No high-confidence row grain key was identified in bounded analysis.")
    if primary_temporal is None:
        structure_warnings.append("No temporal axis was detected; trends may require manual column selection.")
    primary_grain_conf = next(
        (g.confidence for g in grain_candidates if list(g.columns) == primary_grain),
        grain_candidates[0].confidence if grain_candidates else None,
    )
    if primary_grain_conf == StructureConfidence.medium:
        structure_warnings.append("Primary grain key confidence is medium (sample-based uniqueness).")

    emit(
        "profile.structure.inference",
        dataset_id=ds.dataset_id,
        row_count=row_count,
        column_count=col_count,
        temporal_candidates=len(temporal_cols),
        entity_candidates=len(entity_final),
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
        profiler_sample_rows=profile_sample_rows,
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
        potential_id_columns=id_column_names[:15],
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
        structure_version=CURRENT_PROFILE_STRUCTURE_VERSION,
        temporal_columns=temporal_cols,
        entity_id_columns=entity_final[:15],
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
    primary_grain_columns: list[str] | None = None,
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

    grain_set = frozenset(primary_grain_columns or [])
    composite_grain = len(grain_set) > 1

    # duplicate primary candidate (sample-uniqueness vs effective rows)
    eff = min(row_count, sample_rows) if row_count else sample_rows
    for c in cols:
        if c.semantic_type == SemanticType.id_like and eff > 0:
            if composite_grain and c.name in grain_set:
                continue
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
