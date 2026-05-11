"""Polars-based profiling and quality heuristics."""

from __future__ import annotations

import math
import re
from typing import Any

import polars as pl

from app.models.api import (
    ColumnProfile,
    DatasetProfile,
    QualityIssue,
    QualitySeverity,
    SemanticType,
)
from app.services.registry import RegisteredDataset

ID_NAME_PATTERN = re.compile(
    r"(^|_)(id|key|uuid|guid|pk|sk)(_|$)", re.IGNORECASE
)
DATE_NAME_PATTERN = re.compile(r"(date|time|timestamp|ts|dt|created|updated)", re.IGNORECASE)


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


def build_profile(ds: RegisteredDataset) -> DatasetProfile:
    lf = _lazy_frame_for(ds)
    schema = lf.collect_schema()
    names = schema.names()
    dtypes = [schema[n] for n in names]

    row_count = int(lf.select(pl.len().alias("n")).collect()["n"][0])
    col_count = len(names)

    # Sample for inference (limit rows)
    sample_n = min(50_000, max(5_000, row_count))
    df_sample = lf.head(sample_n).collect()

    col_profiles: list[ColumnProfile] = []
    total_cells = row_count * col_count if col_count else 0
    null_cells = 0

    numeric_cols: list[str] = []
    cat_cols: list[str] = []
    dt_cols: list[str] = []
    id_candidates: list[str] = []
    key_candidates: list[str] = []

    for col, dtype in zip(names, dtypes, strict=False):
        nulls_full = (
            int(lf.select(pl.col(col).null_count().alias("_ncc")).collect()["_ncc"][0])
            if row_count
            else 0
        )
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
        elif sem == SemanticType.id_like:
            id_candidates.append(col)
            key_candidates.append(col)
            top_vals = _top_values(df_sample[col].cast(pl.Utf8, strict=False), k=5)
        elif dtype == pl.Utf8:
            top_vals = _top_values(df_sample[col], k=8)

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

    primary_date = next((c.name for c in col_profiles if c.semantic_type == SemanticType.datetime), None)
    measures = [c.name for c in col_profiles if c.semantic_type == SemanticType.numeric][:8]

    grain_col = None
    for c in col_profiles:
        if c.semantic_type == SemanticType.id_like and c.null_pct < 1 and row_count:
            if c.unique_count == row_count or (
                c.unique_count and c.unique_count >= row_count * 0.999
            ):
                grain_col = c.name
                break

    narrative_parts = [
        f"Dataset **{ds.source_path.name}** has **{row_count:,}** rows and **{col_count}** columns.",
    ]
    if grain_col:
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
        potential_key_columns=list(dict.fromkeys(key_candidates))[:15],
        quality_score=round(quality_score, 2),
        narrative="\n\n".join(narrative_parts),
        likely_grain=f"One row per {grain_col}." if grain_col else None,
        primary_date_column=primary_date,
        main_numeric_measures=measures,
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
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_miss_{c.name}",
                    severity=QualitySeverity.warning,
                    category="missingness",
                    title=f"High null rate in `{c.name}`",
                    description=f"{c.null_pct:.1f}% values are null.",
                    why_it_matters="May indicate ingestion gaps or optional fields that need business rules.",
                    affected_columns=[c.name],
                    examples=[],
                    suggested_sql=f'SELECT COUNT(*) FILTER (WHERE "{c.name}" IS NULL) AS nulls FROM {view};',
                    score_impact=min(15.0, c.null_pct / 3),
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
