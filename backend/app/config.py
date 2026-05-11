"""Application settings."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DCC_", extra="ignore")

    api_host: str = "127.0.0.1"
    api_port: int = 8000
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    # Local DuckDB file for workspace metadata/cache (profiles, issues JSON)
    workspace_db_path: Path = Path(".dcc_workspace.duckdb")
    # Max rows returned from ad-hoc SQL
    query_max_rows: int = 10_000
    # Sample pagination
    sample_max_page_size: int = 500
    sample_default_page_size: int = 100
    # Browser uploads are copied here, then registered with DuckDB
    upload_dir: Path = Path(".dcc_uploads")
    upload_max_bytes_per_file: int = 250 * 1024 * 1024  # 250 MiB
    # Local LLM (Ollama default)
    llm_base_url: str = "http://127.0.0.1:11434"
    llm_model: str = "qwen3:4b"
    llm_timeout_seconds: float = 120.0
    llm_sql_num_predict: int = Field(default=320, ge=16, le=4096)
    llm_summary_num_predict: int = Field(default=180, ge=16, le=4096)
    llm_temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    llm_think: bool = False
    agent_context_max_columns: int = Field(default=40, ge=1, le=500)
    agent_max_rows: int = Field(default=500, ge=1, le=100_000)
    agent_sql_attempts: int = Field(default=2, ge=1, le=10)
    agent_summarize_with_llm: bool = False
    agent_summarize_max_json_chars: int = Field(default=4_000, ge=500)


def get_settings() -> Settings:
    return Settings()
