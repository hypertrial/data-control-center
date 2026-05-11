"""Relationship heuristics."""

from __future__ import annotations

from pathlib import Path

import polars as pl
import pytest

from app.config import Settings
from app.services.relationships import (
    _jaccard_sample,
    _norm_name,
    _similar,
    find_relationships,
)
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


def test_norm_name_strips_non_alnum() -> None:
    assert _norm_name("Foo-Bar") == "foobar"


def test_similar_empty() -> None:
    assert _similar("", "a") == 0.0
    assert _similar("a", "") == 0.0


def test_similar_partial_match() -> None:
    r = _similar("hello", "hallo")
    assert 0.0 < r < 1.0


def test_find_relationships_skips_unrelated_column_names(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "a.csv").write_text("foo\n1\n")
    (tmp_path / "b.csv").write_text("bar\n2\n")
    reg.register_path(tmp_path / "a.csv")
    reg.register_path(tmp_path / "b.csv")
    assert find_relationships(reg, min_score=0.99) == []


def test_find_relationships_dtype_mismatch_very_similar_name(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "l.csv").write_text("user_id\n1\n2\n")
    (tmp_path / "r2.csv").write_text("user_id\nx\ny\n")
    reg.register_path(tmp_path / "l.csv")
    reg.register_path(tmp_path / "r2.csv")
    out = find_relationships(reg, min_score=0.1)
    assert isinstance(out, list)


def test_find_relationships_respects_min_score(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "x.csv").write_text("col_a\n1\n")
    (tmp_path / "y.csv").write_text("col_b\n9\n")
    reg.register_path(tmp_path / "x.csv")
    reg.register_path(tmp_path / "y.csv")
    assert find_relationships(reg, min_score=1.0) == []


def test_jaccard_empty() -> None:
    s1 = pl.Series("a", [])
    s2 = pl.Series("b", [1])
    assert _jaccard_sample(s1, s2) == 0.0


def test_similar_equal() -> None:
    assert _similar("x", "x") == 1.0


def test_find_relationships_empty(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    assert find_relationships(reg) == []
    ws.close()


def test_find_relationships_finds_overlap(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    a = tmp_path / "a.csv"
    b = tmp_path / "b.csv"
    a.write_text("user_id\n1\n2\n3\n")
    b.write_text("user_id\n2\n3\n4\n")
    reg.register_path(a)
    reg.register_path(b)
    out = find_relationships(reg, min_score=0.2)
    assert out
    assert any(c.left_column == "user_id" and c.right_column == "user_id" for c in out)


def test_find_relationships_dtype_mismatch_high_name_similarity(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    left = tmp_path / "l.csv"
    right = tmp_path / "r.csv"
    left.write_text("id\n1\n2\n")
    right.write_text("id\nx\ny\n")
    reg.register_path(left)
    reg.register_path(right)
    assert isinstance(find_relationships(reg), list)


def test_find_relationships_dtype_mismatch_moderate_name_similarity_skips(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "left.csv").write_text("line_id\n1\n2\n")
    (tmp_path / "right.csv").write_text("line_ref\na\nb\n")
    reg.register_path(tmp_path / "left.csv")
    reg.register_path(tmp_path / "right.csv")
    assert find_relationships(reg, min_score=0.1) == []


def test_find_relationships_sample_exception_falls_back(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    a = tmp_path / "a.csv"
    b = tmp_path / "b.csv"
    a.write_text("key_id\n1\n")
    b.write_text("key_id\n1\n")
    reg.register_path(a)
    reg.register_path(b)

    def boom(*a, **kw):  # noqa: ANN002, ANN003
        raise RuntimeError("sample")

    monkeypatch.setattr(
        "app.services.relationships._sample_column",
        boom,
    )
    find_relationships(reg)


def test_find_relationships_bad_cache_json(tmp_path: Path) -> None:
    from app.services.relationships import registry_fingerprint

    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "solo.csv").write_text("uid\n1\n")
    reg.register_path(tmp_path / "solo.csv")
    fp = registry_fingerprint(reg)
    ws.save_relationships_cache(fp, "not-json")
    out = find_relationships(reg)
    assert isinstance(out, list)


def test_find_relationships_cache_hit(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    ws = Workspace(settings)
    reg = DatasetRegistry(ws)
    (tmp_path / "solo.csv").write_text("uid\n1\n")
    reg.register_path(tmp_path / "solo.csv")
    first = find_relationships(reg)
    second = find_relationships(reg)
    assert second == first
