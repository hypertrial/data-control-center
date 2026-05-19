# Data Control Center

**Local-first tool** for **profiling, exploring, and querying many local data files** (CSV, TSV, Parquet, JSON, JSON Lines) from one interface. It targets **a single trusted workstation**: developers and analysts who want fast EDA and ad-hoc DuckDB SQL—not a hosted BI server or multi-tenant product. See [Local-only security model](#local-only-security-model) and [`SECURITY.md`](SECURITY.md).

## Quick start (no LLM required)

1. From the repo root: `make install` then `make dev` (requires **bash** for the combined dev command; see [Platform notes](#platform-notes)).
2. Open **`http://127.0.0.1:5173`**, upload the tiny files in [`examples/`](examples/) (or follow [`docs/5-minute-tour.md`](docs/5-minute-tour.md)).
3. Use **Overview**, **Columns**, **SQL**, etc. **Ask** is optional and needs [Ollama](https://ollama.com); the app shows a banner on **Ask** if the LLM endpoint is unreachable. Full setup: [Local LLM assistant](#local-llm-assistant-ask-tab).

## Platform notes

- **macOS** — primary platform; Node 22+, Python 3.11+, `uv`, and optional Ollama per [Prerequisites](#prerequisites).
- **Linux** — same `make` targets; install Node and `uv` from distro or upstream docs.
- **Windows** — use **WSL2** (e.g. Ubuntu) and the Linux flow. Native Windows without WSL is untested.

## Single-server mode (API serves the built UI)

For a **single process** on port **8000** (no Vite dev server):

```bash
make serve
```

Then open **`http://127.0.0.1:8000`**. This builds `frontend/dist` and sets **`DCC_UI_DIST_PATH`** for the backend. Day-to-day development is still **`make dev`** (Vite on **5173** + API on **8000**).

## Upgrading / workspace schema

Workspace state lives in **`DCC_WORKSPACE_DB_PATH`** (default **`.dcc_workspace.duckdb`**): cached profiles (**`structure_version: "v4"`** only), Ask conversations, jobs, saved SQL, etc. On first open the app creates the **`dcc_*`** tables from [`backend/app/services/workspace_schema.py`](backend/app/services/workspace_schema.py); there is **no** in-place migration from older workspace files.

**Breaking:** after pulling a release that changes workspace layout or profile shape, run **`make clean-local`** (destructive to app-owned state) or delete the workspace DuckDB file by hand. That **does not** remove your original data files—only app metadata, profiles, Ask history, and uploaded **copies** under **`.dcc_uploads/`** when you use `clean-local`.

If startup fails with an **unsupported workspace schema** error (for example a leftover **`schema_version`** table from a pre-migration build), use **`make clean-local`** and re-register datasets. Profile cache entries that are not **`v4`** are invalidated automatically on the next profile read.

## API reference (OpenAPI)

With the backend running locally, interactive docs are at **`http://127.0.0.1:8000/docs`** (Swagger UI). **`GET /api/health`** includes a short **`llm`** reachability probe for the configured Ollama endpoint.

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React + Vite + TypeScript, TanStack Query/Table, Zustand, ECharts, Tailwind + shadcn-style primitives
- **Backend** ([`backend/`](backend/)): FastAPI + DuckDB (views + profile cache) + Polars profiling

## Documentation map

- **Backend** (run, tests, workspace DB, profiling env knobs): [`backend/README.md`](backend/README.md)
- **Frontend** (Vite proxy, layout, TanStack keys, coverage): [`frontend/README.md`](frontend/README.md)
- **Five-minute tour** (safe example upload workflow): [`docs/5-minute-tour.md`](docs/5-minute-tour.md)
- **Contributing** (developer workflow and validation): [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Security policy** (local-only threat model and reporting): [`SECURITY.md`](SECURITY.md)

## Prerequisites

- **Node** — use **22 LTS** or **24+** to avoid install noise (see [`.nvmrc`](.nvmrc)). **Node 23** works, but ESLint 10’s `engines` field doesn’t list it, so `npm install` may print **`EBADENGINE` warnings**; those are safe to ignore.
  - **Version managers:** [fnm](https://github.com/Schniz/fnm) (`brew install fnm` then follow shell setup; `fnm install && fnm use`), or install [nvm](https://github.com/nvm-sh/nvm) if you prefer it.
  - **Without a version manager (macOS):** install 22 LTS from [nodejs.org](https://nodejs.org/), or e.g. `brew install node@22` and put it on your `PATH` (see `brew info node@22`).
- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/)

## Run locally

### One command (Makefile)

**Run Make from the repository root** — the folder that contains [`Makefile`](Makefile), `backend/`, and `frontend/` (not inside `backend/` or `frontend/`).

```bash
cd /path/to/data-control-center   # your clone
make install   # first time
make dev       # API + UI; Ctrl+C stops both
```

Bare `make` prints the same as `make help`. Needs **bash** for `make dev` (default on macOS/Linux).

If **`frontend/node_modules`** is missing, **`make dev`** and **`make frontend`** run **`npm install`** in **`frontend/`** once (tracked via the Vite binary) so you do not hit **`vite: command not found`**. **`make install`** is still recommended for a first-time setup because it also syncs the backend with **`uv`**.

Other targets: `make help`, `make backend`, `make frontend`, `make build-ui`, `make serve`, `make check`, `make clean-local`.

`make clean-local` deletes local app state and generated artifacts, including
workspace DuckDB files, upload copies, coverage output, build output, and Python
caches. Run it only when you intentionally want to discard local state.

**From repo root**, [`package.json`](package.json) delegates to **`frontend/`**: **`npm run dev`**, **`npm run lint`**, **`npm test`**, **`npm run build`**. You still need the API when running the UI (`make backend` in another terminal, or **`make dev`** for both).

### Two terminals (manual)

**Terminal 1 — API**

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000
```

**Terminal 2 — UI**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to the backend.

## Usage notes

- To evaluate the app without private data, use the tiny synthetic fixtures in
  [`examples/`](examples/) and follow the [`five-minute tour`](docs/5-minute-tour.md).
- In the **web UI**, add datasets by **uploading files** (drag-and-drop or folder selection). The API stores copies under **`.dcc_uploads/`** (relative to the backend cwd unless overridden), validates them, then registers them; tune size limits with **`DCC_UPLOAD_MAX_BYTES_PER_FILE`** (default 256 MiB), **`DCC_UPLOAD_MAX_BATCH_BYTES`**, and **`DCC_UPLOAD_MAX_FILES_PER_BATCH`**.
- Direct API registration from **absolute file paths** or folders is disabled by default. Enable **`DCC_ENABLE_PATH_REGISTRATION=true`** only for advanced local workflows, and keep **`DCC_REGISTRATION_ALLOWED_ROOTS`** narrow.
- DuckDB creates one internal **view per dataset** whose SQL name is derived from the **file stem** (e.g. `player_ratings_2006_2026.parquet` → `player_ratings_2006_2026`). If two files share the same stem, the later registration gets a suffix such as `ratings_ds_002`. Reserved SQL-like names get a `_dcc` suffix. **`GET /api/datasets`** includes **`view_name`** on each summary so the UI can quote it correctly. Ad-hoc SQL must reference at least one registered view when datasets exist.
- Remove a dataset from the sidebar trash action or **`DELETE /api/datasets/{dataset_id}`**. This unregisters the dataset, drops its DuckDB view, clears cached profile state, and deletes app-owned uploaded copies. Externally registered source files are never deleted.
- In the **SQL** tab, **⌘+Enter** (macOS) or **Ctrl+Enter** runs the current query (same as **Run query**). The **results** pane is a spreadsheet-style grid: **sortable** columns, **resizable** widths, sticky **#** row index, drag or **Shift+arrow** multi-cell selection, **⌘/Ctrl+C** to copy as **TSV**, plus **Copy JSON**, **Export CSV**, and **double-click** a cell for the full value. Result sets above **200** rows use **virtualized** scrolling for responsiveness.
- In the **Ask** tab, **⌘+Enter** (macOS) or **Ctrl+Enter** submits the question (same as **Ask (stream)**). **Esc** stops an in-flight stream. Chats are **persisted** in the workspace DuckDB (see below).
- **Ask conversations** are stored in the workspace DB (`DCC_WORKSPACE_DB_PATH`, default `./.dcc_workspace.duckdb`): tables **`dcc_ask_conversations`** and **`dcc_ask_turns`** (question, SQL attempts, executed SQL, capped result preview, answer, model, timings, dataset scope). REST: **`GET/POST /api/ask/conversations`**, **`PATCH/DELETE /api/ask/conversations/{id}`**, **`GET /api/ask/conversations/{id}/turns`**, **`DELETE /api/ask/conversations/{id}/turns/{turn_id}`**. Send **`conversation_id`** (and optional **`use_history`**, default true) on **`POST /api/agent/ask/stream`** so turns append to that chat and prior turns are included in the LLM context (bounded to recent turns).
- **Ask streaming** SSE events include: `meta`, `stage` (`context` · `draft_sql` · `execute` · `retry` · `summarize`), `sql_attempt`, `sql`, `query_result`, `token`, `answer`, `timing` (`total_ms`), `turn` (`turn_id`, `conversation_id`, `seq`), `error`, `done`.
- Profiles and quality issues are cached in `DCC_WORKSPACE_DB_PATH` (default `./.dcc_workspace.duckdb` relative to the backend process cwd).
- **Upload and path registration** queue both a **row-count** job and a **profile refresh** job. **`GET /api/datasets/{dataset_id}/profile`** is **cache-only**: on a miss it returns **404** with error code **`PROFILE_NOT_READY`** and **`details.job_id`** (an active or newly queued profile job). Poll **`GET /api/jobs/{job_id}`** until **`completed`**, then retry the profile GET. The UI uses **`useDatasetProfile`** / **`api.fetchDatasetProfile`** for this flow.
- **`POST /api/datasets/{dataset_id}/profile/refresh`** queues a **profile refresh** job (deduped when one is already **queued** or **running**) and returns **`{ job_id, status: "queued" }`**. Poll **`GET /api/jobs/{job_id}`** (or list **`GET /api/jobs`**) for **`completed`**, **`failed`**, or **`canceled`**; results and errors surface there, and the workspace **`dcc_jobs`** table mirrors the same state.
- **`GET /api/datasets/{dataset_id}/sample`** maps DuckDB failures to structured error codes (for example **`SQL_TIMEOUT`**, **`NOT_FOUND`**) without leaking view names or local paths.
- **`GET /api/datasets`** responses may include an optional **`quality_score`** (0–100) on each dataset when a cached profile exists for that id.
- Profile structure inference is **composite-aware**: the API now detects likely multi-column row grain keys (e.g. `player_id + year`), discrete temporal axes (such as integer `year` / `season`), **entity identifiers** (separate from row grain—names like `player_id` / `playerId` / short keys like `pid`), and ranked measure candidates with confidence labels. Cached profiles include **`structure_version: "v4"`**; stale cache entries from unsupported profile schema versions require a profile refresh or workspace DB recreation.
- Profile metrics distinguish **full-table** facts from **sampled** estimates. Row/null counts remain full-table, while high-cardinality metrics such as uniqueness, cardinality, top values, histograms, duplicate-row percentage, and grain-key inference include scope metadata (`metric_scope`, `duplicate_row_pct_scope`, `grain_key_scope`) and the UI labels sampled metrics using `profiler_sample_rows`.
- The **Overview → Structure** card labels **Entities** vs **grain columns** vs **Row grain** (chips) so entity IDs are not confused with the composite row key.
- **`GET /api/datasets/{dataset_id}/sample`** includes **`total_rows`** before `LIMIT` / `OFFSET`: it uses the stored **`row_count`** when known, otherwise runs a bounded **`COUNT(*)`** on the dataset view (so paging metadata stays accurate even when counts were deferred at registration).
- Profile refreshes are retained as recent snapshots. Use **`GET /api/datasets/{dataset_id}/profile/history`** to list them and **`GET /api/datasets/{dataset_id}/profile/diff`** to compare the latest two snapshots.
- Saved SQL snippets are persisted in the workspace DB via **`/api/saved-queries`** and are available from the SQL tab and command palette.
- Global UI shortcuts: **⌘/Ctrl+K** opens the command palette, **?** opens the shortcuts sheet, **/** focuses dataset search, **g o/c/q/s/a/y** jumps to Overview/Columns/Quality/Samples/Ask/SQL, and **r** refreshes cached queries.

## Local-only security model

Data Control Center is hardened for **local workstation use only**. By default the backend:

- accepts only loopback/local requests (**`DCC_LOCAL_ONLY=true`**, **`DCC_ALLOW_NON_LOCAL_HOST=false`**);
- rejects non-local `Host`, `Origin`, `Referer`, or client addresses;
- generates a per-process local API token unless **`DCC_LOCAL_API_TOKEN`** is set;
- requires **`X-DCC-Local-Token`** for protected API endpoints (**`DCC_REQUIRE_LOCAL_API_TOKEN=true`**);
- lets the browser frontend bootstrap that token from **`GET /api/local-session`** only from local requests.

For CLI/API scripts, either call **`GET /api/local-session`** locally or start the backend with **`DCC_LOCAL_API_TOKEN=<token>`** and send **`X-DCC-Local-Token: <token>`**. Do not expose the backend on a LAN or public interface unless you also accept the unsafe local-only override risk.

This is not a hosted application security model:

- Do not use it for production, multi-user, shared-network, or public deployments.
- The local API token is not user authentication, authorization, tenancy, or a
  remote access control layer.
- Uploaded and registered datasets can contain sensitive local files.
- `.dcc_workspace.duckdb` and `.dcc_uploads/` are private local data. Back up,
  retain, or delete them according to your own local data policies.

Report security vulnerabilities through GitHub private vulnerability reporting;
do not open public issues for suspected vulnerabilities.

## Security and registration paths

Path-based dataset registration is gated by [`backend/app/config.py`](backend/app/config.py) (all env vars prefixed **`DCC_`**):

- **`DCC_ENABLE_PATH_REGISTRATION`** — when **`false`** (default), `/api/datasets/register-file` and `/api/datasets/register-folder` are disabled.
- **`DCC_ALLOW_ARBITRARY_REGISTRATION_PATHS`** — when **`false`** (default), registration rejects paths outside the allowed roots below.
- **`DCC_REGISTRATION_ALLOWED_ROOTS`** — extra filesystem roots (in addition to the resolved **`DCC_UPLOAD_DIR`**) from which path registration is permitted.
- **`DCC_EXPOSE_ABSOLUTE_SOURCE_PATHS`** — whether API responses include absolute source paths.

Upload ingestion also enforces extension allow-listing, filename normalization, per-file and batch size limits, optional parser preflight validation (**`DCC_UPLOAD_VALIDATE_PARSE=true`**), and cleanup of stale failed-upload batches via **`DCC_UPLOAD_ORPHAN_TTL_HOURS`**.

Implementation: [`backend/app/services/registry.py`](backend/app/services/registry.py) (`ensure_registration_allowed`).

<a id="local-llm-assistant-ask-tab"></a>

## Local LLM assistant (Ask tab)

- Install **[Ollama](https://ollama.com)** on macOS (download from the site, or e.g. `brew install ollama` if you use Homebrew).
- Pull a model (default used by the app is **`qwen3:4b`**):

  ```bash
  ollama pull qwen3:4b
  ```

  For a larger, often more capable model, install **`qwen3:8b`** and set **`DCC_LLM_MODEL=qwen3:8b`** when starting the backend.
- Keep the Ollama app/daemon running, then run **`make dev`** as usual. Open the **Ask** tab, type a question in plain language, and optional **max_rows** for the result preview.
- The backend calls Ollama at **`DCC_LLM_BASE_URL`** (default `http://127.0.0.1:11434`), asks the model for a single read-only **`SELECT`/`WITH`** statement, runs it through the same validation and row limits as **`POST /api/query`**, and returns a concise local answer from the executed result. Set **`DCC_AGENT_SUMMARIZE_WITH_LLM=true`** if you prefer a second model call to summarize the result. Generated SQL can be opened in the **SQL** tab.
- Useful **Ask / LLM** settings (see [`backend/app/config.py`](backend/app/config.py); env names use the **`DCC_`** prefix): **`DCC_LLM_BASE_URL`**, **`DCC_LLM_MODEL`**, **`DCC_LLM_TIMEOUT_SECONDS`**, **`DCC_LLM_SQL_NUM_PREDICT`**, **`DCC_LLM_SUMMARY_NUM_PREDICT`**, **`DCC_LLM_TEMPERATURE`**, **`DCC_LLM_THINK`**. **Agent** knobs: **`DCC_AGENT_CONTEXT_MAX_COLUMNS`**, **`DCC_AGENT_MAX_ROWS`**, **`DCC_AGENT_SQL_ATTEMPTS`**, **`DCC_AGENT_SUMMARIZE_WITH_LLM`**, **`DCC_AGENT_SUMMARIZE_MAX_JSON_CHARS`**. The default Ask path keeps prompts and generated answers bounded for responsive local inference.
- **HTTP API:** `POST /api/agent/ask/stream` with JSON body **`{ "question": "...", "dataset_ids": ["ds_001"] | null, "max_rows": 200, "conversation_id": "<optional>", "use_history": true }`**. The UI creates or selects a conversation and sends **`conversation_id`** so turns are saved; **`use_history`** includes recent prior turns in the agent prompt. The response is Server-Sent Events: `meta`, `stage`, `sql_attempt`, `sql`, `query_result`, `token`, `answer`, `timing`, `turn`, `error`, `done`.
- **CI** does not run Ollama; backend tests **mock** the LLM HTTP calls.

## Tests

### Backend & frontend (local)

```bash
cd backend && uv sync --extra dev && uv run pytest
cd frontend && npm install && npm test
```

For **parity with CI**, run **`make check`** from the repo root, or individually: `uv run ruff check app tests` in `backend/` and `npm run lint`, `npm test`, `npm run test:coverage`, and **`npm run build`** in `frontend/` (see below).

### CI (GitHub Actions)

On push and pull requests to **`main`** / **`master`**, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs:

- **Backend:** `uv sync --extra dev`, `uv run ruff check app tests`, `uv run pytest`
- **Frontend:** `npm ci`, `npm run lint`, `npm test`, `npm run test:coverage`, `npm run build`

Additional scheduled security automation runs CodeQL, npm audit, pip-audit, and
gitleaks history scanning. Renovate is configured for npm, GitHub Actions, and
Python dependency updates.

### Coverage

Backend tests run with **pytest-cov** via defaults in [`backend/pyproject.toml`](backend/pyproject.toml): the suite fails if **`app/`** drops below **100%** line coverage (`--cov-fail-under=100`). For a local HTML report, run `uv run pytest --cov=app --cov-report=html` and open `backend/htmlcov/index.html`.

Frontend tests use **Vitest + v8** with thresholds in [`frontend/vitest.config.ts`](frontend/vitest.config.ts): lines and statements must meet the **`COVERAGE_BASELINE`** (**85%**); excluded paths are listed there (e.g. bootstrap-only files). Raise toward 100% as more branches gain tests.

```bash
cd backend && uv run pytest
cd frontend && npm run test:coverage
```

## Maintenance notes

- **Frontend SQL helpers:** [`frontend/src/lib/sql.ts`](frontend/src/lib/sql.ts)
- **ECharts lifecycle hook:** [`frontend/src/hooks/useDisposableEChart.ts`](frontend/src/hooks/useDisposableEChart.ts)
- **Workspace metadata (profile cache + job rows):** façade in [`backend/app/services/workspace.py`](backend/app/services/workspace.py), low-level engine in [`backend/app/services/workspace_engine.py`](backend/app/services/workspace_engine.py), schema init/validation in [`backend/app/services/workspace_schema.py`](backend/app/services/workspace_schema.py), focused stores in [`backend/app/services/workspace_stores.py`](backend/app/services/workspace_stores.py)
- **Local LLM agent (Ollama client + prompts):** [`backend/app/services/agent.py`](backend/app/services/agent.py)

## Known limitations (MVP)

- Excel and remote files are not supported yet.
- Relationship-style join hints across datasets are not part of the MVP UI; explore overlaps with ad-hoc SQL if needed.
- Very wide files may be slower on first profile; use **Refresh** in the dataset strip or `POST /api/datasets/{id}/profile/refresh` to rebuild explicitly.
