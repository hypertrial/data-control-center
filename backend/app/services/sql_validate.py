"""Lightweight validation for ad-hoc DuckDB SELECT/WITH queries."""

from __future__ import annotations

import re

FORBIDDEN_KEYWORDS = re.compile(
    r"\b("
    r"ATTACH|DETACH|INSTALL|LOAD\s+EXTENSION|COPY\s+DATABASE|EXPORT\s+DATABASE|"
    r"INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|"
    r"GRANT|REVOKE|CALL|EXECUTE|PRAGMA|COPY\s+FROM|IMPORT\s+DATABASE"
    r")\b",
    re.IGNORECASE | re.DOTALL,
)


def strip_sql_comments(sql: str) -> str:
    """Remove `--` line comments and `/* */` block comments (quote-aware)."""
    out: list[str] = []
    i = 0
    n = len(sql)
    in_single = False
    in_double = False
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ""

        if not in_single and not in_double:
            if ch == "-" and nxt == "-":
                i += 2
                while i < n and sql[i] not in "\r\n":
                    i += 1
                continue
            if ch == "/" and nxt == "*":
                i += 2
                while i + 1 < n and not (sql[i] == "*" and sql[i + 1] == "/"):
                    i += 1
                i = min(i + 2, n)
                continue

        if ch == "'" and not in_double:
            if in_single and i + 1 < n and sql[i + 1] == "'":
                out.append("''")
                i += 2
                continue
            in_single = not in_single
            out.append(ch)
            i += 1
            continue

        if ch == '"' and not in_single:
            if in_double and i + 1 < n and sql[i + 1] == '"':
                out.append('""')
                i += 2
                continue
            in_double = not in_double
            out.append(ch)
            i += 1
            continue

        out.append(ch)
        i += 1

    return "".join(out)


def split_sql_statements(sql: str) -> list[str]:
    """Split on semicolons not inside quoted regions."""
    parts: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(sql)
    in_single = False
    in_double = False
    while i < n:
        ch = sql[i]
        if ch == "'" and not in_double:
            if in_single and i + 1 < n and sql[i + 1] == "'":
                buf.append("''")
                i += 2
                continue
            in_single = not in_single
            buf.append(ch)
            i += 1
            continue
        if ch == '"' and not in_single:
            if in_double and i + 1 < n and sql[i + 1] == '"':
                buf.append('""')
                i += 2
                continue
            in_double = not in_double
            buf.append(ch)
            i += 1
            continue
        if not in_single and not in_double and ch == ";":
            stmt = "".join(buf).strip()
            if stmt:
                parts.append(stmt)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def blank_string_literals(sql: str) -> str:
    """Replace characters inside single-quoted literals with spaces for keyword scanning."""
    out: list[str] = []
    i = 0
    n = len(sql)
    in_single = False
    while i < n:
        ch = sql[i]
        if ch == "'" and not in_single:
            in_single = True
            out.append("'")
            i += 1
            continue
        if in_single:
            if i + 1 < n and ch == "'" and sql[i + 1] == "'":
                out.append("''")
                i += 2
                continue
            if ch == "'":
                in_single = False
                out.append("'")
                i += 1
                continue
            out.append(" ")
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def validate_workspace_sql(sql: str) -> tuple[str | None, str | None]:
    """
    Return (error_message, normalized_single_statement_sql).

    normalized_sql is comment-stripped, trimmed, trailing semicolon removed.
    """
    if not sql or not sql.strip():
        return ("SQL must not be empty.", None)

    stripped = strip_sql_comments(sql)
    statements = split_sql_statements(stripped)
    if len(statements) != 1:
        return ("Only a single SQL statement is allowed.", None)

    stmt = statements[0].strip()
    blanked = blank_string_literals(stmt)
    if FORBIDDEN_KEYWORDS.search(blanked):
        return ("SQL contains forbidden keywords for this workspace.", None)

    upper_head = stmt.lstrip().upper()
    if not (upper_head.startswith("SELECT") or upper_head.startswith("WITH")):
        return ("Only read-only SELECT queries (optionally starting with WITH) are allowed.", None)

    return (None, stmt)
