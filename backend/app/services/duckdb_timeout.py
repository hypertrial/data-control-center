"""Shared DuckDB statement timeout setup."""

from __future__ import annotations


def apply_statement_timeout(con: object, timeout_seconds: float, *, min_ms: int = 100) -> None:
    timeout_ms = max(min_ms, int(timeout_seconds * 1000))
    try:
        con.execute(f"SET statement_timeout='{timeout_ms}ms'")  # type: ignore[attr-defined]
    except Exception as exc:  # noqa: BLE001
        if "unrecognized configuration parameter" not in str(exc):
            raise
