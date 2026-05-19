# Data Control Center

**Local-first tool** for profiling, exploring, and querying local data files (CSV, TSV,
Parquet, JSON, JSON Lines) from one interface. Built for a **single trusted
workstation**—fast EDA and ad-hoc DuckDB SQL, not hosted BI or multi-tenant use.
This app is **local-only**; see [`SECURITY.md`](SECURITY.md) for the threat model and
vulnerability reporting.

## Quick start (no LLM required)

1. From the repo root: `make install` then `make dev` (requires **bash**; see
   [Platform notes](#platform-notes)).
2. Open **`http://127.0.0.1:5173`**, upload files from [`examples/`](examples/) (or follow
   [`docs/5-minute-tour.md`](docs/5-minute-tour.md)).
3. Explore **Overview**, **Columns**, **SQL**, and more. **Ask** is optional and needs
   [Ollama](https://ollama.com); see [User guide — Ask](docs/user-guide.md#ask-tab).

## Platform notes

- **macOS** — primary platform; Node 22+ or 24+, Python 3.11+, [`uv`](https://docs.astral.sh/uv/), optional Ollama.
- **Linux** — same `make` targets; install Node and `uv` from your distro or upstream.
- **Windows** — use **WSL2** (e.g. Ubuntu). Native Windows without WSL is untested.

**Prerequisites:** Node from [`.nvmrc`](.nvmrc) (22 LTS or 24+; Node 23 may print
harmless **`EBADENGINE`** warnings from ESLint). Python 3.11+ and `uv`. Run **`make help`**
from the repo root for all targets.

## Single-server mode

```bash
make serve
```

Opens **`http://127.0.0.1:8000`** (API serves the built UI via **`DCC_UI_DIST_PATH`**).
Day-to-day development uses **`make dev`** (Vite on **5173** + API on **8000**).

## Upgrading / workspace schema

Workspace metadata lives in **`DCC_WORKSPACE_DB_PATH`** (default **`.dcc_workspace.duckdb`**
relative to the backend cwd). There is **no** in-place migration. After pulling changes
that alter workspace layout or profile shape, run **`make clean-local`** or delete the
workspace file by hand—that removes app cache, Ask history, and upload copies under
**`.dcc_uploads/`**, not your original source files. Schema details:
[`backend/README.md`](backend/README.md#workspace-database).

## API reference

With the backend running: **`http://127.0.0.1:8000/docs`** (Swagger UI).

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React + Vite + TypeScript, TanStack Query/Table, Zustand, ECharts, Tailwind
- **Backend** ([`backend/`](backend/)): FastAPI + DuckDB (views + profile cache) + Polars profiling

## Documentation map

| Document | Purpose |
| --- | --- |
| [`docs/5-minute-tour.md`](docs/5-minute-tour.md) | First-run walkthrough with `examples/` |
| [`docs/user-guide.md`](docs/user-guide.md) | Usage, shortcuts, profiles, SQL, Ask |
| [`backend/README.md`](backend/README.md) | Backend run, **`DCC_*`** configuration |
| [`frontend/README.md`](frontend/README.md) | Vite proxy, layout, TanStack conventions |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Development setup, validation, pull requests |
| [`SECURITY.md`](SECURITY.md) | Threat model and vulnerability reporting |

## Known limitations (MVP)

- Excel and remote files are not supported yet.
- No cross-dataset join UI; explore overlaps with ad-hoc SQL.
- Very wide files may be slow on first profile; use **Refresh** in the dataset strip or
  `POST /api/datasets/{id}/profile/refresh`.
