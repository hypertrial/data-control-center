# Data Control Center

Local-first control center for opening, profiling, exploring, and querying many local data files from one interface.

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React + Vite + TypeScript, TanStack Query/Table, Zustand, ECharts, Tailwind + shadcn-style primitives
- **Backend** ([`backend/`](backend/)): FastAPI + DuckDB (views + profile cache) + Polars profiling

## Prerequisites

- Node 20+ (or current LTS you use with Vite 8)
- Python 3.11+ and [`uv`](https://docs.astral.sh/uv/)

## Run locally

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

- Register datasets by **absolute file path** (CSV, Parquet, JSON / JSON Lines, TSV) or a folder of those files.
- DuckDB creates internal views named `v_<dataset_id>` (e.g. `v_ds_001`). The SQL panel auto-fills a `SELECT` for the active dataset; ad-hoc SQL must reference at least one registered view when datasets exist.
- Profiles and quality issues are cached in `DCC_WORKSPACE_DB_PATH` (default `./.dcc_workspace.duckdb` relative to the backend process cwd).

## Tests

```bash
cd backend && uv run pytest
cd frontend && npm test
```

## Known limitations (MVP)

- Excel and remote files are not supported yet.
- Relationship and key heuristics are sample-based and best-effort.
- Very wide files may be slower on first profile; refresh flow can be improved with async jobs later.
