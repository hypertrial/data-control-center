"""Profiler I/O: lazy frames and frame input collection."""

from __future__ import annotations

from typing import Any

import polars as pl

from app.config import Settings
from app.services.registry import RegisteredDataset

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
