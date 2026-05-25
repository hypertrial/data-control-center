# Data Control Center — Backend

FastAPI service with a DuckDB **workspace** database (metadata, profile cache, Ask
transcripts, jobs) and **Polars** profiling of registered datasets.

Dataset HTTP routes are split under [`app/api/`](app/api/): **`datasets_upload.py`**
(upload/register), **`datasets_profile.py`** (profile, history, diff, columns, quality),
**`datasets_inspect.py`** (list/get/delete/sample), and **`datasets_jobs.py`** (shared job
helpers), aggregated by **`datasets.py`**. Profile **`GET`** is cache-only; misses return
**`PROFILE_NOT_READY`** with an active **`job_id`**. **`POST .../profile/refresh`** dedupes
queued/running profile jobs for the same dataset.

Product usage (tabs, shortcuts, Ask workflows): [`docs/user-guide.md`](../docs/user-guide.md).

## Run locally

From `backend/`:

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000
```

Using `--reload-dir app` limits Uvicorn reloads to application code so edits under `tests/`
do not restart the server (avoids `socket hang up` on the Vite `/api` proxy). From the
repo root, **`make backend`** uses the same flags.

**Validation:** run **`make check`** from the repo root. After **`backend/uv.lock`** or
**`pyproject.toml`** changes, run `cd backend && uv sync --extra dev` first. See
[`CONTRIBUTING.md`](../CONTRIBUTING.md#validation).

## Configuration

Settings are defined in [`app/config.py`](app/config.py). Every environment variable uses
the **`DCC_`** prefix (e.g. `workspace_db_path` → **`DCC_WORKSPACE_DB_PATH`**). A
commented starter list lives in [`.env.example`](../.env.example) at the repo root (copy
to `.env` only if you want a local file; the backend reads **`DCC_*`** from the process
environment).

### Local-only security

Defaults fail closed for local workstation use:

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_LOCAL_ONLY`** | `true` | Reject non-loopback clients and non-local Host/Origin/Referer |
| **`DCC_ALLOW_NON_LOCAL_HOST`** | `false` | Unsafe override; keep false in normal use |
| **`DCC_REQUIRE_LOCAL_API_TOKEN`** | `true` | Require **`X-DCC-Local-Token`** on protected routes |
| **`DCC_LOCAL_API_TOKEN`** | (generated) | Pin token for CLI scripts; else per-process token via **`GET /api/local-session`** |
| **`DCC_ENABLE_PATH_REGISTRATION`** | `false` | Enable `/api/datasets/register-file` and `register-folder` |
| **`DCC_ALLOW_ARBITRARY_REGISTRATION_PATHS`** | `false` | Allow paths outside allowed roots |
| **`DCC_REGISTRATION_ALLOWED_ROOTS`** | `[]` | Extra filesystem roots for path registration |
| **`DCC_EXPOSE_ABSOLUTE_SOURCE_PATHS`** | `false` | Include absolute paths in API responses |

Threat model: [`SECURITY.md`](../SECURITY.md).

### Uploads and path registration

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_UPLOAD_DIR`** | `.dcc_uploads` | App-owned upload copies (deleted on unregister) |
| **`DCC_UPLOAD_MAX_BYTES_PER_FILE`** | 2 GiB | Per-file size limit |
| **`DCC_UPLOAD_MAX_BATCH_BYTES`** | 2 GiB | Total batch size limit |
| **`DCC_UPLOAD_MAX_FILES_PER_BATCH`** | `50` | Files per batch |
| **`DCC_UPLOAD_VALIDATE_PARSE`** | `true` | Parser preflight on upload |
| **`DCC_UPLOAD_ORPHAN_TTL_HOURS`** | `24` | Cleanup TTL for failed upload batches |

Uploads use extension allow-listing, filename normalization, and validation before
registration. Path registration is gated by the security settings above.
Implementation: [`app/services/registry.py`](app/services/registry.py) (`ensure_registration_allowed`).

DuckDB import is also gated by **`DCC_ENABLE_PATH_REGISTRATION`** and the same allowed-root
checks. **`POST /api/datasets/duckdb/inspect`** lists tables/views in a local **`.duckdb`**
file, and **`POST /api/datasets/duckdb/import`** snapshots selected relations to app-owned
Parquet files under **`.dcc_uploads/duckdb_imports/`** before registering them as normal
datasets. Imports are snapshots, not live links to the source database.

### Workspace database

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_WORKSPACE_DB_PATH`** | `.dcc_workspace.duckdb` | Metadata DB (relative to backend cwd) |
| **`DCC_DB_READER_POOL_SIZE`** | `4` | Reader connection pool size (1–16) |

Holds cached profiles (**`structure_version: "v6"`**), profile history, **`dcc_jobs`**,
saved SQL, and Ask tables. Implementation: [`app/services/workspace.py`](app/services/workspace.py),
[`workspace_engine.py`](app/services/workspace_engine.py),
[`workspace_schema.py`](app/services/workspace_schema.py),
[`workspace_stores/`](app/services/workspace_stores/).

On open, an empty file gets **`create_workspace_schema`**; an existing file must match
expected **`dcc_*`** tables. A legacy **`schema_version`** table is dropped automatically
after validation. Incompatible layouts fail fast—see root [README — Upgrading](../README.md#upgrading--workspace-schema).

### Query and samples

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_QUERY_MAX_ROWS`** | `10000` | Max rows from ad-hoc SQL |
| **`DCC_QUERY_TIMEOUT_SECONDS`** | `8` | SQL execution timeout |
| **`DCC_SAMPLE_MAX_PAGE_SIZE`** | `500` | Max sample page size |
| **`DCC_SAMPLE_DEFAULT_PAGE_SIZE`** | `100` | Default sample page size |

### Profiling

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_PROFILE_TIMEOUT_SECONDS`** | `20` | Overall profiling time budget (enforced in prepare jobs) |
| **`DCC_PROFILE_LARGE_FILE_TIMEOUT_SECONDS`** | `120` | Minimum budget when file size exceeds heavy-scan threshold |
| **`DCC_PROFILE_FULL_METRICS_TIMEOUT_SECONDS`** | `8` | Best-effort timeout for exact full-table profile metrics before sample fallback |
| **`DCC_PROFILE_HEAVY_SCAN_MAX_BYTES`** | `268435456` | Above this size, skip full-table Polars null scan; use sample-scoped metrics |
| **`DCC_PROFILE_USE_PARQUET_METADATA_COUNT`** | `true` | Prefer Parquet metadata for row counts before DuckDB `COUNT(*)` |
| **`DCC_REGISTRATION_COUNT_TIMEOUT_SECONDS`** | `6` | Row-count timeout when metadata / prepare fast count falls back to DuckDB |
| **`DCC_PROFILE_STRUCTURE_SAMPLE_MAX_ROWS`** | `50000` | Structure inference sample cap |
| **`DCC_PROFILE_STRUCTURE_SAMPLE_MIN_ROWS`** | `5000` | Structure inference sample floor |
| **`DCC_PROFILE_STRUCTURE_MAX_KEY_CANDIDATES`** | `10` | Max columns in key search pool |
| **`DCC_PROFILE_STRUCTURE_MAX_PAIR_CHECKS`** | `40` | Max pair uniqueness checks |
| **`DCC_PROFILE_STRUCTURE_MAX_TRIPLE_CHECKS`** | `20` | Max triple uniqueness checks |
| **`DCC_PROFILE_STRUCTURE_HIGH_CONFIDENCE_THRESHOLD`** | `0.999` | High-confidence uniqueness ratio |
| **`DCC_PROFILE_STRUCTURE_MEDIUM_CONFIDENCE_THRESHOLD`** | `0.98` | Medium-confidence uniqueness ratio |

Profiles first build bounded sample-based EDA, then try exact full-table metrics for duplicate
rows, per-column uniqueness/ranges/top values, and sampled grain-key candidates. If the exact
pass times out or fails, responses keep the sample value and expose that through scope metadata
(`metric_scope`, `duplicate_row_pct_scope`, `grain_key_scope`) plus `profile_metric_warnings`.
Inference: [`app/services/profiler/`](app/services/profiler/).

### Built UI (single-server mode)

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_UI_DIST_PATH`** | (unset) | Directory with Vite `index.html` for SPA at `/` |
| **`DCC_DEV_UI_ORIGIN`** | (unset) | Local HTTP Vite origin used by `make dev` so backend `/` redirects to the dev UI |

Run from repo root: **`make serve`** for the built UI, or **`make dev`** for the
two-server development workflow. **`DCC_DEV_UI_ORIGIN`** accepts only local HTTP origins
(`localhost`, `127.0.0.1`, or `::1`).

### Local LLM (Ask)

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_LLM_BASE_URL`** | `http://127.0.0.1:11434` | Ollama-compatible endpoint |
| **`DCC_LLM_MODEL`** | `qwen3:4b` | Model name |
| **`DCC_LLM_TIMEOUT_SECONDS`** | `120` | Request timeout |
| **`DCC_LLM_SQL_NUM_PREDICT`** | `320` | Max tokens for SQL draft |
| **`DCC_LLM_SUMMARY_NUM_PREDICT`** | `180` | Max tokens for summary |
| **`DCC_LLM_TEMPERATURE`** | `0` | Sampling temperature |
| **`DCC_LLM_THINK`** | `false` | Extended thinking mode |
| **`DCC_AGENT_CONTEXT_MAX_COLUMNS`** | `40` | Columns in agent context |
| **`DCC_AGENT_MAX_ROWS`** | `500` | Max rows for agent queries |
| **`DCC_AGENT_SQL_ATTEMPTS`** | `2` | SQL retry attempts |
| **`DCC_AGENT_SUMMARIZE_WITH_LLM`** | `true` | Second LLM call for direct result answers |
| **`DCC_AGENT_SUMMARIZE_MAX_JSON_CHARS`** | `4000` | Result JSON cap for summarization |

Ask usage: [`docs/user-guide.md`](../docs/user-guide.md#ask-tab). Agent code:
[`app/services/agent/`](app/services/agent/).

## Test and lint

[`pyproject.toml`](pyproject.toml) enforces **100%** line coverage on **`app/`**.
Run **`make check`** from the repo root for CI-parity validation (ruff, pytest, frontend
checks, and build). See [`CONTRIBUTING.md`](../CONTRIBUTING.md#validation) for individual
steps and lockfile refresh guidance.
