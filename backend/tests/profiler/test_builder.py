"""Profiler internals and build_profile branches."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from app.config import Settings
from app.models.api import (
    ColumnProfile,
    EntityIdCandidate,
    GrainKeyCandidate,
    QualitySeverity,
    SemanticType,
    StructureConfidence,
)
from app.services.profiler import (
    _build_grain_key_candidates,
    _build_key_candidate_pool,
    _confidence_from_ratio,
    _detect_quality_issues,
    _entity_name_strength,
    _is_discrete_temporal_column,
    _infer_semantic,
    _lazy_frame_for,
    _merge_entity_candidates,
    _numeric_describe_strings,
    _numeric_histogram,
    _rank_measure_candidates,
    _series_quantile_str,
    _severity_order,
    _top_values,
    build_profile,
)
from app.services.registry import RegisteredDataset


def test_lazy_frame_unsupported_format(tmp_path: Path) -> None:
    ds = RegisteredDataset(
        dataset_id="ds_unit",
        source_path=tmp_path / "x.csv",
        source_label="test",
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


def test_infer_semantic_camel_case_player_id() -> None:
    assert _infer_semantic("playerId", pl.Int64, 0, 50, 200, []) == SemanticType.id_like


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
        source_label="test",
        view_name="vx",
        format="parquet",
        row_count=2,
        column_count=1,
        file_size_bytes=1,
    )
    prof = build_profile(ds, Settings())
    assert prof.rows == 2


def test_build_profile_jsonl(tmp_path: Path) -> None:
    path = tmp_path / "f.jsonl"
    path.write_text('{"a":1,"b":"x"}\n{"a":2,"b":"y"}\n')
    ds = RegisteredDataset(
        dataset_id="ds_j",
        source_path=path,
        source_label="test",
        view_name="vj",
        format="json",
        row_count=2,
        column_count=2,
        file_size_bytes=1,
    )
    prof = build_profile(ds, Settings())
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
        source_label="test",
        view_name="vw",
        format="csv",
        row_count=50,
        column_count=6,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    assert prof.quality_issues
    assert prof.potential_id_columns or prof.likely_grain


def test_build_profile_high_null_column_flag(tmp_path: Path) -> None:
    path = tmp_path / "nulls.parquet"
    pl.DataFrame({"a": [1, None, None, None, 2], "b": [1, 2, 3, 4, 5]}).write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_null",
        source_path=path,
        source_label="test",
        view_name="vn",
        format="parquet",
        row_count=5,
        column_count=2,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    col_a = next(c for c in prof.column_profiles if c.name == "a")
    assert "high_missingness" in col_a.quality_flags
    assert col_a.metric_scope.value == "full"
    assert prof.grain_key_scope.value == "full"


def test_build_profile_collects_wide_null_counts_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "wide_nulls.csv"
    columns = [f"c{i}" for i in range(12)]
    rows = [",".join(columns)]
    rows.extend(",".join("" if i % 3 == 0 else str(i) for i in range(len(columns))) for _ in range(5))
    path.write_text("\n".join(rows))
    ds = RegisteredDataset(
        dataset_id="ds_wide_nulls",
        source_path=path,
        source_label="test",
        view_name="vw_nulls",
        format="csv",
        row_count=5,
        column_count=len(columns),
        file_size_bytes=path.stat().st_size,
    )
    select_calls = 0
    real_select = pl.LazyFrame.select

    def counting_select(self: pl.LazyFrame, *exprs, **named_exprs):  # noqa: ANN002, ANN003, ANN201
        nonlocal select_calls
        select_calls += 1
        return real_select(self, *exprs, **named_exprs)

    monkeypatch.setattr(pl.LazyFrame, "select", counting_select)

    prof = build_profile(ds, Settings())

    assert prof.columns == len(columns)
    assert select_calls == 1


def test_build_profile_utf8_text_top_values(tmp_path: Path) -> None:
    path = tmp_path / "textcol.csv"
    path.write_text("note\n" + "\n".join(f"unique-{i}" for i in range(80)))
    ds = RegisteredDataset(
        dataset_id="ds_t",
        source_path=path,
        source_label="test",
        view_name="vt",
        format="csv",
        row_count=80,
        column_count=1,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    col = next(c for c in prof.column_profiles if c.name == "note")
    assert col.semantic_type == SemanticType.text
    assert col.top_values


def test_build_profile_detects_discrete_temporal_and_composite_grain(tmp_path: Path) -> None:
    path = tmp_path / "players.parquet"
    rows = []
    for year in (2022, 2023, 2024):
        for pid in range(1, 25):
            rows.append(
                {
                    "player_id": pid,
                    "year": year,
                    "league": "A",
                    "overall": 60 + (pid % 10),
                }
            )
    pl.DataFrame(rows).write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_players",
        source_path=path,
        source_label="test",
        view_name="v_players",
        format="parquet",
        row_count=len(rows),
        column_count=4,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    assert prof.structure_version == "v4"
    assert prof.primary_temporal_column is not None
    assert prof.primary_temporal_column.name == "year"
    assert prof.primary_temporal_column.kind.value == "discrete_period"
    assert {*prof.primary_grain_key_columns} == {"player_id", "year"}
    assert prof.grain_key_candidates
    assert prof.grain_key_candidates[0].uniqueness_ratio >= 0.99
    assert any(e.name == "player_id" for e in prof.entity_id_columns)
    assert "player_id" in prof.potential_id_columns


def test_build_profile_finds_panel_grain_with_player_id_late_in_schema(tmp_path: Path) -> None:
    """Many leading categoricals should not push the period axis out of the key candidate budget."""
    rows = []
    for yr in (2022, 2023, 2024, 2025):
        for pid in range(1, 30):
            row: dict = {f"dim_{i}": ((pid + i + yr) % 9) for i in range(12)}
            row["playerId"] = pid
            row["year"] = yr
            row["overall"] = 60.0 + (pid % 10)
            rows.append(row)
    path = tmp_path / "wide_panel.parquet"
    pl.DataFrame(rows).write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_wide_panel",
        source_path=path,
        source_label="test",
        view_name="vwide",
        format="parquet",
        row_count=len(rows),
        column_count=len(rows[0]),
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    assert prof.structure_version == "v4"
    assert {*prof.primary_grain_key_columns} == {"playerId", "year"}
    assert any(e.name == "playerId" for e in prof.entity_id_columns)


def test_detect_quality_skips_dup_id_warning_when_grain_is_composite(tmp_path: Path) -> None:
    ds = RegisteredDataset(
        dataset_id="ds_dq",
        source_path=tmp_path / "z.csv",
        source_label="test",
        view_name="vz",
        format="csv",
        row_count=100,
        column_count=2,
        file_size_bytes=1,
    )
    cols = [
        ColumnProfile(
            name="player_id",
            physical_type="Int64",
            semantic_type=SemanticType.id_like,
            null_pct=0,
            unique_count=20,
            cardinality=20,
        ),
    ]
    issues = _detect_quality_issues(
        ds,
        cols,
        100,
        0,
        100,
        100,
        primary_grain_columns=["player_id", "year"],
    )
    assert not any("Duplicate values" in i.title for i in issues)

    issues_single = _detect_quality_issues(
        ds,
        cols,
        100,
        0,
        100,
        100,
        primary_grain_columns=["player_id"],
    )
    assert any("Duplicate values" in i.title for i in issues_single)


def test_entity_name_strength_short_tokens() -> None:
    assert _entity_name_strength("pid") == 2


def test_key_candidate_pool_includes_numeric_vendor_suffix() -> None:
    cols = [
        ColumnProfile(
            name="vendor_no",
            physical_type="Int64",
            semantic_type=SemanticType.numeric,
            null_pct=0,
            cardinality=40,
        ),
    ]
    assert _build_key_candidate_pool(cols, [], 10) == ["vendor_no"]


def test_key_candidate_pool_boosts_entity_like_categorical_when_wide() -> None:
    profiles = [
        ColumnProfile(name="low", physical_type="Utf8", semantic_type=SemanticType.categorical, null_pct=0, cardinality=2),
        ColumnProfile(
            name="vendor_no",
            physical_type="Utf8",
            semantic_type=SemanticType.categorical,
            null_pct=0,
            cardinality=30,
        ),
    ]
    pool = _build_key_candidate_pool(profiles, [], 10)
    assert pool[0] == "vendor_no"


def test_merge_entity_candidates_adds_named_high_cardinality_columns() -> None:
    cols = [
        ColumnProfile(
            name="vendor_code",
            physical_type="Utf8",
            semantic_type=SemanticType.categorical,
            null_pct=0,
            cardinality=40,
        ),
    ]
    out = _merge_entity_candidates([], cols)
    assert any(e.name == "vendor_code" for e in out)


def test_merge_entity_candidates_skips_unsupported_or_weak_columns() -> None:
    seed = [EntityIdCandidate(name="keep", confidence=StructureConfidence.high)]
    cols = [
        ColumnProfile(name="b", physical_type="Boolean", semantic_type=SemanticType.boolean_like, null_pct=0),
        ColumnProfile(
            name="lbl", physical_type="Utf8", semantic_type=SemanticType.categorical, null_pct=0, cardinality=5
        ),
        ColumnProfile(name="z", physical_type="Int64", semantic_type=SemanticType.numeric, null_pct=0, cardinality=20),
    ]
    names = {e.name for e in _merge_entity_candidates(seed, cols)}
    assert names == {"keep"}


def test_merge_entity_candidates_skips_non_tabular_semantics() -> None:
    cols = [
        ColumnProfile(name="vendor_no", physical_type="Date", semantic_type=SemanticType.datetime, null_pct=0),
    ]
    assert _merge_entity_candidates([], cols) == []


def test_merge_entity_candidates_skips_duplicate_name_when_seeded() -> None:
    seed = [EntityIdCandidate(name="vendor_code", confidence=StructureConfidence.high)]
    cols = [
        ColumnProfile(
            name="vendor_code",
            physical_type="Utf8",
            semantic_type=SemanticType.categorical,
            null_pct=0,
            cardinality=40,
        ),
    ]
    assert len(_merge_entity_candidates(seed, cols)) == 1


def test_merge_entity_candidates_skips_low_cardinality_code_like_column() -> None:
    cols = [
        ColumnProfile(
            name="vendor_code",
            physical_type="Utf8",
            semantic_type=SemanticType.categorical,
            null_pct=0,
            cardinality=10,
        ),
    ]
    assert _merge_entity_candidates([], cols) == []


def test_merge_entity_candidates_merges_numeric_with_identifier_name() -> None:
    cols = [
        ColumnProfile(
            name="batch_id",
            physical_type="Int64",
            semantic_type=SemanticType.numeric,
            null_pct=0,
            cardinality=50,
        ),
    ]
    out = _merge_entity_candidates([], cols)
    assert any(e.name == "batch_id" for e in out)


def test_merge_entity_candidates_skips_numeric_with_only_medium_name_strength() -> None:
    cols = [
        ColumnProfile(
            name="vendor_no",
            physical_type="Int64",
            semantic_type=SemanticType.numeric,
            null_pct=0,
            cardinality=50,
        ),
    ]
    assert _merge_entity_candidates([], cols) == []


def test_build_profile_role_specific_sparse_columns_are_downgraded(tmp_path: Path) -> None:
    path = tmp_path / "roles.csv"
    lines = [
        "player_id,year,gk_diving,gk_reflexes,pace,position",
        "1,2024,,,80,FW",
        "2,2024,,,77,MF",
        "3,2024,75,70,40,GK",
        "4,2024,,,82,FW",
        "5,2024,72,71,39,GK",
    ]
    path.write_text("\n".join(lines))
    ds = RegisteredDataset(
        dataset_id="ds_roles",
        source_path=path,
        source_label="test",
        view_name="v_roles",
        format="csv",
        row_count=5,
        column_count=6,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    gk_issue = next(i for i in prof.quality_issues if i.id.endswith("_miss_gk_diving"))
    assert gk_issue.severity == QualitySeverity.info
    assert "role-specific metric" in gk_issue.why_it_matters.lower()


def test_lazy_frame_json_array_file(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text('[{"a": 1}, {"a": 2}]')
    ds = RegisteredDataset(
        dataset_id="ds_j2",
        source_path=path,
        source_label="test",
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


def test_confidence_from_ratio_thresholds() -> None:
    assert _confidence_from_ratio(0.9, 0.8, 0.5) == StructureConfidence.high
    assert _confidence_from_ratio(0.6, 0.8, 0.5) == StructureConfidence.medium
    assert _confidence_from_ratio(0.1, 0.8, 0.5) == StructureConfidence.low


def test_is_discrete_temporal_column_integer_empty_and_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert _is_discrete_temporal_column("season_year", pl.Int64, pl.Series("y", []), 10)

    def bad_min(self, *args, **kwargs):  # noqa: ANN001
        raise RuntimeError("broken")

    monkeypatch.setattr(pl.Series, "min", bad_min)
    assert _is_discrete_temporal_column("season_year", pl.Int64, pl.Series("y", [2020, 2021]), 10)


def test_is_discrete_temporal_column_utf8_variants() -> None:
    assert not _is_discrete_temporal_column("label", pl.Utf8, pl.Series("x", ["1", "2"]), 10)
    assert _is_discrete_temporal_column("season", pl.Utf8, pl.Series("x", []), 10)
    assert _is_discrete_temporal_column("season", pl.Utf8, pl.Series("x", ["2023", "2024"]), 10)
    assert not _is_discrete_temporal_column("season", pl.Utf8, pl.Series("x", ["A", "B"]), 10)


def test_rank_measure_candidates_handles_std_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    df = pl.DataFrame({"value": [1, 2, 3]})
    cols = [ColumnProfile(name="value", physical_type="Int64", semantic_type=SemanticType.numeric, cardinality=3)]

    def bad_std(self, *args, **kwargs):  # noqa: ANN001
        raise RuntimeError("no std")

    monkeypatch.setattr(pl.Series, "std", bad_std)
    out = _rank_measure_candidates(df, cols)
    assert out and out[0].name == "value"


def test_build_grain_key_candidates_pair_and_triple_paths() -> None:
    pair_df = pl.DataFrame(
        {"a": [1, 1, 2, 2], "b": [1, 2, 1, 2], "c": [0, 0, 0, 0]}
    )
    pair = _build_grain_key_candidates(pair_df, ["a", "b", "c"], 0.95, 0.5, 10, 10)
    assert pair and pair[0].columns == ["a", "b"]

    triple_df = pl.DataFrame(
        {
            "a": [1, 1, 1, 2],
            "b": [1, 1, 2, 1],
            "c": [1, 2, 1, 1],
        }
    )
    triple = _build_grain_key_candidates(triple_df, ["a", "b", "c"], 0.95, 0.9, 10, 10)
    assert triple and triple[0].columns == ["a", "b", "c"]


def test_build_grain_key_candidates_respects_zero_pair_checks() -> None:
    df = pl.DataFrame({"a": [1, 1, 1], "b": [1, 1, 1], "c": [1, 1, 1]})
    assert _build_grain_key_candidates(df, ["a", "b", "c"], 0.95, 0.5, 0, 0) == []


def test_build_grain_key_candidates_pair_limit_break() -> None:
    df = pl.DataFrame({"a": [1, 1, 1], "b": [1, 1, 1], "c": [1, 1, 1]})
    assert _build_grain_key_candidates(df, ["a", "b", "c"], 0.95, 0.5, 1, 0) == []


def test_build_grain_key_candidates_pair_and_triple_check_limits() -> None:
    df = pl.DataFrame(
        {
            "a": [1, 1, 1, 1],
            "b": [1, 1, 1, 1],
            "c": [1, 1, 1, 1],
            "d": [1, 1, 1, 1],
        }
    )
    out = _build_grain_key_candidates(df, ["a", "b", "c", "d"], 0.99, 0.95, 0, 1)
    assert out == []


def test_detect_quality_issues_empty_cols_branch(tmp_path: Path) -> None:
    ds = RegisteredDataset(
        dataset_id="ds_e",
        source_path=tmp_path / "e.csv",
        source_label="test",
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
        source_label="test",
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
        source_label="test",
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
        source_label="test",
        view_name="vr",
        format="csv",
        row_count=1,
        column_count=1,
        file_size_bytes=1,
    )

    def bad_is_duplicated(self, *args, **kwargs):  # noqa: ANN001, ARG002
        raise RuntimeError("dup fail")

    monkeypatch.setattr(pl.DataFrame, "is_duplicated", bad_is_duplicated)
    prof = build_profile(ds, Settings())
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
        source_label="test",
        view_name="vcat",
        format="csv",
        row_count=600,
        column_count=1,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    assert any("High-cardinality categorical" in i.title for i in prof.quality_issues)


def test_build_profile_narrative_single_grain_and_medium_warning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "single.csv"
    path.write_text("player_id,points\n1,10\n2,20\n")
    ds = RegisteredDataset(
        dataset_id="ds_single",
        source_path=path,
        source_label="test",
        view_name="vsingle",
        format="csv",
        row_count=2,
        column_count=2,
        file_size_bytes=path.stat().st_size,
    )
    monkeypatch.setattr(
        "app.services.profiler.builder._build_grain_key_candidates",
        lambda *a, **k: [
            GrainKeyCandidate(
                columns=["player_id"],
                uniqueness_ratio=0.8,
                confidence=StructureConfidence.medium,
                rank=1,
            )
        ],
    )
    prof = build_profile(ds, Settings())
    assert "one row per `player_id`" in prof.narrative
    assert any("medium" in warning.lower() for warning in prof.structure_warnings)


def test_build_profile_narrative_likely_identifier_columns(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "ids.parquet"
    pl.DataFrame({"player_id": ["u1", "u2", "u3"], "name": ["a", "b", "c"]}).write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_ids",
        source_path=path,
        source_label="test",
        view_name="vids",
        format="parquet",
        row_count=3,
        column_count=2,
        file_size_bytes=path.stat().st_size,
    )
    monkeypatch.setattr("app.services.profiler.builder._build_grain_key_candidates", lambda *a, **k: [])
    prof = build_profile(ds, Settings())
    assert prof.potential_id_columns
    assert "Likely identifier columns" in prof.narrative


def test_build_profile_unique_count_when_full_table_exceeds_sample(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = Settings(profile_structure_sample_max_rows=2_000, profile_structure_sample_min_rows=500)
    n = 5_000
    df = pl.DataFrame(
        {
            "id": list(range(n)),
            "score": [float(i % 17) for i in range(n)],
            "region": (["east", "west", "north", "south"] * (n // 4 + 1))[:n],
        }
    )
    path = tmp_path / "sample_big.parquet"
    df.write_parquet(path)
    ds = RegisteredDataset(
        dataset_id="ds_sample_big",
        source_path=path,
        source_label="test",
        view_name="vsb",
        format="parquet",
        row_count=n,
        column_count=3,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, settings)
    assert prof.profiler_sample_rows == 2_000
    assert prof.duplicate_row_pct_scope is not None
    assert prof.duplicate_row_pct_scope.value == "sample"
    assert prof.grain_key_scope.value == "sample"
    id_col = next(c for c in prof.column_profiles if c.name == "id")
    assert id_col.unique_count == 2_000
    assert id_col.metric_scope.value == "sample"
    assert id_col.unique_pct is not None
    assert id_col.unique_pct > 99.0
    region = next(c for c in prof.column_profiles if c.name == "region")
    assert region.top_value in {"east", "west", "north", "south"}
    assert region.top_count is not None
    assert region.top_pct is not None


def test_build_profile_numeric_describe_stats(tmp_path: Path) -> None:
    path = tmp_path / "nums.csv"
    path.write_text("x\n" + "\n".join(str(i) for i in range(1, 101)))
    ds = RegisteredDataset(
        dataset_id="ds_numd",
        source_path=path,
        source_label="test",
        view_name="vnumd",
        format="csv",
        row_count=100,
        column_count=1,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    col = next(c for c in prof.column_profiles if c.name == "x")
    assert col.mean_value is not None
    assert col.std_value is not None
    assert col.p25_value is not None
    assert col.median_value is not None
    assert col.p75_value is not None


def test_build_profile_categorical_top_value_pct(tmp_path: Path) -> None:
    path = tmp_path / "tops.csv"
    path.write_text("c\n" + "a\n" * 5 + "b\n" * 3)
    ds = RegisteredDataset(
        dataset_id="ds_tops",
        source_path=path,
        source_label="test",
        view_name="vtops",
        format="csv",
        row_count=8,
        column_count=1,
        file_size_bytes=path.stat().st_size,
    )
    prof = build_profile(ds, Settings())
    col = next(c for c in prof.column_profiles if c.name == "c")
    assert col.top_value == "a"
    assert col.top_count == 5
    assert col.top_pct is not None
    assert abs(col.top_pct - 62.5) < 0.1


def test_numeric_describe_strings_empty_series() -> None:
    s = pl.Series([], dtype=pl.Float64)
    assert _numeric_describe_strings(s) == (None, None, None, None, None)


def test_series_quantile_str_handles_empty_and_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    empty = pl.Series([], dtype=pl.Float64)
    assert _series_quantile_str(empty, 0.25) is None

    s = pl.Series([1.0, 2.0, 3.0])

    def _bad_q(*_a, **_k):
        raise RuntimeError("quantile")

    monkeypatch.setattr(s, "quantile", _bad_q)
    assert _series_quantile_str(s, 0.25) is None


def test_series_quantile_str_none_and_nonfinite(monkeypatch: pytest.MonkeyPatch) -> None:
    s = pl.Series([1.0, 2.0])
    monkeypatch.setattr(s, "quantile", lambda *a, **k: None)
    assert _series_quantile_str(s, 0.5) is None

    s2 = pl.Series([1.0, 2.0])
    monkeypatch.setattr(s2, "quantile", lambda *a, **k: float("nan"))
    assert _series_quantile_str(s2, 0.5) is None


def test_numeric_describe_strings_handles_mean_std_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    s = pl.Series([1, 2, 3])

    def _bad_mean(_self):
        raise TypeError("mean")

    monkeypatch.setattr(pl.Series, "mean", _bad_mean)
    mean_v, std_v, p25_v, med_v, p75_v = _numeric_describe_strings(s)
    assert mean_v is None
    assert std_v is not None
    assert p25_v is not None


def test_numeric_describe_strings_handles_std_error(monkeypatch: pytest.MonkeyPatch) -> None:
    s = pl.Series([1, 2, 3])

    def _bad_std(_self, ddof: int = 1):
        raise ValueError("std")

    monkeypatch.setattr(pl.Series, "std", _bad_std)
    mean_v, std_v, *_rest = _numeric_describe_strings(s)
    assert mean_v is not None
    assert std_v is None


def test_numeric_describe_strings_median_non_numeric_str(monkeypatch: pytest.MonkeyPatch) -> None:
    s = pl.Series([1, 2, 3])

    def _weird_median(_self):
        return "custom"

    monkeypatch.setattr(pl.Series, "median", _weird_median)
    *_, med_v, _ = _numeric_describe_strings(s)
    assert med_v == "custom"


def test_numeric_describe_strings_median_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    s = pl.Series([1, 2, 3])

    def _boom(_self):
        raise TypeError("median")

    monkeypatch.setattr(pl.Series, "median", _boom)
    *_, med_v, _ = _numeric_describe_strings(s)
    assert med_v is None
