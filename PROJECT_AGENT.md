# AGENTS.md

## Project Overview

Data Control Center is a local-only workstation app for uploading, profiling,
exploring, and querying local datasets.

- Frontend: `frontend/` uses React, Vite, TypeScript, TanStack Query/Table,
  Zustand, ECharts, Tailwind, and shadcn-style primitives.
- Backend: `backend/` uses FastAPI, DuckDB, Polars, Pydantic, and `uv`.
- Keep the product local-only. Do not introduce hosted, multi-user, shared-LAN,
  tenancy, or account-auth assumptions without an explicit user request.

## Setup and validation

Run commands from the repository root unless noted. **Canonical commands and CI parity:**
[`CONTRIBUTING.md`](CONTRIBUTING.md) (setup, Makefile targets, validation, coverage).

Quick reference:

- `make install` / `make dev` — dependencies and local dev servers
- `make check` — full validation before finishing work
- `make check-ci` — after **frontend** lockfile changes
- `cd backend && uv sync --extra dev` — after **backend** `uv.lock` / pyproject changes, then `make check`
- `make clean-local` — discard local workspace and uploads

Use **Node 22** from [`.nvmrc`](.nvmrc) (matches CI). Use **Python 3.11+** with `uv`.

If a required tool is missing or a network-dependent audit cannot run, state the exact
blocker and any fallback checks performed.

## Code Style

- Follow existing module boundaries and naming before adding new abstractions.
- Backend API routes live in `backend/app/api/`; Pydantic models in
  `backend/app/models/`; service logic in `backend/app/services/`.
- Frontend API client/types live in `frontend/src/api/`; feature UI lives in
  `frontend/src/features/`; reusable primitives live in
  `frontend/src/components/`.
- Add or update tests with behavior changes. Backend coverage is expected to
  remain at 100%; frontend coverage must satisfy the configured Vitest baseline.
- Keep generated artifacts, coverage output, local databases, uploads, caches,
  and private datasets out of commits.
- Prefer small, focused changes over broad refactors. Do not rewrite unrelated
  code while fixing a local issue.

## Security Requirements

- Preserve loopback/local-only defaults and local token protections.
- Treat `.dcc_workspace.duckdb` and `.dcc_uploads/` as private local data.
- Browser uploads are the normal ingestion path. Path registration is advanced
  local-only functionality and must remain explicitly gated.
- Never expose absolute local paths in user-facing behavior unless the existing
  `DCC_EXPOSE_ABSOLUTE_SOURCE_PATHS` setting allows it.
- Keep public errors sanitized; avoid leaking local filesystem paths, tokens, or
  parser internals.
- Do not add telemetry, remote network calls, or hosted services without explicit
  user direction.

## Documentation Expectations

Update docs when behavior, setup, validation commands, env vars, security
posture, workflows, or public API contracts change.

- User-facing overview: `README.md`
- User docs index: `docs/README.md`
- Product usage: `docs/user-guide.md`
- Backend details: `backend/README.md`
- Frontend details: `frontend/README.md`
- Contributor workflow: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Safe demo path: `docs/5-minute-tour.md` and `examples/`

## Git And PR Hygiene

- Inspect `git status --short` before editing and before final response.
- Do not revert user changes unless explicitly asked.
- Commit messages should be specific, imperative, and based on the actual diff.
- Before release or public-sharing work, run local cleanup with `make clean-local`
  and verify only intentional tracked changes remain.
- Before tagging a release, follow the maintainer checklist in
  [`CONTRIBUTING.md`](CONTRIBUTING.md#release-checklist-maintainers) and
  [`docs/RELEASE.md`](docs/RELEASE.md).
