"""Per-column EDA and column profile derivation."""

from __future__ import annotations

import math
from typing import Any

import polars as pl

from app.models.api import (
    ColumnProfile,
    EntityIdCandidate,
    MetricScope,
    SemanticType,
    StructureConfidence,
    TemporalColumnInfo,
    TemporalKind,
)
from app.services.profiler.patterns import (
    DATE_NAME_PATTERN,
    DISCRETE_TIME_NAME_PATTERN,
    ENTITY_TOKEN_PATTERN,
    ID_NAME_PATTERN,
    _entity_name_strength,
    _normalize_column_name,
)
from app.services.profiler.structure import _is_discrete_temporal_column

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
def _derive_column_profiles(
    names: list[str],
    dtypes: list[pl.DataType],
    stats: pl.DataFrame,
    row_count: int,
    df_sample: pl.DataFrame,
    sample_n: int,
    profile_sample_rows: int,
    metric_scope: MetricScope,
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
                metric_scope=metric_scope,
            )
        )

    return col_profiles, null_cells, temporal_cols, entity_candidates
