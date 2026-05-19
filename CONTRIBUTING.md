# Contributing

Data Control Center is a local-only desktop development tool. Contributions should
preserve that model: the app should remain safe to run on a single trusted workstation
without assuming hosted deployment, shared tenancy, or account auth.

## Requirements

- Node.js 22, matching `.nvmrc`
- Python 3.11 or newer
- `uv`
- npm
- GNU Make

## Setup

From the repository root:

```bash
make install
make dev
```

`make dev` starts the FastAPI backend on `127.0.0.1:8000` and the Vite frontend on
`127.0.0.1:5173`.

## Development

### Makefile targets (repo root)

Run Make from the folder that contains `Makefile`, `backend/`, and `frontend/`.

| Target | Purpose |
| --- | --- |
| `make install` | First-time backend (`uv`) and frontend (`npm`) deps |
| `make dev` | API + UI (bash; Ctrl+C stops both) |
| `make backend` | API only |
| `make frontend` | Vite only |
| `make build-ui` | Production frontend bundle |
| `make serve` | Build UI + single server on port 8000 |
| `make check` | CI-parity validation (see below) |
| `make check-ci` | `npm ci` then `make check` (after lockfile changes) |
| `make clean-local` | Delete local workspace DB, uploads, coverage, build output |

Root [`package.json`](package.json) delegates `npm run dev`, `lint`, `test`, and `build`
into `frontend/`. You still need the API when running only the UI (`make backend` in
another terminal, or `make dev` for both).

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

## Validation

Run checks that match the area you changed. Before opening a PR, run the full set when
practical. From the repository root:

```bash
make check
```

This runs the same backend and frontend checks as CI (ruff, pytest, lint, tests,
coverage, and `npm run build`). **`make check`** uses your current `frontend/node_modules`
(from `npm install`). After lockfile or dependency changes, run **`make check-ci`** to
reinstall with **`npm ci`** first (matches the GitHub Actions frontend job).

Individual steps:

```bash
cd backend && uv run ruff check app tests
cd backend && uv run pytest
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run test:coverage
cd frontend && npm run build
```

### CI (GitHub Actions)

On push and pull requests to **`main`** / **`master`**, [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the same steps as **`make check`**. Additional scheduled jobs run CodeQL, npm audit, pip-audit, and gitleaks. Renovate updates npm, GitHub Actions, and Python dependencies.

### Coverage

- **Backend:** pytest-cov in [`backend/pyproject.toml`](backend/pyproject.toml) fails below **100%** line coverage on `app/`. HTML report: `uv run pytest --cov=app --cov-report=html` → `backend/htmlcov/index.html`.
- **Frontend:** Vitest thresholds in [`frontend/vitest.config.ts`](frontend/vitest.config.ts) (**`COVERAGE_BASELINE`** 92% lines/statements; see excludes there).

Security and dependency checks for release hygiene:

```bash
cd frontend && npm audit --audit-level=moderate
cd backend && uv run pip-audit
gitleaks detect --source . --redact
```

## Project Map

- `backend/app/api/`: FastAPI route modules.
- `backend/app/models/`: Pydantic request and response models.
- `backend/app/services/`: DuckDB workspace, registry, profiling, query, upload, and agent logic.
- `backend/tests/`: pytest coverage for API and service behavior.
- `frontend/src/api/`: API client and shared response types.
- `frontend/src/features/`: user-facing feature areas.
- `frontend/src/components/`: reusable UI primitives and app components.
- `frontend/src/**/*.test.*`: colocated Vitest tests.

## Pull Requests

- Keep PRs focused and explain user-visible behavior changes.
- Add or update tests for changed behavior.
- Update docs when changing setup, security posture, public API behavior, or user workflows.
- Do not commit local datasets, workspace databases, upload folders, coverage output, build output, or cache files.
- Treat sample data carefully. Use tiny synthetic fixtures unless a real dataset is explicitly licensed and necessary.

## Local Data Caution

The app can ingest arbitrary local files. Uploaded copies and workspace state can contain
sensitive data. Use **`make clean-local`** only when you intentionally want to discard
local app state (see [README — Upgrading](README.md#upgrading--workspace-schema)).
