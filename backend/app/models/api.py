"""Shared request/response models."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class RegisterFileRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a data file")


class RegisterFolderRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a folder")
    recursive: bool = False


class DatasetSummary(BaseModel):
    dataset_id: str
    name: str
    view_name: str
    source_path: str
    format: str
    row_count: int | None = None
    column_count: int | None = None
    file_size_bytes: int | None = None
    quality_score: int | None = None


class SemanticType(str, Enum):
    unknown = "unknown"
    id_like = "id_like"
    numeric = "numeric"
    categorical = "categorical"
    datetime = "datetime"
    boolean_like = "boolean_like"
    text = "text"


class QualitySeverity(str, Enum):
    critical = "critical"
    warning = "warning"
    info = "info"


class ColumnProfile(BaseModel):
    name: str
    physical_type: str
    semantic_type: SemanticType = SemanticType.unknown
    null_pct: float = 0.0
    unique_count: int | None = None
    cardinality: int | None = None
    min_value: str | None = None
    max_value: str | None = None
    top_values: list[dict[str, Any]] = Field(default_factory=list)
    quality_flags: list[str] = Field(default_factory=list)
    histogram: list[dict[str, Any]] | None = None


class QualityIssue(BaseModel):
    id: str
    severity: QualitySeverity
    category: str
    title: str
    description: str
    why_it_matters: str
    affected_columns: list[str] = Field(default_factory=list)
    examples: list[Any] = Field(default_factory=list)
    suggested_sql: str | None = None
    score_impact: float = 0.0


class DatasetProfile(BaseModel):
    dataset_id: str
    name: str
    rows: int
    columns: int
    file_size_bytes: int | None = None
    missing_cell_pct: float | None = None
    duplicate_row_pct: float | None = None
    numeric_column_count: int = 0
    categorical_column_count: int = 0
    datetime_column_count: int = 0
    potential_id_columns: list[str] = Field(default_factory=list)
    potential_key_columns: list[str] = Field(default_factory=list)
    quality_score: float | None = None
    narrative: str = ""
    likely_grain: str | None = None
    primary_date_column: str | None = None
    main_numeric_measures: list[str] = Field(default_factory=list)
    column_profiles: list[ColumnProfile] = Field(default_factory=list)
    quality_issues: list[QualityIssue] = Field(default_factory=list)


class QueryRequest(BaseModel):
    sql: str
    max_rows: int | None = Field(default=None, ge=1, le=100_000)


class QueryResultColumn(BaseModel):
    name: str
    type: str | None = None


class QueryResult(BaseModel):
    columns: list[QueryResultColumn]
    rows: list[dict[str, Any]]
    row_count: int
    truncated: bool = False
    error: str | None = None


class AgentAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=10_000)
    dataset_ids: list[str] | None = Field(
        default=None,
        description="If set, only these datasets are included in context",
    )
    max_rows: int | None = Field(default=None, ge=1, le=100_000)


class AgentSqlDraft(BaseModel):
    """Structured JSON output from the LLM for SQL generation."""

    sql: str = Field(..., description="Single SELECT or WITH statement for DuckDB")
    explanation: str = Field(default="", description="Brief reasoning for the query")


class AgentAskResponse(BaseModel):
    answer: str | None = None
    sql: str | None = None
    explanation: str | None = None
    query_result: QueryResult | None = None
    model: str
    error: str | None = None
