"""Pure profile JSON diff helpers (no I/O)."""

from __future__ import annotations

from typing import Any


def _col_map(prof: dict[str, Any]) -> dict[str, dict[str, Any]]:
    cols = prof.get("column_profiles") or []
    return {str(c.get("name")): c for c in cols if isinstance(c, dict) and c.get("name")}


def diff_profile_dicts(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    cb, ca = _col_map(before), _col_map(after)
    new_columns = sorted(set(ca) - set(cb))
    removed_columns = sorted(set(cb) - set(ca))
    null_pct_changes: list[dict[str, Any]] = []
    for name in sorted(set(cb) & set(ca)):
        a = float(cb[name].get("null_pct") or 0)
        b = float(ca[name].get("null_pct") or 0)
        if a != b:
            null_pct_changes.append(
                {"column": name, "before": a, "after": b, "delta": round(b - a, 6)}
            )
    qb = before.get("quality_score")
    qa = after.get("quality_score")
    quality_delta: float | None = None
    if qb is not None and qa is not None:
        try:
            quality_delta = float(qa) - float(qb)
        except (TypeError, ValueError):
            quality_delta = None
    return {
        "new_columns": new_columns,
        "removed_columns": removed_columns,
        "null_pct_changes": null_pct_changes,
        "quality_score_delta": quality_delta,
    }
