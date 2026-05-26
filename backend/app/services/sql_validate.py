"""Validation for read-only DuckDB SQL in workspace mode."""

from __future__ import annotations

import re

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

FORBIDDEN_KEYWORDS = re.compile(
    r"\b("
    r"ATTACH|DETACH|INSTALL|LOAD\s+EXTENSION|COPY\s+DATABASE|EXPORT\s+DATABASE|"
    r"INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE|"
    r"GRANT|REVOKE|CALL|EXECUTE|PRAGMA|COPY\s+FROM|IMPORT\s+DATABASE"
    r")\b",
    re.IGNORECASE | re.DOTALL,
)

# Any source/table function beginning with read_ or known filesystem/url probes is blocked.
FORBIDDEN_SOURCE_FUNCTIONS = re.compile(
    r"\b(read_[a-z0-9_]*|glob|httpfs|parquet_scan|csv_scan|json_scan)\s*\(",
    re.IGNORECASE,
)

# DuckDB functions that can execute nested SQL, expose local metadata/secrets, or
# disclose process/filesystem details outside registered dataset views.
FORBIDDEN_DUCKDB_ESCAPE_FUNCTIONS = re.compile(
    r"\b(query|query_table|current_setting|current_settings|getenv|duckdb_[a-z0-9_]*|pragma_[a-z0-9_]*)\s*\(",
    re.IGNORECASE,
)

FROM_JOIN_PATTERN = re.compile(
    r"\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_\.]*)",
    re.IGNORECASE,
)

QUOTED_FROM_JOIN_PATTERN = re.compile(
    r"\b(?:FROM|JOIN)\s+\"([A-Za-z0-9_]+)\"",
    re.IGNORECASE,
)

CTE_NAME_PATTERN = re.compile(
    r'(?:^|,)\s*(?:"([A-Za-z0-9_]+)"|([A-Za-z_][A-Za-z0-9_]*))\s+AS\s*\(',
    re.IGNORECASE,
)

FORBIDDEN_AST_NODE_NAMES = {
    "Alter",
    "Attach",
    "Command",
    "Copy",
    "Create",
    "Delete",
    "Detach",
    "Drop",
    "Execute",
    "Insert",
    "LoadData",
    "Merge",
    "Pragma",
    "Transaction",
    "Update",
}

FORBIDDEN_TABLE_FUNCTIONS = {
    "glob",
    "httpfs",
    "parquet_scan",
    "csv_scan",
    "json_scan",
}

FORBIDDEN_DUCKDB_FUNCTIONS = {
    "current_setting",
    "current_settings",
    "getenv",
    "query",
    "query_table",
}


def strip_sql_comments(sql: str) -> str:
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


def extract_relations(sql: str) -> set[str]:
    refs: set[str] = set()
    for m in FROM_JOIN_PATTERN.finditer(sql):
        token = m.group(1).strip()
        if token:
            refs.add(token.split(".")[-1])
    for m in QUOTED_FROM_JOIN_PATTERN.finditer(sql):
        token = m.group(1).strip()
        if token:
            refs.add(token)
    return refs


def extract_cte_names(sql: str) -> set[str]:
    stripped = sql.lstrip()
    if not stripped[:4].upper().startswith("WITH"):
        return set()
    body = stripped[4:]
    names: set[str] = set()
    for match in CTE_NAME_PATTERN.finditer(body):
        name = match.group(1) or match.group(2)
        if name:
            names.add(name)
    return names


def _ast_function_name(node: exp.Expression) -> str | None:
    if isinstance(node, exp.Anonymous):
        return str(node.name).lower()
    if isinstance(node, exp.Func):
        return node.sql_name().lower()
    return None


def _extract_ast_relations(tree: exp.Expression) -> tuple[set[str], set[str]]:
    refs: set[str] = set()
    ctes: set[str] = set()
    for cte in tree.find_all(exp.CTE):
        alias = cte.alias
        if alias:
            ctes.add(alias)
    for table in tree.find_all(exp.Table):
        name = table.name
        if name:
            refs.add(name)
    return refs, ctes


def _validate_readonly_ast(sql: str) -> tuple[str | None, set[str], set[str]]:
    try:
        tree = sqlglot.parse_one(sql, read="duckdb")
    except ParseError:
        return ("Only read-only SELECT queries (optionally starting with WITH) are allowed.", set(), set())
    if tree is None:
        return ("Only read-only SELECT queries (optionally starting with WITH) are allowed.", set(), set())

    if not isinstance(tree, exp.Select | exp.SetOperation):
        return ("Only read-only SELECT queries (optionally starting with WITH) are allowed.", set(), set())

    for node in tree.walk():
        if node.__class__.__name__ in FORBIDDEN_AST_NODE_NAMES:
            return ("SQL contains forbidden keywords for this workspace.", set(), set())
        fn = _ast_function_name(node)
        if fn and (fn.startswith("read_") or fn in FORBIDDEN_TABLE_FUNCTIONS):
            return ("SQL contains forbidden file-reading or external source functions.", set(), set())
        if fn and (
            fn in FORBIDDEN_DUCKDB_FUNCTIONS
            or fn.startswith("duckdb_")
            or fn.startswith("pragma_")
        ):
            return ("SQL contains forbidden DuckDB system or dynamic SQL functions.", set(), set())

    refs, ctes = _extract_ast_relations(tree)
    return None, refs, ctes


def validate_workspace_sql(sql: str, view_names: set[str] | None = None) -> tuple[str | None, str | None]:
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
    if FORBIDDEN_SOURCE_FUNCTIONS.search(blanked):
        return ("SQL contains forbidden file-reading or external source functions.", None)
    if FORBIDDEN_DUCKDB_ESCAPE_FUNCTIONS.search(blanked):
        return ("SQL contains forbidden DuckDB system or dynamic SQL functions.", None)

    upper_head = stmt.lstrip().upper()
    if not (upper_head.startswith("SELECT") or upper_head.startswith("WITH")):
        return ("Only read-only SELECT queries (optionally starting with WITH) are allowed.", None)

    ast_err, refs, cte_names = _validate_readonly_ast(stmt)
    if ast_err:
        return (ast_err, None)
    if view_names and refs:
        unknown = {r for r in refs if r not in view_names and r not in cte_names}
        if unknown:
            return (
                f"SQL references non-registered relations: {', '.join(sorted(unknown)[:5])}.",
                None,
            )
    if view_names and not refs:
        return ("SQL must reference at least one registered dataset view.", None)

    return (None, stmt)
