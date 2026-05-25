# Data Control Center

https://github.com/user-attachments/assets/d62aa7bb-4696-470d-b354-0e66c0c7f76e

**Local-first tool** for profiling, exploring, and querying local data files (CSV, TSV,
Parquet, JSON, JSON Lines, NDJSON, and DuckDB) with fast browse-and-import for `.duckdb`
files via **Import DuckDB** (one system file dialog when native pick is enabled; HTTP upload remains for API/tests/fallback). Built for a **single trusted workstation**—fast EDA and ad-hoc DuckDB
SQL, not hosted BI or multi-tenant use.
This app is **local-only**; see [`SECURITY.md`](SECURITY.md) for the threat model and
vulnerability reporting.

## Quick start (no LLM required)

1. From the repo root: `make install` then `make dev` (requires **GNU bash**; see
   [Platform notes](#platform-notes)).
2. Open **`http://127.0.0.1:5173`**.
3. **New here?** Follow the [**5-minute tour**](docs/5-minute-tour.md) with
   [`examples/`](examples/) fixtures before using your own data.

Explore **Columns**, **Charts**, **SQL**, and more. **Ask** is optional and needs
[Ollama](https://ollama.com); see [User guide — Ask](docs/user-guide.md#ask-tab).

## Platform notes

- **macOS** — primary platform; Node 22 (`.nvmrc`), Python 3.11+, [`uv`](https://docs.astral.sh/uv/), optional Ollama.
- **Linux** — same `make` targets; install Node 22 and `uv` from your distro or upstream.
- **Windows** — use **WSL2** (e.g. Ubuntu). Native Windows without WSL is untested.

**Prerequisites:** Node **22** from [`.nvmrc`](.nvmrc) (matches CI). Python 3.11+ and `uv`.
Run **`make help`** from the repo root for all targets.

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
**`.dcc_uploads/`**, not your original source files. See [**CHANGELOG**](CHANGELOG.md)
for breaking changes. Schema details:
[`backend/README.md`](backend/README.md#workspace-database).

Current **Unreleased** changes add a **`description`** column to saved SQL snippets.
Workspaces with the prior saved-query table shape are updated in place on startup.

### Upgrading to 1.0.0

If you used **0.1.0**, read [**CHANGELOG — 1.0.0**](CHANGELOG.md#100---2026-05-20) before
upgrading. In short:

1. **`make clean-local`** (or delete **`.dcc_workspace.duckdb`**) so the workspace and
   profile cache match the new schema.
2. Re-open datasets; profiling is async on first load (**`PROFILE_NOT_READY`** + job polling).
3. Custom Ask clients must call **`POST /api/agent/ask/stream`** only (sync ask removed).

**1.0.0** also changes default UX: **Ask** runs a second Ollama summarization pass by default
(set **`DCC_AGENT_SUMMARIZE_WITH_LLM=false`** for lower latency). **Columns** opens sorted by
column name ascending; distribution stats show **STDEV** for standard deviation.

## API reference

With the backend running: **`http://127.0.0.1:8000/docs`** (Swagger UI).

## Architecture

- **Frontend** ([`frontend/`](frontend/)): React, Vite, TypeScript, TanStack Query/Table, Zustand, ECharts, Tailwind, shadcn-style primitives
- **Backend** ([`backend/`](backend/)): FastAPI, DuckDB, Polars, Pydantic, `uv`

## Documentation map

| Document | Audience | Purpose |
| --- | --- | --- |
| [`docs/README.md`](docs/README.md) | Users | Index: tour vs user guide |
| [`docs/5-minute-tour.md`](docs/5-minute-tour.md) | Users | First-run walkthrough with `examples/` |
| [`docs/user-guide.md`](docs/user-guide.md) | Users | Day-to-day usage, shortcuts, tabs |
| [`examples/README.md`](examples/README.md) | Users | Synthetic fixture descriptions |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Contributors | Setup, validation, pull requests |
| [`backend/README.md`](backend/README.md) | Backend devs | API, **`DCC_*`** config, workspace |
| [`frontend/README.md`](frontend/README.md) | Frontend devs | Vite proxy, layout, TanStack conventions |
| [`AGENTS.md`](AGENTS.md) | AI agents | Agent rules; links to CONTRIBUTING for commands |
| [`SECURITY.md`](SECURITY.md) | Security | Threat model and vulnerability reporting |
| [`CHANGELOG.md`](CHANGELOG.md) | Upgraders | Breaking changes and release notes |
| [`docs/RELEASE.md`](docs/RELEASE.md) | Maintainers | Tagging and GitHub Release steps |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community | Contributor Covenant |

## Known limitations (MVP)

- Excel and remote files are not supported yet.
- No cross-dataset join UI; explore overlaps with ad-hoc SQL.
- Very wide files may be slow on first profile; use **Refresh** in the dataset strip or
  `POST /api/datasets/{id}/profile/refresh`.
