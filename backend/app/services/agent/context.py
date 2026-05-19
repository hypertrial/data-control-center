"""Dataset context for the agent."""

from __future__ import annotations

from typing import Any

from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace, sanitize_sql_identifier

def _pragma_column_summaries(con: Any, view_name: str, max_cols: int = 80) -> list[str]:
    safe = sanitize_sql_identifier(view_name)
    rows = con.execute(
        f"SELECT name, type FROM pragma_table_info('{safe}') ORDER BY cid"
    ).fetchall()
    out: list[str] = []
    for name, typ in rows[:max_cols]:
        out.append(f"{name}:{typ}")
    if len(rows) > max_cols:
        out.append(f"... +{len(rows) - max_cols} more columns")
    return out


def build_dataset_context(
    registry: DatasetRegistry,
    workspace: Workspace,
    dataset_ids: list[str] | None,
    max_columns: int = 40,
) -> tuple[str | None, str | None]:
    """
    Return (context_block, error_message).

    error_message is set when no datasets match the filter.
    """
    lines: list[str] = []
    for ds in registry.list_all():
        if dataset_ids is not None and ds.dataset_id not in dataset_ids:
            continue
        prof_raw = workspace.load_profile_cache(ds.dataset_id)
        col_bits: list[str] = []
        if isinstance(prof_raw, dict):
            columns = prof_raw.get("column_profiles") or []
            for c in columns[:max_columns]:
                if isinstance(c, dict) and c.get("name"):
                    pt = c.get("physical_type", "?")
                    col_bits.append(f"{c['name']}:{pt}")
            if len(columns) > max_columns:
                col_bits.append(f"... +{len(columns) - max_columns} more columns")
        if not col_bits:
            with workspace.lock_db() as con:
                col_bits = _pragma_column_summaries(
                    con,
                    ds.view_name,
                    max_cols=max_columns,
                )
        if not col_bits:
            col_bits = ["(no columns resolved)"]
        narrative = ""
        if isinstance(prof_raw, dict) and prof_raw.get("narrative"):
            narrative = str(prof_raw["narrative"]).replace("\n", " ").strip()[:400]
        line = (
            f"- dataset_id={ds.dataset_id} view={ds.view_name!r} file={ds.source_path.name!r} "
            f"rows={ds.row_count} cols={ds.column_count}\n"
            f"  columns: {', '.join(col_bits)}"
        )
        if narrative:
            line += f"\n  summary: {narrative}"
        lines.append(line)

    if not lines:
        if dataset_ids is not None:
            return None, "No datasets available for the given dataset_ids filter."
        return None, "No datasets are registered. Add or upload a dataset first."

    return "\n".join(lines), None
