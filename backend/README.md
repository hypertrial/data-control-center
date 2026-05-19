# Data Control Center — Backend

FastAPI service with a DuckDB **workspace** database (metadata, profile cache, Ask transcripts, jobs) and **Polars** profiling of registered datasets.

Dataset HTTP routes are split under [`app/api/`](app/api/): **`datasets_upload.py`** (upload/register), **`datasets_profile.py`** (profile, history, diff, columns, quality), **`datasets_inspect.py`** (list/get/delete/sample), and **`datasets_jobs.py`** (shared job helpers), aggregated by **`datasets.py`**. Profile **`GET`** is cache-only; misses return **`PROFILE_NOT_READY`** with an active **`job_id`**. **`POST .../profile/refresh`** dedupes queued/running profile jobs for the same dataset.

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

**`DCC_WORKSPACE_DB_PATH`** (default `./.dcc_workspace.duckdb`, relative to the backend process working directory) holds cached dataset profiles (including **`structure_version`**), profile history, **`dcc_jobs`** rows, saved SQL snippets, and Ask conversation tables. Implementation: façade [`app/services/workspace.py`](app/services/workspace.py), engine [`app/services/workspace_engine.py`](app/services/workspace_engine.py), migrations in [`app/services/workspace_migrations/`](app/services/workspace_migrations/), current-schema validation in [`app/services/workspace_schema.py`](app/services/workspace_schema.py), and stores in [`app/services/workspace_stores.py`](app/services/workspace_stores.py). **`DCC_WORKSPACE_BACKUP_BEFORE_MIGRATE`** (default `true`) copies the workspace file before applying a pending migration.

On open, migrations run forward to the current version; DBs that already match the expected **`dcc_*`** tables but lack **`schema_version`** receive an implicit baseline stamp. Incompatible or newer-than-app schemas fail fast (see root README upgrading section).

### Built UI (single-server mode)

**`DCC_UI_DIST_PATH`** — when set to a directory containing a Vite **`index.html`** (for example **`../frontend/dist`** after `npm run build` in `frontend/`), FastAPI serves that bundle at **`/`** with SPA fallback, in addition to **`/api/*`**. Run from repo root: **`make serve`** (builds the frontend, then starts uvicorn with this variable). Wrong or missing paths log a warning and do not mount the UI.

### Structure / profiling tuning

Row-grain and entity inference live in [`app/services/profiler.py`](app/services/profiler.py). Useful knobs (all **`DCC_`** + these suffixes):

- **`PROFILE_TIMEOUT_SECONDS`** — overall profiling time budget
- **`PROFILE_STRUCTURE_SAMPLE_MAX_ROWS`** / **`PROFILE_STRUCTURE_SAMPLE_MIN_ROWS`** — sample size bounds for inference
- **`PROFILE_STRUCTURE_MAX_KEY_CANDIDATES`** — max columns in the key search pool (wide schemas)
- **`PROFILE_STRUCTURE_MAX_PAIR_CHECKS`** / **`PROFILE_STRUCTURE_MAX_TRIPLE_CHECKS`** — caps on pair/triple uniqueness checks
- **`PROFILE_STRUCTURE_HIGH_CONFIDENCE_THRESHOLD`** / **`PROFILE_STRUCTURE_MEDIUM_CONFIDENCE_THRESHOLD`** — uniqueness ratio thresholds on the sample

Profile responses expose sampling scope metadata so clients can avoid treating sampled EDA metrics as full-table facts: `ColumnProfile.metric_scope`, `DatasetProfile.duplicate_row_pct_scope`, and `DatasetProfile.grain_key_scope`.

## Test and lint

Matches [`.github/workflows/ci.yml`](../.github/workflows/ci.yml). From the repo root you can run **`make check`** for the same backend + frontend steps CI runs.

```bash
uv sync --extra dev
uv run ruff check app tests
uv run pytest
cd ../frontend && npm ci && npm run lint && npm test && npm run test:coverage && npm run build
```

[`pyproject.toml`](pyproject.toml) fails the suite if **`app/`** line coverage drops below **100%** (`--cov-fail-under=100`). HTML coverage: `uv run pytest --cov=app --cov-report=html` → `htmlcov/index.html`.
