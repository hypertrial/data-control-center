"""Column-name patterns and normalization for profiling."""

from __future__ import annotations

import re

CURRENT_PROFILE_STRUCTURE_VERSION = "v4"

ID_NAME_PATTERN = re.compile(
    r"(^|_)(id|key|uuid|guid|pk|sk|code)(_|$)", re.IGNORECASE
)
# Whole-column names that are commonly entity or surrogate keys (after normalization).
ENTITY_TOKEN_PATTERN = re.compile(
    r"^(pid|uid|sku|upc|ean|uuid|guid)$|"
    r"(^|_)(player|user|entity|customer|account|member|product|vendor|tenant)"
    r"_(id|key|code|no)($|_)",
    re.IGNORECASE,
)
DATE_NAME_PATTERN = re.compile(r"(date|time|timestamp|ts|dt|created|updated)", re.IGNORECASE)
DISCRETE_TIME_NAME_PATTERN = re.compile(r"(year|season|period|quarter|month|week|day)", re.IGNORECASE)


def _normalize_column_name(col: str) -> str:
    """Snake-case-ish lower name for rule matching (handles camelCase)."""
    spaced = col.strip().replace(" ", "_")
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", spaced).lower()


def _entity_name_strength(norm: str) -> int:
    """Higher means more likely an entity / identifier column by name alone."""
    if ID_NAME_PATTERN.search(norm):
        return 3
    if ENTITY_TOKEN_PATTERN.search(norm):
        return 2
    return 0
