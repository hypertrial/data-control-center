"""Unit tests for profile diff helper."""

from __future__ import annotations

from app.services.profile_diff import diff_profile_dicts


def test_diff_new_and_removed_columns() -> None:
    before = {
        "quality_score": 50.0,
        "column_profiles": [
            {"name": "a", "null_pct": 10.0},
            {"name": "oldcol", "null_pct": 0.0},
        ],
    }
    after = {
        "quality_score": 72.0,
        "column_profiles": [
            {"name": "a", "null_pct": 25.0},
            {"name": "b", "null_pct": 0.0},
        ],
    }
    d = diff_profile_dicts(before, after)
    assert d["new_columns"] == ["b"]
    assert d["removed_columns"] == ["oldcol"]
    assert len(d["null_pct_changes"]) == 1
    assert d["null_pct_changes"][0]["column"] == "a"
    assert d["null_pct_changes"][0]["delta"] == 15.0
    assert d["quality_score_delta"] == 22.0


def test_diff_quality_score_non_numeric() -> None:
    before = {"quality_score": "bad", "column_profiles": []}
    after = {"quality_score": 5.0, "column_profiles": []}
    d = diff_profile_dicts(before, after)
    assert d["quality_score_delta"] is None
