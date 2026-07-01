"""Shared request/response models."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LlmHealth(BaseModel):
    """Reachability of the configured local LLM (Ollama-compatible) endpoint."""

    reachable: bool
    model: str
    detail: str | None = None


class LlmModelInfo(BaseModel):
    """A locally installed Ollama model as reported by /api/tags."""

    name: str
    modified_at: str | None = None
    size: int | None = None


class LlmModelsResponse(BaseModel):
    """Local Ollama model listing for Ask model selection."""

    default_model: str
    models: list[LlmModelInfo] = Field(default_factory=list)
    reachable: bool
    detail: str | None = None


class HealthResponse(BaseModel):
    status: str = "ok"
    llm: LlmHealth


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


class DuckDbCapabilitiesResponse(BaseModel):
    local_open_enabled: bool
    upload_soft_max_bytes: int
    inspect_include_row_counts_default: bool
    native_pick_enabled: bool
    view_import_enabled: bool


class DuckDbSourceResponse(BaseModel):
    source_id: str
    filename: str
    source_kind: str = Field(..., description="upload or local")


class DuckDbOpenLocalRequest(BaseModel):
    path: str = Field(..., description="Absolute path to a local .duckdb file")


class DuckDbInspectRequest(BaseModel):
    source_id: str = Field(..., description="DuckDB source id from upload or open-local")
    include_row_counts: bool = False


class DuckDbRelationRef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_name: str = Field(..., alias="schema")
    name: str
    alias: str | None = Field(default=None, max_length=200)


class DuckDbImportRequest(BaseModel):
    source_id: str = Field(..., description="DuckDB source id from upload or open-local")
    relations: list[DuckDbRelationRef] = Field(default_factory=list, min_length=1, max_length=100)


class DuckDbRelationCountRequest(BaseModel):
    source_id: str
    schema_name: str = Field(..., alias="schema")
    name: str


class DuckDbRelationCountResponse(BaseModel):
    row_count: int | None = None


class DuckDbRelationSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_name: str = Field(..., alias="schema")
    name: str
    type: str
    column_count: int
    row_count: int | None = None


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


class MetricScope(str, Enum):
    full = "full"
    sample = "sample"


class StructureConfidence(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class TemporalKind(str, Enum):
    continuous_datetime = "continuous_datetime"
    discrete_period = "discrete_period"


class HistogramBin(BaseModel):
    lower_bound: float | None = None
    upper_bound: float | None = None
    left_closed: bool = False
    right_closed: bool = True
    count: int
    pct_non_null: float


class ColumnProfile(BaseModel):
    name: str
    physical_type: str
    semantic_type: SemanticType = SemanticType.unknown
    null_pct: float = 0.0
    non_null_count: int | None = None
    null_count: int | None = None
    unique_count: int | None = None
    unique_pct: float | None = None
    cardinality: int | None = None
    min_value: str | None = None
    max_value: str | None = None
    mean_value: str | None = None
    std_value: str | None = None
    median_value: str | None = None
    p25_value: str | None = None
    p75_value: str | None = None
    top_value: str | None = None
    top_count: int | None = None
    top_pct: float | None = None
    top_values: list[dict[str, Any]] = Field(default_factory=list)
    quality_flags: list[str] = Field(default_factory=list)
    histogram: list[HistogramBin] | None = None
    metric_scope: MetricScope = MetricScope.full


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
    profiler_sample_rows: int = Field(
        default=0,
        description="Rows included in per-column EDA stats (sample head; equals full rows when small).",
    )
    file_size_bytes: int | None = None
    missing_cell_pct: float | None = None
    duplicate_row_pct: float | None = None
    duplicate_row_pct_scope: MetricScope | None = None
    profile_metric_warnings: list[str] = Field(default_factory=list)
    numeric_column_count: int = 0
    categorical_column_count: int = 0
    datetime_column_count: int = 0
    quality_score: float | None = None
    narrative: str = ""
    likely_grain: str | None = None
    main_numeric_measures: list[str] = Field(default_factory=list)
    structure_version: str = "v6"
    grain_key_scope: MetricScope = MetricScope.full
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
    description: str | None = None
    created_at: str
    updated_at: str


class SavedQueryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    sql: str = Field(..., min_length=1, max_length=500_000)
    description: str | None = Field(default=None, max_length=5_000)


class SavedQueryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    sql: str | None = Field(default=None, min_length=1, max_length=500_000)
    description: str | None = Field(default=None, max_length=5_000)


class AgentAskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=10_000)
    dataset_ids: list[str] | None = Field(default=None)
    max_rows: int | None = Field(default=None, ge=1, le=100_000)
    conversation_id: str | None = Field(default=None)
    use_history: bool = Field(default=True)
    model: str | None = Field(default=None, min_length=1, max_length=200)


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
