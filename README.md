# Data Control Center

Local-first control center for opening, profiling, exploring, and querying many local data files from one interface.

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React + Vite + TypeScript, TanStack Query/Table, Zustand, ECharts, Tailwind + shadcn-style primitives
- **Backend** ([`backend/`](backend/)): FastAPI + DuckDB (views + profile cache) + Polars profiling

## Documentation map

- **Backend** (run, tests, workspace DB, profiling env knobs): [`backend/README.md`](backend/README.md)
- **Frontend** (Vite proxy, layout, TanStack keys, coverage): [`frontend/README.md`](frontend/README.md)

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

Other targets: `make help`, `make backend`, `make frontend`.

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

- In the **web UI**, add datasets by **uploading files** (drag-and-drop or folder selection). The API stores copies under **`.dcc_uploads/`** (relative to the backend cwd unless overridden), then registers them; tune size limits with **`DCC_UPLOAD_MAX_BYTES_PER_FILE`** (default 2 GiB).
- You can still register datasets via the API using **absolute file paths** (CSV, Parquet, JSON / JSON Lines, TSV) or a **folder** of those files.
- DuckDB creates one internal **view per dataset** whose SQL name is derived from the **file stem** (e.g. `player_ratings_2006_2026.parquet` → `player_ratings_2006_2026`). If two files share the same stem, the later registration gets a suffix such as `ratings_ds_002`. Reserved SQL-like names get a `_dcc` suffix. **`GET /api/datasets`** includes **`view_name`** on each summary so the UI can quote it correctly. Ad-hoc SQL must reference at least one registered view when datasets exist. On startup, the API **renames legacy views** of the form `v_{dataset_id}` (e.g. `v_ds_001`) to the current stem-based rule when the source file is still present.
- Remove a dataset from the sidebar trash action or **`DELETE /api/datasets/{dataset_id}`**. This unregisters the dataset, drops its DuckDB view, and clears cached profile state; it does **not** delete the source file or uploaded copy from disk.
- In the **SQL** tab, **⌘+Enter** (macOS) or **Ctrl+Enter** runs the current query (same as **Run query**). The **results** pane is a spreadsheet-style grid: **sortable** columns, **resizable** widths, sticky **#** row index, drag or **Shift+arrow** multi-cell selection, **⌘/Ctrl+C** to copy as **TSV**, plus **Copy JSON**, **Export CSV**, and **double-click** a cell for the full value. Result sets above **200** rows use **virtualized** scrolling for responsiveness.
- In the **Ask** tab, **⌘+Enter** (macOS) or **Ctrl+Enter** submits the question (same as **Ask (stream)**). **Esc** stops an in-flight stream. Chats are **persisted** in the workspace DuckDB (see below).
- **Ask conversations** are stored in the workspace DB (`DCC_WORKSPACE_DB_PATH`, default `./.dcc_workspace.duckdb`): tables **`dcc_ask_conversations`** and **`dcc_ask_turns`** (question, SQL attempts, executed SQL, capped result preview, answer, model, timings, dataset scope). REST: **`GET/POST /api/ask/conversations`**, **`PATCH/DELETE /api/ask/conversations/{id}`**, **`GET /api/ask/conversations/{id}/turns`**, **`DELETE /api/ask/conversations/{id}/turns/{turn_id}`**. Send **`conversation_id`** (and optional **`use_history`**, default true) on **`POST /api/agent/ask`** or **`/api/agent/ask/stream`** so turns append to that chat and prior turns are included in the LLM context (bounded to recent turns).
- **Ask streaming** SSE events include: `meta`, `stage` (`context` · `draft_sql` · `execute` · `retry` · `summarize`), `sql_attempt`, `sql`, `query_result`, `token`, `answer`, `timing` (`total_ms`), `turn` (`turn_id`, `conversation_id`, `seq`), `error`, `done`.
- Profiles and quality issues are cached in `DCC_WORKSPACE_DB_PATH` (default `./.dcc_workspace.duckdb` relative to the backend process cwd).
- **`POST /api/datasets/{dataset_id}/profile/refresh`** queues a **profile refresh** job and returns **`{ job_id, status: "queued" }`**. Poll **`GET /api/jobs/{job_id}`** (or list **`GET /api/jobs`**) for **`completed`**, **`failed`**, or **`canceled`**; results and errors surface there, and the workspace **`dcc_jobs`** table mirrors the same state.
- **`GET /api/datasets`** responses may include an optional **`quality_score`** (0–100) on each dataset when a cached profile exists for that id.
- Profile structure inference is **composite-aware**: the API now detects likely multi-column row grain keys (e.g. `player_id + year`), discrete temporal axes (such as integer `year` / `season`), **entity identifiers** (separate from row grain—names like `player_id` / `playerId` / short keys like `pid`), and ranked measure candidates with confidence labels. Cached profiles include **`structure_version: "v4"`**; older cache entries are **rebuilt on read** so inference upgrades apply automatically.
- The **Overview → Structure** card labels **Entities** vs **grain columns** vs **Row grain** (chips) so entity IDs are not confused with the composite row key.
- **`GET /api/datasets/{dataset_id}/sample`** includes **`total_rows`** before `LIMIT` / `OFFSET`: it uses the stored **`row_count`** when known, otherwise runs a bounded **`COUNT(*)`** on the dataset view (so paging metadata stays accurate even when counts were deferred at registration).
- Profile refreshes are retained as recent snapshots. Use **`GET /api/datasets/{dataset_id}/profile/history`** to list them and **`GET /api/datasets/{dataset_id}/profile/diff`** to compare the latest two snapshots.
- Saved SQL snippets are persisted in the workspace DB via **`/api/saved-queries`** and are available from the SQL tab and command palette.
- Global UI shortcuts: **⌘/Ctrl+K** opens the command palette, **?** opens the shortcuts sheet, **/** focuses dataset search, **g o/c/q/s/a/y** jumps to Overview/Columns/Quality/Samples/Ask/SQL, and **r** refreshes cached queries.

## Security and registration paths

Path-based dataset registration is gated by [`backend/app/config.py`](backend/app/config.py) (all env vars prefixed **`DCC_`**):

- **`DCC_ALLOW_ARBITRARY_REGISTRATION_PATHS`** — when **`false`** (default), registration rejects paths outside the allowed roots below.
- **`DCC_REGISTRATION_ALLOWED_ROOTS`** — extra filesystem roots (in addition to the resolved **`DCC_UPLOAD_DIR`**) from which path registration is permitted.
- **`DCC_EXPOSE_ABSOLUTE_SOURCE_PATHS`** — whether API responses include absolute source paths.

Implementation: [`backend/app/services/registry.py`](backend/app/services/registry.py) (`ensure_registration_allowed`).

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
- **HTTP API:** `POST /api/agent/ask` with JSON body **`{ "question": "...", "dataset_ids": ["ds_001"] | null, "max_rows": 200, "conversation_id": "<optional>", "use_history": true }`**. The UI creates or selects a conversation and sends **`conversation_id`** so turns are saved; **`use_history`** includes recent prior turns in the agent prompt.
- **Streaming API:** `POST /api/agent/ask/stream` accepts the same body and returns Server-Sent Events: `meta`, `stage`, `sql_attempt`, `sql`, `query_result`, `token`, `answer`, `timing`, `turn`, `error`, `done`.
- **CI** does not run Ollama; backend tests **mock** the LLM HTTP calls.

## Tests

### Backend & frontend (local)

```bash
cd backend && uv sync --extra dev && uv run pytest
cd frontend && npm install && npm test
```

For **parity with CI**, also run `uv run ruff check app tests` in `backend/` and `npm run lint` plus `npm run test:coverage` in `frontend/` (see below).

### CI (GitHub Actions)

On push and pull requests to **`main`** / **`master`**, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs:

- **Backend:** `uv sync --extra dev`, `uv run ruff check app tests`, `uv run pytest`
- **Frontend:** `npm ci`, `npm run lint`, `npm test`, `npm run test:coverage`

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
- **Workspace metadata (profile cache + job rows):** façade in [`backend/app/services/workspace.py`](backend/app/services/workspace.py), low-level engine in [`backend/app/services/workspace_engine.py`](backend/app/services/workspace_engine.py), schema init in [`backend/app/services/workspace_schema.py`](backend/app/services/workspace_schema.py), focused stores in [`backend/app/services/workspace_stores.py`](backend/app/services/workspace_stores.py)
- **Local LLM agent (Ollama client + prompts):** [`backend/app/services/agent.py`](backend/app/services/agent.py)

## Known limitations (MVP)

- Excel and remote files are not supported yet.
- Relationship-style join hints across datasets are not part of the MVP UI; explore overlaps with ad-hoc SQL if needed.
- Very wide files may be slower on first profile; use **Refresh** in the dataset strip or `POST /api/datasets/{id}/profile/refresh` to rebuild explicitly.
