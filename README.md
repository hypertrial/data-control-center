# Data Control Center

Local-first control center for opening, profiling, exploring, and querying many local data files from one interface.

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React + Vite + TypeScript, TanStack Query/Table, Zustand, ECharts, Tailwind + shadcn-style primitives
- **Backend** ([`backend/`](backend/)): FastAPI + DuckDB (views + profile cache) + Polars profiling

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

**UI only from repo root:** `npm run dev` uses the root [`package.json`](package.json) and forwards to `frontend/`. You still need the API (`make backend` in another terminal, or use `make dev` for both).

### Two terminals (manual)

**Terminal 1 — API**

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — UI**

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The dev server proxies `/api` to the backend.

## Usage notes

- In the **web UI**, add datasets by **uploading files** (drag-and-drop or folder selection). The API stores copies under **`.dcc_uploads/`** (relative to the backend cwd unless overridden), then registers them; tune size limits with **`DCC_UPLOAD_MAX_BYTES_PER_FILE`** (default 250 MiB).
- You can still register datasets via the API using **absolute file paths** (CSV, Parquet, JSON / JSON Lines, TSV) or a **folder** of those files.
- DuckDB creates one internal **view per dataset** whose SQL name is derived from the **file stem** (e.g. `player_ratings_2006_2026.parquet` → `player_ratings_2006_2026`). If two files share the same stem, the later registration gets a suffix such as `ratings_ds_002`. Reserved SQL-like names get a `_dcc` suffix. **`GET /api/datasets`** includes **`view_name`** on each summary so the UI can quote it correctly. Ad-hoc SQL must reference at least one registered view when datasets exist. On startup, the API **renames legacy views** of the form `v_{dataset_id}` (e.g. `v_ds_001`) to the current stem-based rule when the source file is still present.
- In the **SQL** tab, **⌘+Enter** (macOS) or **Ctrl+Enter** runs the current query (same as **Run query**).
- In the **Ask** tab, **⌘+Enter** (macOS) or **Ctrl+Enter** submits the question (same as **Ask**).
- Profiles and quality issues are cached in `DCC_WORKSPACE_DB_PATH` (default `./.dcc_workspace.duckdb` relative to the backend process cwd).
- **`POST /api/datasets/{dataset_id}/profile/refresh`** recomputes the cached profile for one dataset (records an in-process job row in the workspace DB).
- **`GET /api/datasets`** responses may include an optional **`quality_score`** (0–100) on each dataset when a cached profile exists for that id.
- **`GET /api/datasets/{dataset_id}/sample`** includes **`total_rows`**: a full-table row count before `LIMIT` / `OFFSET` are applied.

## Local LLM assistant (Ask tab)

- Install **[Ollama](https://ollama.com)** on macOS (download from the site, or e.g. `brew install ollama` if you use Homebrew).
- Pull a model (default used by the app is **`qwen3:4b`**):

  ```bash
  ollama pull qwen3:4b
  ```

  For a larger, often more capable model, install **`qwen3:8b`** and set **`DCC_LLM_MODEL=qwen3:8b`** when starting the backend.
- Keep the Ollama app/daemon running, then run **`make dev`** as usual. Open the **Ask** tab, type a question in plain language, and optional **max_rows** for the result preview.
- The backend calls Ollama at **`DCC_LLM_BASE_URL`** (default `http://127.0.0.1:11434`), asks the model for a single read-only **`SELECT`/`WITH`** statement, runs it through the same validation and row limits as **`POST /api/query`**, and returns a concise local answer from the executed result. Set **`DCC_AGENT_SUMMARIZE_WITH_LLM=true`** if you prefer a second model call to summarize the result. Generated SQL can be opened in the **SQL** tab.
- Useful settings (all prefixed with **`DCC_`**): **`LLM_BASE_URL`**, **`LLM_MODEL`**, **`LLM_TIMEOUT_SECONDS`**, **`LLM_SQL_NUM_PREDICT`**, **`LLM_SUMMARY_NUM_PREDICT`**, **`LLM_TEMPERATURE`**, **`LLM_THINK`**, **`AGENT_CONTEXT_MAX_COLUMNS`**, **`AGENT_MAX_ROWS`**, **`AGENT_SQL_ATTEMPTS`**, **`AGENT_SUMMARIZE_WITH_LLM`**, **`AGENT_SUMMARIZE_MAX_JSON_CHARS`**. The default Ask path keeps prompts and generated answers bounded for responsive local inference.
- **HTTP API:** `POST /api/agent/ask` with JSON body **`{ "question": "...", "dataset_ids": ["ds_001"] | null, "max_rows": 200 }`**. The UI sends **`dataset_ids: [active]`** when a dataset is selected in the strip, and **`null`** otherwise (all datasets in context).
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

Frontend tests use **Vitest + v8** with thresholds in [`frontend/vitest.config.ts`](frontend/vitest.config.ts): lines/statements must meet the **baseline** (currently **~85%**); excluded paths are listed there (e.g. bootstrap-only files). Raise toward 100% as more branches gain tests.

```bash
cd backend && uv run pytest
cd frontend && npm run test:coverage
```

## Maintenance notes

- **Frontend SQL helpers:** [`frontend/src/lib/sql.ts`](frontend/src/lib/sql.ts)
- **ECharts lifecycle hook:** [`frontend/src/hooks/useDisposableEChart.ts`](frontend/src/hooks/useDisposableEChart.ts)
- **Workspace metadata (profile cache + job rows):** DuckDB tables in [`backend/app/services/workspace.py`](backend/app/services/workspace.py)
- **Local LLM agent (Ollama client + prompts):** [`backend/app/services/agent.py`](backend/app/services/agent.py)

## Known limitations (MVP)

- Excel and remote files are not supported yet.
- Relationship-style join hints across datasets are not part of the MVP UI; explore overlaps with ad-hoc SQL if needed.
- Very wide files may be slower on first profile; use **Refresh** in the dataset strip or `POST /api/datasets/{id}/profile/refresh` to rebuild explicitly.
