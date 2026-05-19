# Data Control Center — Backend

FastAPI service with a DuckDB **workspace** database (metadata, profile cache, Ask transcripts, jobs) and **Polars** profiling of registered datasets.

Feature-level documentation (tabs, REST shapes, structure inference **v4**) is in the root [`README.md`](../README.md).

## Run locally

From `backend/`:

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000
```

Using `--reload-dir app` limits Uvicorn reloads to application code so edits under `tests/` do not restart the server (this avoids `socket hang up` errors on the Vite `/api` proxy). From the repo root, **`make backend`** uses the same flags.

## Configuration

Settings are defined in [`app/config.py`](app/config.py). Every environment variable is prefixed with **`DCC_`** (e.g. `workspace_db_path` → **`DCC_WORKSPACE_DB_PATH`**).

### Local-only security

The backend is intended for local workstation use, and defaults fail closed:

- **`DCC_LOCAL_ONLY=true`** rejects non-loopback clients and non-local `Host`, `Origin`, or `Referer` values.
- **`DCC_ALLOW_NON_LOCAL_HOST=false`** must stay false for normal use; setting it true is an unsafe override.
- **`DCC_REQUIRE_LOCAL_API_TOKEN=true`** requires **`X-DCC-Local-Token`** on protected API endpoints.
- **`DCC_LOCAL_API_TOKEN`** can pin a token for CLI scripts; otherwise a per-process token is generated and exposed only to local requests via **`GET /api/local-session`**.
- **`DCC_ENABLE_PATH_REGISTRATION=false`** disables direct file/folder path registration by default.

Uploads are the preferred ingestion path. They use filename/path normalization, extension allow-listing, per-file and total batch limits, parser preflight validation, failed-upload cleanup, and app-owned uploaded copies are deleted when their dataset is unregistered.

### Workspace database

**`DCC_WORKSPACE_DB_PATH`** (default `./.dcc_workspace.duckdb`, relative to the backend process working directory) holds cached dataset profiles (including **`structure_version`**), profile history, **`dcc_jobs`** rows, saved SQL snippets, and Ask conversation tables. Implementation: façade [`app/services/workspace.py`](app/services/workspace.py), engine [`app/services/workspace_engine.py`](app/services/workspace_engine.py), current-schema initialization/validation in [`app/services/workspace_schema.py`](app/services/workspace_schema.py), and stores in [`app/services/workspace_stores.py`](app/services/workspace_stores.py). Existing workspace DBs must match the current schema; old incompatible DBs fail fast and should be recreated.

### Structure / profiling tuning

Row-grain and entity inference live in [`app/services/profiler.py`](app/services/profiler.py). Useful knobs (all **`DCC_`** + these suffixes):

- **`PROFILE_TIMEOUT_SECONDS`** — overall profiling time budget
- **`PROFILE_STRUCTURE_SAMPLE_MAX_ROWS`** / **`PROFILE_STRUCTURE_SAMPLE_MIN_ROWS`** — sample size bounds for inference
- **`PROFILE_STRUCTURE_MAX_KEY_CANDIDATES`** — max columns in the key search pool (wide schemas)
- **`PROFILE_STRUCTURE_MAX_PAIR_CHECKS`** / **`PROFILE_STRUCTURE_MAX_TRIPLE_CHECKS`** — caps on pair/triple uniqueness checks
- **`PROFILE_STRUCTURE_HIGH_CONFIDENCE_THRESHOLD`** / **`PROFILE_STRUCTURE_MEDIUM_CONFIDENCE_THRESHOLD`** — uniqueness ratio thresholds on the sample

Profile responses expose sampling scope metadata so clients can avoid treating sampled EDA metrics as full-table facts: `ColumnProfile.metric_scope`, `DatasetProfile.duplicate_row_pct_scope`, and `DatasetProfile.grain_key_scope`.

## Test and lint

Matches [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

```bash
uv sync --extra dev
uv run ruff check app tests
uv run pytest
```

[`pyproject.toml`](pyproject.toml) fails the suite if **`app/`** line coverage drops below **100%** (`--cov-fail-under=100`). HTML coverage: `uv run pytest --cov=app --cov-report=html` → `htmlcov/index.html`.
