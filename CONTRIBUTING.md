# Contributing

Data Control Center is a local-only desktop development tool. Contributions should
preserve that model: the app should remain safe to run on a single trusted workstation
without assuming hosted deployment, shared tenancy, or account auth.

**AI coding agents:** see [`AGENTS.md`](AGENTS.md) for agent-specific rules; use this
document for setup, validation, and pull requests.

## Requirements

- **Node.js 22** — use the version in [`.nvmrc`](.nvmrc) (matches CI)
- **Python 3.11+**
- **`uv`**
- **npm**
- **GNU Make** and **bash** (required for `make dev`)

## Setup

From the repository root:

```bash
make install
make dev
```

`make dev` starts the FastAPI backend on `127.0.0.1:8000` and the Vite frontend on
`127.0.0.1:5173`. It pins a per-run local API token so Uvicorn reloads do not invalidate
the frontend session while you edit backend code.

For manual per-tier commands (separate terminals), see
[`backend/README.md`](backend/README.md#run-locally) and
[`frontend/README.md`](frontend/README.md#commands).

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
| `make check` | CI-parity validation (see [Validation](#validation)) |
| `make check-ci` | `npm ci` then `make check` (after **frontend** lockfile changes) |
| `make clean-local` | Delete local workspace DB, uploads, coverage, build output |

Root [`package.json`](package.json) delegates `npm run dev`, `lint`, `test`, and `build`
into `frontend/`. You still need the API when running only the UI (`make backend` in
another terminal, or `make dev` for both).

## Validation

Run checks that match the area you changed. Before opening a PR, run the full set when
practical. From the repository root:

```bash
make check
```

This runs the same backend and frontend checks as CI (ruff, pytest, lint, tests,
coverage, and `npm run build`). **`make check`** uses your current `frontend/node_modules`
(from `npm install`).

**After dependency changes:**

| Change | Command before `make check` |
| --- | --- |
| `frontend/package-lock.json` | `make check-ci` (runs `npm ci` first) |
| `backend/uv.lock` or `backend/pyproject.toml` | `cd backend && uv sync --extra dev` (or `make install`) |

Individual steps (for debugging only; prefer `make check`):

```bash
cd backend && uv run ruff check app tests
cd backend && uv run pytest
cd frontend && npm run lint
cd frontend && npm test
cd frontend && npm run test:coverage
cd frontend && npm run build
```

Frontend lint fails on warnings, and Vitest fails on unexpected `console.error` /
`console.warn` output. Fix noisy tests by mocking the missing local API call or by using
the explicit test helper for intentionally asserted console output.

### CI (GitHub Actions)

**Primary CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on push and
pull requests to **`main`** and **`master`**, matching **`make check`**. The backend job
installs **`python3-tk`** on Ubuntu so Linux native-picker tests can import Tkinter.

**Additional security jobs** (CodeQL, npm audit, pip-audit, gitleaks in
[`.github/workflows/security-audit.yml`](.github/workflows/security-audit.yml) and
[`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)) run on a schedule and on
push to **`main`** (not `master`). Renovate updates npm, GitHub Actions, and Python
dependencies.

### Chart SQL fixtures

Charts SQL is generated in the frontend (`chartSql.ts` / `chartUtils` barrel) and executed by the backend query API. When you change chart SQL builders, regenerate the shared fixture:

```bash
cd frontend && npm run fixtures:chart-sql
```

The generator writes [`backend/tests/fixtures/chart_sql_cases.json`](backend/tests/fixtures/chart_sql_cases.json). Frontend SQL tests assert `buildChartSql` still matches that JSON, and backend execution tests run the same SQL against [`backend/tests/fixtures/chart_orders.csv`](backend/tests/fixtures/chart_orders.csv).

### Coverage

- **Backend:** pytest-cov in [`backend/pyproject.toml`](backend/pyproject.toml) fails below **100%** line coverage on `app/`. HTML report: `uv run pytest --cov=app --cov-report=html` → `backend/htmlcov/index.html`.
- **Frontend:** Vitest thresholds in [`frontend/vitest.config.ts`](frontend/vitest.config.ts) (**`COVERAGE_BASELINE`** 94% lines/statements; see excludes there).

Security and dependency checks for release hygiene:

```bash
cd frontend && npm audit --audit-level=moderate
cd backend && uv run pip-audit
gitleaks detect --source . --redact
```

(`gitleaks` is optional locally; CI runs it on `main`.)

### Release checklist (maintainers)

Before tagging a release (for example **`v1.0.0`**):

1. Confirm **[`CHANGELOG.md`](CHANGELOG.md)** has a dated version section and an empty
   **`[Unreleased]`** stub; bump versions in [`backend/pyproject.toml`](backend/pyproject.toml)
   and [`frontend/package.json`](frontend/package.json).
2. Run **`make check`** (or **`make check-ci`** after frontend lockfile changes).
3. Run release hygiene audits:

   ```bash
   cd frontend && npm audit --audit-level=moderate
   cd backend && uv run pip-audit
   ```

   Fix moderate-or-higher issues in the release PR when updates are available.
4. On demo machines, run **`make clean-local`** so workspace DBs and uploads are not
   bundled into screenshots or archives.
5. Merge the release PR, then follow **[`docs/RELEASE.md`](docs/RELEASE.md)** to tag and
   publish the GitHub Release.

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
- Confirm **`make check`** (or **`make check-ci`** after frontend lockfile changes) in the PR description.

## Local Data Caution

The app can ingest arbitrary local files. Uploaded copies and workspace state can contain
sensitive data. Use **`make clean-local`** only when you intentionally want to discard
local app state (see [README — Upgrading](README.md#upgrading--workspace-schema)).
