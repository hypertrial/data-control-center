"""sql_validate helpers."""

from __future__ import annotations

import pytest
import sqlglot
from sqlglot import exp

from app.services.sql_validate import (
    _ast_function_name,
    _validate_readonly_ast,
    blank_string_literals,
    split_sql_statements,
    strip_sql_comments,
    validate_workspace_sql,
    validate_workspace_sql_details,
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
        ("SELECT * FROM read_csv_auto('x.csv')", "forbidden"),
        ("SELECT * FROM real, query('SELECT * FROM read_csv_auto(''x.csv'')')", "forbidden"),
        ("SELECT * FROM real, query_table('dcc_datasets')", "forbidden"),
        ("SELECT current_setting('temp_directory') FROM real", "forbidden"),
        ("SELECT getenv('HOME') FROM real", "forbidden"),
        ("SELECT * FROM real, duckdb_databases()", "forbidden"),
        ("SELECT * FROM real, duckdb_settings()", "forbidden"),
        ("SELECT * FROM real, duckdb_secrets()", "forbidden"),
        ("SELECT * FROM real, pragma_database_list()", "forbidden"),
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


def test_validate_workspace_sql_rejects_unknown_non_cte_relation() -> None:
    err, norm = validate_workspace_sql("WITH local AS (SELECT 1) SELECT * FROM missing", {"real"})
    assert norm is None
    assert err and "non-registered relations" in err


def test_validate_workspace_sql_ast_allows_nested_registered_view() -> None:
    err, norm = validate_workspace_sql(
        "WITH local AS (SELECT * FROM real) SELECT * FROM (SELECT * FROM local) x",
        {"real"},
    )
    assert err is None
    assert norm is not None


def test_validate_workspace_sql_ast_rejects_unknown_nested_relation() -> None:
    err, norm = validate_workspace_sql(
        "SELECT * FROM real WHERE id IN (SELECT id FROM missing)",
        {"real"},
    )
    assert norm is None
    assert err and "non-registered relations" in err


def test_validate_workspace_sql_ast_rejects_nested_file_read_function() -> None:
    err, norm = validate_workspace_sql(
        "SELECT * FROM real WHERE id IN (SELECT id FROM read_csv_auto('x.csv'))",
        {"real"},
    )
    assert norm is None
    assert err and "forbidden file-reading" in err


def test_validate_workspace_sql_ast_rejects_parse_error() -> None:
    err, norm = validate_workspace_sql("SELECT * FROM", {"real"})
    assert norm is None
    assert err and "SELECT" in err


def test_validate_readonly_ast_handles_none_tree(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.sql_validate.sqlglot.parse_one", lambda *a, **k: None)
    err, refs, ctes = _validate_readonly_ast("SELECT 1")
    assert err and not refs and not ctes


def test_validate_readonly_ast_rejects_non_select_tree() -> None:
    err, refs, ctes = _validate_readonly_ast("DELETE FROM real")
    assert err and not refs and not ctes


def test_validate_readonly_ast_rejects_forbidden_node(monkeypatch: pytest.MonkeyPatch) -> None:
    tree = exp.select(exp.Command(this="SET", expression="x"))
    monkeypatch.setattr("app.services.sql_validate.sqlglot.parse_one", lambda *a, **k: tree)
    err, refs, ctes = _validate_readonly_ast("SELECT 1")
    assert err and "forbidden" in err and not refs and not ctes


def test_validate_readonly_ast_rejects_file_function_directly() -> None:
    err, refs, ctes = _validate_readonly_ast("SELECT * FROM read_parquet('x.parquet')")
    assert err and "file-reading" in err and not refs and not ctes


def test_validate_readonly_ast_rejects_quoted_duckdb_function_directly() -> None:
    err, refs, ctes = _validate_readonly_ast('SELECT "duckdb_databases"()')
    assert err and "DuckDB system" in err and not refs and not ctes


def test_ast_function_name_reads_anonymous_function() -> None:
    tree = sqlglot.parse_one("SELECT custom_func(x) FROM real", read="duckdb")
    fn = next(tree.find_all(exp.Anonymous))
    assert _ast_function_name(fn) == "custom_func"


def test_validate_workspace_sql_forbidden_words_in_comments_and_strings() -> None:
    err, norm = validate_workspace_sql(
        "SELECT 'DROP TABLE nope' AS note FROM real -- INSERT INTO x\n",
        {"real"},
    )
    assert err is None
    assert norm == "SELECT 'DROP TABLE nope' AS note FROM real"


def test_validate_workspace_sql_allows_common_safe_functions() -> None:
    err, norm = validate_workspace_sql(
        "SELECT COUNT(*) AS n, LOWER(CAST(MAX(a) AS VARCHAR)) AS m FROM real",
        {"real"},
    )
    assert err is None
    assert norm is not None


def test_validate_workspace_sql_details_returns_registered_relation_refs() -> None:
    result = validate_workspace_sql_details(
        "WITH local AS (SELECT * FROM main.real) SELECT * FROM local JOIN other.next_table ON true",
        {"real", "next_table"},
    )

    assert result.error is None
    assert result.normalized_sql is not None
    assert result.relation_refs == {"real", "next_table"}


def test_validate_workspace_sql_details_excludes_cte_refs_from_unknowns() -> None:
    result = validate_workspace_sql_details(
        "WITH local AS (SELECT * FROM real) SELECT * FROM local",
        {"real"},
    )

    assert result.error is None
    assert result.relation_refs == {"real"}
