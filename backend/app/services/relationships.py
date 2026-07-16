"""Conservative metadata-first dataset relationship discovery."""

from __future__ import annotations

import hashlib
import re
from typing import Any

from app.config import Settings
from app.services.duckdb_timeout import apply_statement_timeout
from app.services.registry import DatasetRegistry, RegisteredDataset
from app.services.workspace import Workspace, sanitize_sql_identifier

UNIQUE_THRESHOLD = 98.0
VERIFY_SAMPLE_ROWS = 10_000
GENERIC_NAMES = {"name", "date", "time", "value", "type", "status"}
NUMERIC_TYPES = {
    "TINYINT",
    "SMALLINT",
    "INTEGER",
    "BIGINT",
    "HUGEINT",
    "UTINYINT",
    "USMALLINT",
    "UINTEGER",
    "UBIGINT",
    "INT",
    "INT1",
    "INT2",
    "INT4",
    "INT8",
    "INT16",
    "DECIMAL",
    "NUMERIC",
    "DOUBLE",
    "FLOAT",
    "REAL",
}
TEXT_TYPES = {"VARCHAR", "CHAR", "BPCHAR", "TEXT", "STRING", "UUID"}


def _normalized_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _has_key_name_signal(name: str) -> bool:
    value = name.strip()
    lowered = value.lower()
    if lowered in {"id", "key"}:
        return True
    if re.search(r"(?:^|[^a-z0-9])(?:id|key)$", lowered):
        return True
    return bool(re.search(r"(?:Id|ID|Key)$", value))


def _type_family(physical_type: str) -> str:
    value = physical_type.upper().strip()
    base = value.split("(", 1)[0].strip()
    if base in NUMERIC_TYPES:
        return "number"
    if base in TEXT_TYPES:
        return "text"
    if base == "DATE" or base.startswith("TIME"):
        return "temporal"
    if base in {"BOOL", "BOOLEAN"}:
        return "boolean"
    return value


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _canonical_endpoints(
    left_dataset_id: str, left_column: str, right_dataset_id: str, right_column: str
) -> tuple[tuple[str, str], tuple[str, str]]:
    return tuple(sorted(((left_dataset_id, left_column), (right_dataset_id, right_column))))  # type: ignore[return-value]


def relationship_id_for(
    left_dataset_id: str, left_column: str, right_dataset_id: str, right_column: str
) -> str:
    endpoints = _canonical_endpoints(
        left_dataset_id, left_column, right_dataset_id, right_column
    )
    payload = "\x1f".join((*endpoints[0], *endpoints[1]))
    return hashlib.sha256(payload.encode()).hexdigest()[:24]


def _profile_key_names(profile: dict[str, Any]) -> set[str]:
    names = {str(name) for name in profile.get("primary_grain_key_columns") or []}
    names.update(
        str(item.get("name"))
        for item in profile.get("entity_id_columns") or []
        if isinstance(item, dict) and item.get("name")
    )
    return names


def _column_map(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(column.get("name")): column
        for column in profile.get("column_profiles") or []
        if isinstance(column, dict) and column.get("name")
    }


def _is_unique(column: dict[str, Any]) -> bool:
    value = column.get("unique_pct")
    return isinstance(value, (int, float)) and float(value) >= UNIQUE_THRESHOLD


def _cardinality(left: dict[str, Any], right: dict[str, Any]) -> str:
    left_unique, right_unique = _is_unique(left), _is_unique(right)
    if left_unique and right_unique:
        return "one_to_one"
    if left_unique:
        return "one_to_many"
    if right_unique:
        return "many_to_one"
    return "unknown"


def _verification_verdict(left_match_pct: float, right_match_pct: float, overlap: int) -> str:
    lower = min(left_match_pct, right_match_pct)
    if lower >= 80:
        return "strong"
    if lower >= 20:
        return "partial"
    return "weak" if overlap else "no_overlap"


def _endpoint(ds: RegisteredDataset, column: dict[str, Any]) -> dict[str, Any]:
    return {
        "dataset_id": ds.dataset_id,
        "dataset_name": ds.source_label,
        "view_name": ds.view_name,
        "column_name": str(column.get("name")),
        "physical_type": column.get("physical_type"),
        "semantic_type": column.get("semantic_type"),
        "unique_pct": column.get("unique_pct"),
        "metric_scope": column.get("metric_scope"),
    }


def _join_sql(left: dict[str, Any], right: dict[str, Any]) -> str:
    left_view = sanitize_sql_identifier(str(left["view_name"]))
    right_view = sanitize_sql_identifier(str(right["view_name"]))
    left_column = _quote_identifier(str(left["column_name"]))
    right_column = _quote_identifier(str(right["column_name"]))
    return (
        "SELECT *\n"
        "FROM (\n"
        f"  SELECT l.*, r.*\n  FROM {left_view} AS l\n"
        f"  INNER JOIN {right_view} AS r\n"
        f"    ON l.{left_column} = r.{right_column}\n"
        ") AS joined\nLIMIT 100;"
    )


class RelationshipService:
    def __init__(
        self, registry: DatasetRegistry, workspace: Workspace, settings: Settings
    ) -> None:
        self.registry = registry
        self.workspace = workspace
        self.settings = settings

    def list_relationships(
        self, dataset_id: str | None = None, *, include_dismissed: bool = False
    ) -> dict[str, Any]:
        datasets = self.registry.list_all()
        if dataset_id is not None and not self.registry.get(dataset_id):
            raise LookupError("Dataset not found")
        profiles: dict[str, dict[str, Any]] = {}
        pending: list[str] = []
        for dataset in datasets:
            profile = self.workspace.profiles.load_profile_cache(dataset.dataset_id)
            if isinstance(profile, dict):
                profiles[dataset.dataset_id] = profile
            else:
                pending.append(dataset.dataset_id)

        decisions = {
            row["relationship_id"]: row
            for row in self.workspace.relationship_decisions.list_decisions()
        }
        relationships: dict[str, dict[str, Any]] = {}
        for index, left_ds in enumerate(datasets):
            left_profile = profiles.get(left_ds.dataset_id)
            if not left_profile:
                continue
            left_columns = _column_map(left_profile)
            left_keys = _profile_key_names(left_profile)
            for right_ds in datasets[index + 1 :]:
                right_profile = profiles.get(right_ds.dataset_id)
                if not right_profile:
                    continue
                right_columns = _column_map(right_profile)
                right_keys = _profile_key_names(right_profile)
                for left_column in left_columns.values():
                    name = str(left_column["name"])
                    normalized = _normalized_name(name)
                    right_column = next(
                        (
                            candidate
                            for candidate in right_columns.values()
                            if _normalized_name(str(candidate["name"])) == normalized
                        ),
                        None,
                    )
                    if not right_column or not normalized:
                        continue
                    left_family = _type_family(str(left_column.get("physical_type", "")))
                    right_family = _type_family(str(right_column.get("physical_type", "")))
                    if not left_family or left_family != right_family:
                        continue
                    if not (_is_unique(left_column) or _is_unique(right_column)):
                        continue
                    left_is_key = name in left_keys
                    right_name = str(right_column["name"])
                    right_is_key = right_name in right_keys
                    key_named = _has_key_name_signal(name) or _has_key_name_signal(right_name)
                    if normalized in GENERIC_NAMES and not (left_is_key or right_is_key):
                        continue
                    if not (left_is_key or right_is_key or key_named):
                        continue
                    rid = relationship_id_for(
                        left_ds.dataset_id, name, right_ds.dataset_id, right_name
                    )
                    decision = decisions.get(rid, {}).get("status", "suggested")
                    if decision == "dismissed" and not include_dismissed:
                        continue
                    left = _endpoint(left_ds, left_column)
                    right = _endpoint(right_ds, right_column)
                    relationships[rid] = {
                        "relationship_id": rid,
                        "left": left,
                        "right": right,
                        "cardinality": _cardinality(left_column, right_column),
                        "confidence": (
                            "high"
                            if (left_is_key and _is_unique(left_column))
                            or (right_is_key and _is_unique(right_column))
                            else "medium"
                        ),
                        "reasons": [
                            "Matching column name and compatible data type",
                            "At least one side is unique",
                        ],
                        "decision": decision,
                        "availability": "ready",
                        "suggested_sql": _join_sql(left, right),
                    }

        datasets_by_id = {dataset.dataset_id: dataset for dataset in datasets}
        for rid, decision in decisions.items():
            if rid in relationships:
                continue
            if decision["status"] == "dismissed" and not include_dismissed:
                continue
            left_ds = datasets_by_id.get(decision["left_dataset_id"])
            right_ds = datasets_by_id.get(decision["right_dataset_id"])
            if dataset_id and dataset_id not in {
                decision["left_dataset_id"],
                decision["right_dataset_id"],
            }:
                continue
            left_column = (
                _column_map(profiles.get(left_ds.dataset_id, {})).get(decision["left_column"])
                if left_ds
                else None
            )
            right_column = (
                _column_map(profiles.get(right_ds.dataset_id, {})).get(decision["right_column"])
                if right_ds
                else None
            )
            ready = bool(left_ds and right_ds and left_column and right_column)
            left = (
                _endpoint(left_ds, left_column)
                if left_ds and left_column
                else {
                    "dataset_id": decision["left_dataset_id"],
                    "dataset_name": left_ds.source_label if left_ds else "Removed dataset",
                    "view_name": left_ds.view_name if left_ds else "",
                    "column_name": decision["left_column"],
                }
            )
            right = (
                _endpoint(right_ds, right_column)
                if right_ds and right_column
                else {
                    "dataset_id": decision["right_dataset_id"],
                    "dataset_name": right_ds.source_label if right_ds else "Removed dataset",
                    "view_name": right_ds.view_name if right_ds else "",
                    "column_name": decision["right_column"],
                }
            )
            relationships[rid] = {
                "relationship_id": rid,
                "left": left,
                "right": right,
                "cardinality": _cardinality(left_column or {}, right_column or {}),
                "confidence": "medium",
                "reasons": ["Saved relationship decision"],
                "decision": decision["status"],
                "availability": "ready" if ready else "stale",
                "suggested_sql": _join_sql(left, right) if ready else None,
            }

        items = [
            item
            for item in relationships.values()
            if dataset_id is None
            or dataset_id in {item["left"]["dataset_id"], item["right"]["dataset_id"]}
        ]
        if dataset_id:
            for item in items:
                if item["right"]["dataset_id"] != dataset_id:
                    continue
                item["left"], item["right"] = item["right"], item["left"]
                if item["cardinality"] == "one_to_many":
                    item["cardinality"] = "many_to_one"
                elif item["cardinality"] == "many_to_one":
                    item["cardinality"] = "one_to_many"
                if item["availability"] == "ready":
                    item["suggested_sql"] = _join_sql(item["left"], item["right"])
        items.sort(
            key=lambda item: (
                {"confirmed": 0, "suggested": 1, "dismissed": 2}[item["decision"]],
                0 if item["confidence"] == "high" else 1,
                item["relationship_id"],
            )
        )
        return {"relationships": items, "pending_dataset_ids": sorted(pending)}

    def get_relationship(self, relationship_id: str) -> dict[str, Any]:
        response = self.list_relationships(include_dismissed=True)
        relationship = next(
            (
                item
                for item in response["relationships"]
                if item["relationship_id"] == relationship_id
            ),
            None,
        )
        if relationship is None:
            raise LookupError("Relationship not found")
        return relationship

    def set_decision(self, relationship_id: str, status: str) -> dict[str, Any]:
        relationship = self.get_relationship(relationship_id)
        left, right = relationship["left"], relationship["right"]
        canonical = _canonical_endpoints(
            left["dataset_id"], left["column_name"], right["dataset_id"], right["column_name"]
        )
        self.workspace.relationship_decisions.upsert_decision(
            relationship_id,
            canonical[0][0],
            canonical[0][1],
            canonical[1][0],
            canonical[1][1],
            status,  # type: ignore[arg-type]
        )
        return self.get_relationship(relationship_id)

    def verify(self, relationship_id: str) -> dict[str, Any]:
        relationship = self.get_relationship(relationship_id)
        if relationship["availability"] != "ready":
            raise LookupError("Relationship is stale")
        left, right = relationship["left"], relationship["right"]
        left_view = sanitize_sql_identifier(left["view_name"])
        right_view = sanitize_sql_identifier(right["view_name"])
        left_column = _quote_identifier(left["column_name"])
        right_column = _quote_identifier(right["column_name"])
        sql = f"""
            WITH left_sample AS (
              SELECT {left_column} AS value
              FROM (SELECT * FROM {left_view}
                    USING SAMPLE reservoir({VERIFY_SAMPLE_ROWS} ROWS) REPEATABLE (42)) sampled
              WHERE {left_column} IS NOT NULL
            ), right_sample AS (
              SELECT {right_column} AS value
              FROM (SELECT * FROM {right_view}
                    USING SAMPLE reservoir({VERIFY_SAMPLE_ROWS} ROWS) REPEATABLE (42)) sampled
              WHERE {right_column} IS NOT NULL
            ), left_values AS (SELECT DISTINCT value FROM left_sample),
            right_values AS (SELECT DISTINCT value FROM right_sample),
            overlap AS (
              SELECT COUNT(*) AS count
              FROM left_values INNER JOIN right_values USING (value)
            )
            SELECT
              (SELECT COUNT(*) FROM left_sample),
              (SELECT COUNT(*) FROM right_sample),
              (SELECT COUNT(*) FROM left_values),
              (SELECT COUNT(*) FROM right_values),
              (SELECT count FROM overlap)
        """
        with self.workspace.read_db() as con:
            apply_statement_timeout(con, self.settings.query_timeout_seconds)
            row = con.execute(sql).fetchone()
        left_rows, right_rows, left_distinct, right_distinct, overlap = map(int, row or (0,) * 5)
        left_pct = round(overlap * 100 / left_distinct, 2) if left_distinct else 0.0
        right_pct = round(overlap * 100 / right_distinct, 2) if right_distinct else 0.0
        return {
            "relationship_id": relationship_id,
            "scope": "sample",
            "left_sample_rows": left_rows,
            "right_sample_rows": right_rows,
            "left_distinct": left_distinct,
            "right_distinct": right_distinct,
            "overlap_distinct": overlap,
            "left_match_pct": left_pct,
            "right_match_pct": right_pct,
            "verdict": _verification_verdict(left_pct, right_pct, overlap),
        }
