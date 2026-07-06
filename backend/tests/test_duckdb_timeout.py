from __future__ import annotations

import pytest

from app.services.duckdb_timeout import apply_statement_timeout


class _Con:
    def __init__(self, exc: Exception | None = None) -> None:
        self.exc = exc
        self.sql: list[str] = []

    def execute(self, sql: str) -> None:
        self.sql.append(sql)
        if self.exc is not None:
            raise self.exc


def test_apply_statement_timeout_uses_default_minimum() -> None:
    con = _Con()

    apply_statement_timeout(con, 0.001)

    assert con.sql == ["SET statement_timeout='100ms'"]


def test_apply_statement_timeout_allows_lower_minimum() -> None:
    con = _Con()

    apply_statement_timeout(con, 0.001, min_ms=1)

    assert con.sql == ["SET statement_timeout='1ms'"]


def test_apply_statement_timeout_ignores_unsupported_duckdb_versions() -> None:
    con = _Con(RuntimeError("unrecognized configuration parameter statement_timeout"))

    apply_statement_timeout(con, 1.0)


def test_apply_statement_timeout_reraises_unknown_errors() -> None:
    with pytest.raises(RuntimeError, match="different failure"):
        apply_statement_timeout(_Con(RuntimeError("different failure")), 1.0)
