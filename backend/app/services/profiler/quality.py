"""Quality issues and profile narrative."""

from __future__ import annotations

from typing import Any

from app.models.api import ColumnProfile, QualityIssue, QualitySeverity, SemanticType
from app.services.profiler.patterns import _normalize_column_name
from app.services.registry import RegisteredDataset

def _build_profile_narrative(
    ds: RegisteredDataset,
    row_count: int,
    col_count: int,
    primary_grain: list[str],
    id_column_names: list[str],
    primary_date: str | None,
    measures: list[str],
    issues: list[QualityIssue],
) -> list[str]:
    narrative_parts = [
        f"Dataset **{ds.source_path.name}** has **{row_count:,}** rows and **{col_count}** columns.",
    ]
    if primary_grain:
        if len(primary_grain) == 1:
            narrative_parts.append(f"This appears to be **one row per `{primary_grain[0]}`**.")
        else:
            joined = " + ".join(f"`{x}`" for x in primary_grain)
            narrative_parts.append(f"This appears to be one row per composite grain: **{joined}**.")
    elif id_column_names:
        narrative_parts.append(f"Likely identifier columns: {', '.join(f'`{x}`' for x in id_column_names[:5])}.")
    if primary_date:
        narrative_parts.append(f"Primary date-like column: `{primary_date}`.")
    if measures:
        narrative_parts.append(f"Main numeric fields: {', '.join(f'`{m}`' for m in measures[:5])}.")
    top_issues = sorted(issues, key=lambda x: (-_severity_order(x.severity), -x.score_impact))[:5]
    if top_issues:
        narrative_parts.append("Main quality risks: " + "; ".join(i.title for i in top_issues) + ".")
    return narrative_parts
def _severity_order(sev: QualitySeverity) -> int:
    return {QualitySeverity.critical: 3, QualitySeverity.warning: 2, QualitySeverity.info: 1}.get(
        sev, 0
    )


def _detect_quality_issues(
    ds: RegisteredDataset,
    cols: list[ColumnProfile],
    row_count: int,
    null_cells: int,
    total_cells: int,
    sample_rows: int,
    primary_grain_columns: list[str] | None = None,
) -> list[QualityIssue]:
    issues: list[QualityIssue] = []
    view = ds.view_name
    # Role-specific metrics (e.g. goalkeeper attributes) are often conditionally sparse.
    role_sparse_cols = [c for c in cols if c.name.lower().startswith("gk_") and c.null_pct >= 60]
    role_sparse_ratio = len(role_sparse_cols) / max(1, len(cols))

    if total_cells and null_cells / total_cells > 0.15:
        if cols:
            conds = " AND ".join(f'"{c.name}" IS NOT NULL' for c in cols[:8])
            sql = f"SELECT COUNT(*) FILTER (WHERE {conds}) AS complete_rows, COUNT(*) AS total FROM {view};"
        else:
            sql = None
        issues.append(
            QualityIssue(
                id=f"{ds.dataset_id}_missing_mass",
                severity=QualitySeverity.warning,
                category="missingness",
                title="High overall missingness",
                description=f"{null_cells / total_cells * 100:.1f}% of cells are null across the dataset.",
                why_it_matters="Downstream joins, metrics, and ML features may be biased or unstable.",
                affected_columns=[c.name for c in cols if c.null_pct > 15][:20],
                examples=[],
                suggested_sql=sql,
                score_impact=min(25.0, (null_cells / total_cells) * 40),
            )
        )

    grain_set = frozenset(primary_grain_columns or [])
    composite_grain = len(grain_set) > 1

    # duplicate primary candidate (sample-uniqueness vs effective rows)
    eff = min(row_count, sample_rows) if row_count else sample_rows
    for c in cols:
        if c.semantic_type == SemanticType.id_like and eff > 0:
            if composite_grain and c.name in grain_set:
                continue
            if c.unique_count is not None and c.unique_count < eff * 0.99:
                dup_pct = (1 - c.unique_count / eff) * 100
                issues.append(
                    QualityIssue(
                        id=f"{ds.dataset_id}_dup_{c.name}",
                        severity=QualitySeverity.critical,
                        category="keys",
                        title=f"Duplicate values in likely key column `{c.name}`",
                        description=f"Column `{c.name}` has ~{dup_pct:.2f}% non-unique values in the profiled sample.",
                        why_it_matters="If this is a primary key, the table grain may not be what you expect.",
                        affected_columns=[c.name],
                        examples=[v.get("value") for v in c.top_values[:3]],
                        suggested_sql=f'SELECT "{c.name}", COUNT(*) AS n FROM {view} GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 20;',
                        score_impact=min(35.0, dup_pct / 2),
                    )
                )

    for c in cols:
        if c.null_pct > 25:
            sev = QualitySeverity.warning
            score_impact = min(15.0, c.null_pct / 3)
            why = "May indicate ingestion gaps or optional fields that need business rules."
            if c.name.lower().startswith("gk_") and role_sparse_ratio >= 0.08:
                sev = QualitySeverity.info
                score_impact = min(4.0, c.null_pct / 10)
                why = "Likely role-specific metric with expected sparsity for non-goalkeepers."
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_miss_{c.name}",
                    severity=sev,
                    category="missingness",
                    title=f"High null rate in `{c.name}`",
                    description=f"{c.null_pct:.1f}% values are null.",
                    why_it_matters=why,
                    affected_columns=[c.name],
                    examples=[],
                    suggested_sql=f'SELECT COUNT(*) FILTER (WHERE "{c.name}" IS NULL) AS nulls FROM {view};',
                    score_impact=score_impact,
                )
            )
        if "constant_column" in c.quality_flags:
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_const_{c.name}",
                    severity=QualitySeverity.info,
                    category="variance",
                    title=f"Constant or near-constant column `{c.name}`",
                    description="All sampled values are the same.",
                    why_it_matters="Low information columns can often be dropped from modeling or dashboards.",
                    affected_columns=[c.name],
                    examples=[c.top_values[0]["value"]] if c.top_values else [],
                    suggested_sql=f'SELECT DISTINCT "{c.name}" FROM {view};',
                    score_impact=2.0,
                )
            )
        if c.semantic_type == SemanticType.categorical and c.cardinality and c.cardinality > 200:
            issues.append(
                QualityIssue(
                    id=f"{ds.dataset_id}_hicard_{c.name}",
                    severity=QualitySeverity.info,
                    category="cardinality",
                    title=f"High-cardinality categorical `{c.name}`",
                    description=f"~{c.cardinality} distinct values in sample.",
                    why_it_matters="May need grouping, hashing, or feature engineering for ML.",
                    affected_columns=[c.name],
                    examples=[],
                    suggested_sql=f'SELECT "{c.name}", COUNT(*) AS n FROM {view} GROUP BY 1 ORDER BY n DESC LIMIT 20;',
                    score_impact=3.0,
                )
            )

    return issues
