"""Shared helpers for workspace persistence stores."""

from __future__ import annotations

import json
from typing import Any


def iso_ts(value: Any) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def json_dict_or_none(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        return None
    return None


def record_exists(con: Any, table: str, id_col: str, id_val: str) -> bool:
    row = con.execute(
        f"SELECT {id_col} FROM {table} WHERE {id_col} = ?",
        [id_val],
    ).fetchone()
    return row is not None


def apply_partial_update(
    con: Any,
    table: str,
    id_col: str,
    id_val: str,
    fields: dict[str, Any],
) -> None:
    patch = {key: value for key, value in fields.items() if value is not None}
    if not patch:
        return
    sets = ["updated_at = now()"]
    vals: list[Any] = []
    for col, val in patch.items():
        if col == "name":
            val = str(val).strip()
        sets.append(f"{col} = ?")
        vals.append(val)
    vals.append(id_val)
    con.execute(f"UPDATE {table} SET {', '.join(sets)} WHERE {id_col} = ?", vals)
