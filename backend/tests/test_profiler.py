"""Profiler internals and build_profile branches."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from app.models.api import QualitySeverity, SemanticType
from app.services.profiler import (
    _detect_quality_issues,
    _infer_semantic,
    _lazy_frame_for,
    _numeric_histogram,
    _severity_order,
    _top_values,
    build_profile,
)
from app.services.registry import RegisteredDataset


def test_lazy_frame_unsupported_format(tmp_path: Path) -> None:
    ds = RegisteredDataset(
        dataset_id="ds_unit",
        source_path=tmp_path / "x.csv",
        view_name="v_ds_unit",
        format="weird",
        row_count=1,
        column_count=1,
        file_size_bytes=1,
    )
    with pytest.raises(ValueError, match="Unsupported format"):
        _lazy_frame_for(ds)


def test_infer_semantic_id_name_pattern() -> None:
    assert _infer_semantic("row_id", pl.Int64, 0, 1, 5, [1]) == SemanticType.id_like


def test_infer_semantic_int_unique_all_rows() -> None:
    assert _infer_semantic("n", pl.Int64, 0, 3, 3, [1, 2, 3]) == SemanticType.id_like


def test_infer_semantic_int_numeric() -> None:
    assert _infer_semantic("n", pl.Int64, 0, 1, 3, [1]) == SemanticType.numeric


def test_infer_semantic_float() -> None:
    assert _infer_semantic("x", pl.Float64, 0, 2, 2, [1.0, 2.0]) == SemanticType.numeric


def test_infer_semantic_bool() -> None:
    assert _infer_semantic("b", pl.Boolean, 0, 2, 2, [True, False]) == SemanticType.boolean_like


def test_infer_semantic_datetime_dtype() -> None:
    assert (
        _infer_semantic("d", pl.Date, 0, 1, 1, []) == SemanticType.datetime
    )


def test_infer_semantic_utf8_date_name() -> None:
    assert _infer_semantic("created_at", pl.Utf8, 0, 2, 2, ["a", "b"]) == SemanticType.datetime


def test_infer_semantic_utf8_boolean_like() -> None:
    assert (
        _infer_semantic("flag", pl.Utf8, 0, 2, 2, ["true", "false"]) == SemanticType.boolean_like
    )


def test_infer_semantic_utf8_categorical_low_cardinality() -> None:
    # 2 uniques in 10 rows -> ratio 0.2
    assert (
        _infer_semantic("cat", pl.Utf8, 0, 2, 10, ["a", "b"]) == SemanticType.categorical
    )


def test_infer_semantic_utf8_categorical_medium() -> None:
    # 4 uniques in 10 rows -> ratio 0.4
    vals = ["a", "b", "c", "d"]
    sample = vals * 3  # 12-ish - use exact row_count 10, n_unique 4 -> ratio 0.4
    assert (
        _infer_semantic("labels", pl.Utf8, 0, 4, 10, sample[:10]) == SemanticType.categorical
    )


def test_infer_semantic_utf8_text() -> None:
    vals = [str(i) for i in range(20)]
    assert _infer_semantic("blob", pl.Utf8, 0, 20, 20, vals) == SemanticType.text


def test_infer_semantic_unknown_dtype() -> None:
    class Weird:
        pass

    # construct a non-standard dtype via List inner
    dtype = pl.List(pl.Int64)
    assert _infer_semantic("z", dtype, 0, 1, 1, [[]]) == SemanticType.unknown


def test_top_values_reads_counts_key() -> None:
    s = pl.Series("c", ["a", "a", "b"])
    out = _top_values(s, k=3)
    assert len(out) >= 1
    assert "count" in out[0] or "value" in out[0]


def test_numeric_histogram_short_series() -> None:
    assert _numeric_histogram(pl.Series("x", [1.0]), bins=4) is None


def test_numeric_histogram_equal_min_max() -> None:
    assert _numeric_histogram(pl.Series("x", [2.0, 2.0, 2.0]), bins=4) is None


def test_numeric_histogram_normal() -> None:
    h = _numeric_histogram(pl.Series("x", list(range(20)), dtype=pl.Float64), bins=5)
    assert h is not None and len(h) >= 1


def test_severity_order_known() -> None:
    assert _severity_order(QualitySeverity.critical) == 3
    assert _severity_order(QualitySeverity.warning) == 2
    assert _severity_order(QualitySeverity.info) == 1


def test_build_profile_from_parquet_list_column(tmp_path: Path) -> None:
    path = tmp_path / "p.parquet"
    pl.DataFrame({"weird": [[1], [2, 3]]}).write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_x",
        source_path=path,
        view_name="vx",
        format="parquet",
        row_count=2,
        column_count=1,
        file_size_bytes=1,
    )
    prof = build_profile(ds)
    assert prof.rows == 2


def test_build_profile_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "f.jsonl"
    path.write_text('{"a":1,"b":"x"}\n{"a":2,"b":"y"}\n')
    ds = RegisteredDataset(
        dataset_id="ds_j",
        source_path=path,
        view_name="vj",
        format="json",
        row_count=2,
        column_count=2,
        file_size_bytes=1,
    )
    prof = build_profile(ds)
    assert prof.rows == 2


def test_build_profile_triggers_quality_branches(tmp_path: Path) -> None:
    # Sparse matrix → high missingness; id column with dup + nulls; constant col; high-card categoricals
    path = tmp_path / "wide.csv"
    lines = ["id_flag,name_label,cat_dim,measure,note,ts_col,const_x"]
    for i in range(50):
        line = f"v{i},n{i},{i % 3},{i + 0.5},text{i},2020-01-01,const"
        if i % 5 == 0:
            line = f",n{i},{i % 3},{i + 0.5},text{i},2020-01-01,const"
        lines.append(line)
    path.write_text("\n".join(lines))
    ds = RegisteredDataset(
        dataset_id="ds_wide",
        source_path=path,
        view_name="vw",
        format="csv",
        row_count=50,
        column_count=6,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds)
    assert prof.quality_issues
    assert prof.potential_id_columns or prof.likely_grain


def test_build_profile_high_null_column_flag(tmp_path: Path) -> None:
    path = tmp_path / "nulls.parquet"
    pl.DataFrame({"a": [1, None, None, None, 2], "b": [1, 2, 3, 4, 5]}).write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_null",
        source_path=path,
        view_name="vn",
        format="parquet",
        row_count=5,
        column_count=2,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds)
    col_a = next(c for c in prof.column_profiles if c.name == "a")
    assert "high_missingness" in col_a.quality_flags


def test_build_profile_utf8_text_top_values(tmp_path: Path) -> None:
    path = tmp_path / "textcol.csv"
    path.write_text("note\n" + "\n".join(f"unique-{i}" for i in range(80)))
    ds = RegisteredDataset(
        dataset_id="ds_t",
        source_path=path,
        view_name="vt",
        format="csv",
        row_count=80,
        column_count=1,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds)
    col = next(c for c in prof.column_profiles if c.name == "note")
    assert col.semantic_type == SemanticType.text
    assert col.top_values


def test_lazy_frame_json_array_file(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text('[{"a": 1}, {"a": 2}]')
    ds = RegisteredDataset(
        dataset_id="ds_j2",
        source_path=path,
        view_name="vj2",
        format="json",
        row_count=2,
        column_count=1,
        file_size_bytes=1,
    )
    lf = _lazy_frame_for(ds)
    assert lf.collect().height == 2


def test_numeric_histogram_min_max_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    def bad_min(self, *a, **k):  # noqa: ANN001
        raise RuntimeError("nope")

    monkeypatch.setattr(pl.Series, "min", bad_min)
    assert _numeric_histogram(pl.Series("x", [1.0, 2.0, 3.0]), bins=3) is None


def test_numeric_histogram_cut_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    real_drop = pl.Series.drop_nulls

    def drop_then_broken(self, *a, **k):  # noqa: ANN001
        s = real_drop(self, *a, **k)

        def bad_cut(*ia, **ik):  # noqa: ANN001
            raise RuntimeError("cut")

        s.cut = bad_cut  # type: ignore[method-assign]
        return s

    monkeypatch.setattr(pl.Series, "drop_nulls", drop_then_broken)
    assert _numeric_histogram(pl.Series("x", [1.0, 5.0, 9.0, 13.0]), bins=4) is None


def test_detect_quality_issues_empty_cols_branch(tmp_path: Path) -> None:
    ds = RegisteredDataset(
        dataset_id="ds_e",
        source_path=tmp_path / "e.csv",
        view_name="ve",
        format="csv",
        row_count=10,
        column_count=0,
        file_size_bytes=1,
    )
    issues = _detect_quality_issues(ds, [], 10, 100, 100, 50)
    miss = next(i for i in issues if i.id.endswith("_missing_mass"))
    assert miss.suggested_sql is None


def test_detect_quality_issues_suggested_sql_with_columns(tmp_path: Path) -> None:
    from app.models.api import ColumnProfile

    ds = RegisteredDataset(
        dataset_id="ds_sql",
        source_path=tmp_path / "e2.csv",
        view_name="ve2",
        format="csv",
        row_count=10,
        column_count=2,
        file_size_bytes=1,
    )
    cols = [
        ColumnProfile(name="c1", physical_type="Int64", semantic_type=SemanticType.numeric),
        ColumnProfile(name="c2", physical_type="Int64", semantic_type=SemanticType.numeric),
    ]
    issues = _detect_quality_issues(ds, cols, 10, 200, 200, 50)
    miss = next(i for i in issues if i.id.endswith("_missing_mass"))
    assert miss.suggested_sql and " AND " in miss.suggested_sql


def test_detect_quality_column_null_issue(tmp_path: Path) -> None:
    from app.models.api import ColumnProfile

    ds = RegisteredDataset(
        dataset_id="ds_nc",
        source_path=tmp_path / "e3.csv",
        view_name="ve3",
        format="csv",
        row_count=10,
        column_count=1,
        file_size_bytes=1,
    )
    cols = [ColumnProfile(name="big", physical_type="Utf8", semantic_type=SemanticType.text, null_pct=40.0)]
    issues = _detect_quality_issues(ds, cols, 10, 50, 50, 50)
    assert any("High null rate" in i.title for i in issues)


def test_build_profile_duplicate_rows_exception_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "r.csv"
    path.write_text("a\n1\n")
    ds = RegisteredDataset(
        dataset_id="ds_dup",
        source_path=path,
        view_name="vr",
        format="csv",
        row_count=1,
        column_count=1,
        file_size_bytes=1,
    )

    def bad_is_duplicated(self, *args, **kwargs):  # noqa: ANN001, ARG002
        raise RuntimeError("dup fail")

    monkeypatch.setattr(pl.DataFrame, "is_duplicated", bad_is_duplicated)
    prof = build_profile(ds)
    assert prof.duplicate_row_pct is None


def test_build_profile_high_cardinality_categorical_issue(tmp_path: Path) -> None:
    path = tmp_path / "bigcat.csv"
    vals = [f"v{i}" for i in range(250)]
    lines = ["labels"]
    for j in range(600):
        lines.append(vals[j % 250])
    path.write_text("\n".join(lines))
    ds = RegisteredDataset(
        dataset_id="ds_cat",
        source_path=path,
        view_name="vcat",
        format="csv",
        row_count=600,
        column_count=1,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds)
    assert any("High-cardinality categorical" in i.title for i in prof.quality_issues)
