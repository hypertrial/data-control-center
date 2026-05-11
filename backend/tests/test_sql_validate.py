"""sql_validate helpers."""

from __future__ import annotations

import pytest

from app.services.sql_validate import (
    blank_string_literals,
    split_sql_statements,
    strip_sql_comments,
    validate_workspace_sql,
)


def test_strip_sql_comments_line() -> None:
    sql = "SELECT 1 -- trailing\nFROM t"
    assert "FROM t" in strip_sql_comments(sql)
    assert "-- trailing" not in strip_sql_comments(sql)


def test_strip_sql_comments_block() -> None:
    sql = "SELECT /* hi */ 1"
    assert strip_sql_comments(sql).strip() == "SELECT  1"


def test_strip_sql_comments_preserves_string() -> None:
    sql = "SELECT '-- not a comment'"
    assert "'" in strip_sql_comments(sql)


def test_split_double_quoted_identifier_with_semicolon() -> None:
    parts = split_sql_statements('SELECT * FROM "bad;name"')
    assert len(parts) == 1


def test_split_two_statements() -> None:
    parts = split_sql_statements("SELECT 1; SELECT 2")
    assert parts == ["SELECT 1", "SELECT 2"]


def test_blank_string_literals() -> None:
    out = blank_string_literals("SELECT 'ATTACH' AS x")
    assert "ATTACH" not in out or out.count(" ") > 1


def test_blank_string_escape_inside_literal() -> None:
    out = blank_string_literals("SELECT 'a''b' AS x")
    assert "''" in out


def test_strip_doubled_single_quote_inside_string() -> None:
    sql = "SELECT 'x''y' -- c\nFROM t"
    s = strip_sql_comments(sql)
    assert "-- c" not in s
    assert "''" in s


def test_strip_and_split_double_quote_doubling() -> None:
    sql = 'SELECT * FROM "t""x"'
    assert '"' in strip_sql_comments(sql)
    assert len(split_sql_statements(sql)) == 1


def test_split_doubled_single_quote_inside_literal() -> None:
    parts = split_sql_statements("SELECT 'a''b' FROM t")
    assert len(parts) == 1


def test_validate_workspace_sql_accepts_with_cte() -> None:
    err, norm = validate_workspace_sql("WITH a AS (SELECT 1 AS x) SELECT x")
    assert err is None
    assert norm is not None
    assert "WITH" in norm.upper()


@pytest.mark.parametrize(
    ("sql", "expect_err"),
    [
        ("", "empty"),
        ("   ", "empty"),
        ("SELECT 1; SELECT 2", "single"),
        ("INSERT INTO t SELECT 1", "forbidden"),
        ("ATTACH 'x'", "forbidden"),
        ("DELETE FROM v_ds_001", "forbidden"),
        ("UPDATE v_ds_001 SET a=1", "forbidden"),
        ("PRAGMA table_info('x')", "forbidden"),
        ("EXPLAIN SELECT 1", "SELECT"),
    ],
)
def test_validate_workspace_sql_rejects(sql: str, expect_err: str) -> None:
    err, norm = validate_workspace_sql(sql)
    assert err
    assert norm is None
    low = err.lower()
    if expect_err == "empty":
        assert "empty" in low
    elif expect_err == "single":
        assert "single" in low
    elif expect_err == "forbidden":
        assert "forbidden" in low
    elif expect_err == "SELECT":
        assert "select" in low


def test_validate_workspace_sql_accepts_select() -> None:
    err, norm = validate_workspace_sql("SELECT 1 AS x")
    assert err is None
    assert norm == "SELECT 1 AS x"


def test_validate_workspace_sql_strips_trailing_semicolon_via_split() -> None:
    err, norm = validate_workspace_sql("SELECT 1;")
    assert err is None
    assert norm == "SELECT 1"
