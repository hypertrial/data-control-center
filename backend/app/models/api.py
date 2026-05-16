"""Shared request/response models."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"


class ErrorEnvelope(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None
    trace_id: str


class ErrorResponse(BaseModel):
    error: ErrorEnvelope


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


class StructureConfidence(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TemporalKind(str, Enum):
    continuous_datetime = "continuous_datetime"
    discrete_period = "discrete_period"


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


class TemporalColumnInfo(BaseModel):
    name: str
    kind: TemporalKind
    confidence: StructureConfidence


class EntityIdCandidate(BaseModel):
    name: str
    confidence: StructureConfidence


class GrainKeyCandidate(BaseModel):
    columns: list[str] = Field(default_factory=list)
    uniqueness_ratio: float = 0.0
    confidence: StructureConfidence = StructureConfidence.low
    rank: int = 1


class MeasureCandidate(BaseModel):
    name: str
    score: float = 0.0
    confidence: StructureConfidence = StructureConfidence.low


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
    structure_version: str = "v2"
    temporal_columns: list[TemporalColumnInfo] = Field(default_factory=list)
    entity_id_columns: list[EntityIdCandidate] = Field(default_factory=list)
    grain_key_candidates: list[GrainKeyCandidate] = Field(default_factory=list)
    primary_grain_key_columns: list[str] = Field(default_factory=list)
    primary_temporal_column: TemporalColumnInfo | None = None
    measure_candidates: list[MeasureCandidate] = Field(default_factory=list)
    structure_warnings: list[str] = Field(default_factory=list)
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


class ProfileHistoryEntry(BaseModel):
    history_id: str
    dataset_id: str
    created_at: str
    quality_score: float | None = None
    rows: int | None = None
    columns: int | None = None
    missing_cell_pct: float | None = None


class NullPctChange(BaseModel):
    column: str
    before: float
    after: float
    delta: float


class ProfileDiffResponse(BaseModel):
    history_id_a: str
    history_id_b: str
    created_at_a: str
    created_at_b: str
    new_columns: list[str] = Field(default_factory=list)
    removed_columns: list[str] = Field(default_factory=list)
    null_pct_changes: list[NullPctChange] = Field(default_factory=list)
    quality_score_delta: float | None = None


class SavedQuery(BaseModel):
    saved_id: str
    name: str
    sql: str
    created_at: str
    updated_at: str


class SavedQueryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    sql: str = Field(..., min_length=1, max_length=500_000)


class SavedQueryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    sql: str | None = Field(default=None, min_length=1, max_length=500_000)


class AgentAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=10_000)
    dataset_ids: list[str] | None = Field(default=None)
    max_rows: int | None = Field(default=None, ge=1, le=100_000)
    conversation_id: str | None = Field(default=None)
    use_history: bool = Field(default=True)


class AgentSqlDraft(BaseModel):
    sql: str = Field(...)
    explanation: str = Field(default="")


class AgentAskResponse(BaseModel):
    answer: str | None = None
    sql: str | None = None
    explanation: str | None = None
    query_result: QueryResult | None = None
    model: str
    error: str | None = None


class AskConversation(BaseModel):
    conversation_id: str
    title: str
    dataset_ids: list[str] | None = None
    created_at: str
    updated_at: str


class AskTurn(BaseModel):
    turn_id: str
    conversation_id: str
    seq: int
    question: str
    sql: str | None = None
    explanation: str | None = None
    answer: str | None = None
    error: str | None = None
    attempts: list[dict[str, Any]] = Field(default_factory=list)
    query_result: QueryResult | None = None
    model: str | None = None
    elapsed_ms: int | None = None
    created_at: str


class AskConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    dataset_ids: list[str] | None = None


class AskConversationPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"


class JobSummary(BaseModel):
    job_id: str
    kind: str
    dataset_id: str | None = None
    status: JobStatus
    progress: float
    error_code: str | None = None
    error_message: str | None = None
    cancel_requested: bool = False
    created_at: str
    updated_at: str
    finished_at: str | None = None


class JobDetail(JobSummary):
    result: dict[str, Any] | None = None


class JobCreateResponse(BaseModel):
    job_id: str
    status: JobStatus
