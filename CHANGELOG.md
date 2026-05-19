# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to semantic
versioning once formal releases begin.

## [Unreleased]

### Breaking

- Workspace DB: removed versioned migrations and **`DCC_WORKSPACE_BACKUP_BEFORE_MIGRATE`**; existing **`.dcc_workspace.duckdb`** files from older builds require **`make clean-local`** (or manual delete). Leftover **`schema_version`** tables are rejected at startup.
- Profile API: removed legacy fields **`potential_id_columns`**, **`potential_key_columns`**, **`primary_date_column`**; only **`structure_version: "v4"`** cache entries are served (stale cache is auto-deleted).
- Agent Ask: removed synchronous **`POST /api/agent/ask`**; clients must use **`POST /api/agent/ask/stream`** (frontend: **`askAgentStream`** only).
- Frontend: removed **`api.getProfile`**, exported **`api.waitForJob`**, and **`api.askAgent`**.

### Added

- Frontend API type conformance tests (`types.test.ts` + `src/api/__fixtures__/`).
- `make check-ci` for clean-room CI-parity validation (`npm ci` then `make check`).
- `useDatasetProfile` hook and `api.fetchDatasetProfile` for async first-open profiling (`PROFILE_NOT_READY` + job polling).
- Registry `RLock` coverage for concurrent count/unregister paths.
- Hook unit tests for `useDatasetProfile`, `useColumnsTable`, `useOverviewPageData`, `useSqlResultsGrid`, and `useSqlHistory`.

### Changed

- **`GET /api/datasets/{id}/profile`** no longer blocks on `build_profile`; returns **`PROFILE_NOT_READY`** with **`job_id`** when the cache is empty.
- Upload/register queue profile refresh jobs; refresh endpoint dedupes active profile jobs.
- Datasets API split into `datasets_upload`, `datasets_profile`, `datasets_inspect`, and `datasets_jobs` modules (URLs unchanged).
- Ask persistence aligned with `Workspace.ask` (`AskStore`); agent workflow split into persistence/run modules.
- Query tab: `SqlEditor`, `SchemaDatasetBlock`, and `useSqlHistory` extracted from `QueryPage`.
- Sample rows API returns structured DuckDB error codes.
- Backend tests reorganized under `tests/api/`, `tests/profiler/`, and `tests/workspace/`.
- Frontend coverage baseline raised to **92%** (lines/statements); `types.ts` excluded from v8 coverage (still validated via `types.test.ts`).

### Removed

- README Screenshots section and wireframe SVGs under `docs/images/`.
- Unused `frontend/public/icons.svg` marketing sprite.
- Unused `Label` and `Kbd` UI primitives (and their tests).
- Unused exports `cardPadding` and `severityCssVar` from `tokens.ts`, and `chartGrid` from `chartTheme.ts`.
- Stale `.streamlit/secrets.toml` entry from `.gitignore`.

## [0.1.0] - 2026-05-19

### Added

- MIT license and open-source governance files.
- Contributor, security, issue, and pull request guidance.
- Safe example datasets and a five-minute tour.
- Security and dependency automation for OSS release readiness.
- `GET /api/health` **`llm`** field probing the configured Ollama-compatible endpoint (`/api/tags`).
- Ask tab banner when the local LLM is unreachable, linking to README setup.
- **`DCC_UI_DIST_PATH`**: optional serving of the built Vite UI from FastAPI with SPA fallback; **`make serve`** and **`make build-ui`**.
- **`make check`** for CI-parity validation (backend ruff + pytest, frontend lint + test + coverage + build).
- CI frontend job runs **`npm run build`**.
- README quick start, platform notes, upgrading guidance, OpenAPI link, and UI wireframe screenshots under `docs/images/`.

### Changed

- Documentation map and contributor workflow reference **`make check`** and single-server mode.
