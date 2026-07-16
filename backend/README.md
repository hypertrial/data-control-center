# Data Control Center — Backend

FastAPI service with a DuckDB **workspace** database (metadata, profile cache, Ask
transcripts, jobs, saved charts, relationship decisions) and **Polars** profiling of
registered datasets.

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
uv run python -m uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000
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
| **`DCC_REGISTRATION_ALLOWED_ROOTS`** | `[]` | Extra filesystem roots (JSON array, e.g. `'["/Volumes/Mac SSD"]'`). On macOS, the **`/Volumes/<Volume>`** that contains the backend cwd is always allowed for DuckDB local open/pick |
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

DuckDB import supports two source kinds (see **`GET /api/datasets/duckdb/capabilities`**):

| Route | Purpose |
| --- | --- |
| **`POST /api/datasets/duckdb/upload`** | Stage a small **`.duckdb`** copy under **`.dcc_uploads/duckdb_sources/{source_id}/`** |
| **`POST /api/datasets/duckdb/open-local`** | Register an on-disk **`.duckdb`** path (no copy; gated by **`DCC_ENABLE_DUCKDB_LOCAL_OPEN`**, allowed roots) |
| **`POST /api/datasets/duckdb/pick-local`** | Native OS file picker → register path (macOS: **`osascript`**; Linux: Tk when available) |
| **`POST /api/datasets/duckdb/inspect`** | List importable tables and views (`source_id`, optional **`include_row_counts`**) |
| **`POST /api/datasets/duckdb/relation-count`** | Lazy **`COUNT(*)`** for one importable table or view |
| **`POST /api/datasets/duckdb/import`** | Snapshot selected tables and views to Parquet under **`.dcc_uploads/duckdb_imports/`** |

**`POST /api/datasets/upload`** rejects **`.duckdb`** files (use the DuckDB routes). Imports are point-in-time Parquet snapshots, not live links to the source file. View export runs with DuckDB **`enable_external_access=false`** so definitions that read external files or attach other databases are blocked.

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_ENABLE_DUCKDB_LOCAL_OPEN`** | `true` | Allow **`open-local`** |
| **`DCC_ENABLE_DUCKDB_NATIVE_PICK`** | `true` | Allow **`pick-local`** (web UI routes all DuckDB imports through this when local open is enabled) |
| **`DCC_ENABLE_DUCKDB_VIEW_IMPORT`** | `true` | List and import DuckDB views (set **`false`** for table-only mode) |
| **`DCC_DUCKDB_UPLOAD_SOFT_MAX_BYTES`** | `536870912` (512 MiB) | Soft limit for **`duckdb/upload`** fallback when native pick is off |
| **`DCC_DUCKDB_INSPECT_INCLUDE_ROW_COUNTS`** | `false` | Default inspect omits per-table counts |
| **`DCC_DUCKDB_LOCAL_OPEN_TTL_HOURS`** | `24` | TTL for local-open metadata under **`duckdb_sources/local/`** |
| **`DCC_DUCKDB_IMPORT_TIMEOUT_SECONDS`** | `300` | Per-import **`COPY … TO Parquet`** timeout (large tables can take minutes) |

### Saved charts, relationships, and deletion dependencies

| Route | Purpose |
| --- | --- |
| **`GET /api/saved-charts?dataset_id=...`** | List saved charts, newest updated first |
| **`POST /api/saved-charts`** | Create a named chart with versioned JSON spec |
| **`PATCH /api/saved-charts/{chart_id}`** | Update chart metadata or spec |
| **`DELETE /api/saved-charts/{chart_id}`** | Delete a saved chart |
| **`GET /api/relationships?dataset_id=...&include_dismissed=false`** | List conservative profile-based suggestions and decisions |
| **`POST /api/relationships/{relationship_id}/verify`** | Compare bounded deterministic samples and return aggregates |
| **`PUT /api/relationships/{relationship_id}/decision`** | Confirm or dismiss explicitly |
| **`DELETE /api/relationships/{relationship_id}/decision`** | Reset to suggested status |
| **`GET /api/datasets/{dataset_id}/dependencies`** | Count saved charts and relationship decisions before deletion |

Chart specs must be positive-version JSON objects no larger than 500 KB and must name the
request dataset. Relationship verification samples at most 10,000 rows per endpoint under
the normal query timeout and never returns sampled values, source paths, or parser details.
Dataset deletion cascades saved charts and relationship decisions in application services;
saved SQL and Ask history remain separate.

### Workspace database

| Variable | Default | Purpose |
| --- | --- | --- |
| **`DCC_WORKSPACE_DB_PATH`** | `.dcc_workspace.duckdb` | Metadata DB (relative to backend cwd) |
| **`DCC_DB_READER_POOL_SIZE`** | `4` | Reader connection pool size (1–16) |

Holds cached profiles (**`structure_version: "v6"`**), profile history, **`dcc_jobs`**,
saved SQL, saved chart artifacts, relationship decisions, and Ask tables. Finished jobs are pruned to the **200** most recent terminal rows
(**`completed`**, **`failed`**, **`canceled`**) after each background job completes. Implementation: [`app/services/workspace.py`](app/services/workspace.py),
[`workspace_engine.py`](app/services/workspace_engine.py),
[`workspace_schema.py`](app/services/workspace_schema.py),
[`workspace_stores/`](app/services/workspace_stores/).

On open, an empty file gets **`create_workspace_schema`**. Compatible older workspaces are
extended idempotently with **`dcc_chart_artifacts`** and **`dcc_relationship_decisions`**
before strict validation; the obsolete **`dcc_saved_charts`** and legacy
**`schema_version`** tables are removed. The extension is forward-only and creates no
automatic backup. Downgrades require a pre-upgrade workspace copy or **`make clean-local`**.
Other incompatible layouts fail fast—see root [README — Upgrading](../README.md#upgrading--workspace-schema).

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
