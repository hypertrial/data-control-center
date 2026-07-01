# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project follows [Semantic Versioning](https://semver.org/). **1.0.0** is the first tagged
stable release. Maintainer tagging steps: [`docs/RELEASE.md`](docs/RELEASE.md).

## [Unreleased]

### Fixed

- Frontend dependencies (`vite`, `vitest`/`@vitest/coverage-v8`, `echarts`, `react-router`/`react-router-dom`, `esbuild`, `ws`, `@babel/core`) upgraded to patched releases, resolving all `npm audit` findings (2 critical, 2 high, 1 moderate, 4 low).
- Vite dev server pre-bundles `@tanstack/react-table`, `echarts`, and `sql-formatter` at startup (`optimizeDeps.include`) so first navigation to the lazy-loaded Columns/Charts/Query pages no longer triggers a mid-session dependency re-optimization that surfaced as `504 (Outdated Optimize Dep)` / "Failed to fetch dynamically imported module" errors.

## [1.1.1] - 2026-05-26

### Fixed

- GitHub Actions CI installs `python3-tk` on Ubuntu and DuckDB picker tests mock `native_pick_available` so backend jobs pass on headless Linux runners.
- `useDatasetProfile` no longer disables the profile query while polling prepare jobs, deduplicates completion invalidations per dataset/job, and reuses already-completed jobs from cache—fixing runaway `/profile` requests after DuckDB import when multiple UI surfaces mount the hook.

## [1.1.0] - 2026-05-25

### Upgrade from 1.0.0

1. Update custom API clients: DuckDB inspect/import APIs use **`source_id`** (replaces
   **`upload_id`**).
2. **`/api/saved-charts`** was removed; saved chart rows are dropped from local workspaces on
   next startup.
3. Saved SQL snippets gain an optional **`description`** column; existing workspaces migrate
   in place on startup.
4. Large datasets may rebuild profiles with sample-scoped metrics; the UI polls prepare jobs
   until ready.

### Added

- DuckDB **open-from-disk** for large local `.duckdb` files (`POST /api/datasets/duckdb/open-local`, **`pick-local`** native file picker), capabilities endpoint, searchable relation picker, and lazy per-relation row counts.
- Saved SQL snippets now persist an optional description.

### Fixed

- Starlette upgraded to a patched release; token middleware uses the routed request path so malformed `Host` headers can no longer bypass `X-DCC-Local-Token`.
- gitleaks CI install now verifies the release tarball SHA256 before installation.
- DuckDB relation import now snapshots through a direct read-only connection to the source file so views that reference catalog-qualified names (e.g. `oddsfox.schema.table` in dbt-built databases) export correctly.
- The local API token is generated once per backend process and reused for background job error redaction.
- Profile refresh and DuckDB import jobs observe cancellation between expensive stages.

### Changed

- DuckDB inspect/import APIs use **`source_id`** (replaces **`upload_id`**). Default inspect is metadata-only (no per-table `COUNT(*)`).
- Raised default browser upload limits to **2 GiB** per file and per batch (`DCC_UPLOAD_MAX_BYTES_PER_FILE`, `DCC_UPLOAD_MAX_BATCH_BYTES`).
- Upload and path registration now queue a single **`dataset_prepare`** background job per dataset (fast row count, then profile) instead of parallel **`dataset_count`** + **`profile_refresh`** jobs.
- Large files (above **`DCC_PROFILE_HEAVY_SCAN_MAX_BYTES`**, default 256 MiB) use Parquet metadata / bounded counts and sample-scoped null metrics; profiles include a structure warning when metrics are sample-based.
- Profiling honors **`DCC_PROFILE_TIMEOUT_SECONDS`** (extended by **`DCC_PROFILE_LARGE_FILE_TIMEOUT_SECONDS`** on heavy scans); prepare jobs report incremental **`progress`**.
- Frontend profile loading polls jobs with exponential backoff and deduplicates profile queries across tabs (Charts uses **`useDatasetProfile`**).
- Workspace DB: **`dcc_saved_queries`** now includes a nullable **`description`** column. Existing local workspaces with the prior saved-query table shape are updated in place on startup.

### Breaking

- Removed unused **`/api/saved-charts`** endpoints. Existing local workspaces drop the **`dcc_saved_charts`** table on next startup (any saved chart rows are discarded).

## [1.0.0] - 2026-05-20

### Upgrade from 0.1.0

1. Run **`make clean-local`** (or delete **`.dcc_workspace.duckdb`**) if you have an existing
   workspace from 0.1.0—the layout and profile cache format changed.
2. Re-open datasets so profiles rebuild (first **`GET /profile`** may return
   **`PROFILE_NOT_READY`**; the UI polls jobs until ready).
3. Custom Ask integrations must use **`POST /api/agent/ask/stream`** only (sync ask removed).

### Breaking

- Workspace DB: removed versioned migrations and **`DCC_WORKSPACE_BACKUP_BEFORE_MIGRATE`**; existing **`.dcc_workspace.duckdb`** files with incompatible **`dcc_*`** layouts require **`make clean-local`** (or manual delete).
- Profile API: removed legacy fields **`potential_id_columns`**, **`potential_key_columns`**, **`primary_date_column`**; only **`structure_version: "v4"`** cache entries are served (stale cache is auto-deleted).
- Agent Ask: removed synchronous **`POST /api/agent/ask`**; clients must use **`POST /api/agent/ask/stream`** (frontend: **`askAgentStream`** only).
- Frontend: removed **`api.getProfile`**, exported **`api.waitForJob`**, and **`api.askAgent`**.

### Added

- [`docs/user-guide.md`](docs/user-guide.md) for product usage (data ingestion, profiles/jobs, SQL, Ask, shortcuts).
- [`docs/RELEASE.md`](docs/RELEASE.md) for maintainer release and tagging steps.
- Root [`.env.example`](.env.example) with commented high-signal **`DCC_*`** variables.
- Frontend API type conformance tests (`types.test.ts` + `src/api/__fixtures__/`).
- `make check-ci` for clean-room CI-parity validation (`npm ci` then `make check`).
- `useDatasetProfile` hook and `api.fetchDatasetProfile` for async first-open profiling (`PROFILE_NOT_READY` + job polling).
- Registry `RLock` coverage for concurrent count/unregister paths.
- Hook unit tests for `useDatasetProfile`, `useColumnsTable`, `useSqlResultsGrid`, and `useSqlHistory`.

### Changed

- Frontend: removed the **Overview** tab; the app opens on **Columns** by default (`/` redirects to `/columns`).
- Frontend: removed the **Quality** tab; the header still shows the quality score, column flags and filters live on **Columns**, `/quality` redirects to `/columns`, and the profile-diff dialog was removed from the UI (API unchanged).
- Frontend **Columns**: default table sort is column name ascending; distribution stats label standard deviation as **STDEV** (not σ).
- Frontend **Ask**: focused chat workspace with hero on empty threads, context bar, collapsible history, compact composer, and tighter turn layout.
- Frontend **Ask** agent: **`DCC_AGENT_SUMMARIZE_WITH_LLM`** defaults to **`true`**; summarization prompts request direct answers with deterministic fallbacks when the second LLM call fails.
- Frontend **Ask** composer: compact sticky bar, **Options** popover (model, row limit, dataset scope by name), always-on suggested prompts, real turn timing summary, conversation list polish.
- Frontend **SQL** workspace: active-dataset chip, consolidated toolbar, run selection, resizable editor/results split, collapsible schema rail, snippet templates, run timer chip, and editor shortcuts (**⌘+Shift+F**, **⌘+S**).
- Primary tab navigation uses route transitions; **Columns** and **Samples** tables use sticky headers.
- Profiler histogram bins and column summary formatting improvements.
- **`GET /api/datasets/{id}/profile`** no longer blocks on `build_profile`; returns **`PROFILE_NOT_READY`** with **`job_id`** when the cache is empty.
- Upload/register queue profile refresh jobs; refresh endpoint dedupes active profile jobs.
- Datasets API split into `datasets_upload`, `datasets_profile`, `datasets_inspect`, and `datasets_jobs` modules (URLs unchanged).
- Ask persistence aligned with `Workspace.ask` (`AskStore`); agent workflow split into persistence/run modules.
- Query tab: `SqlEditor`, `SchemaDatasetBlock`, and `useSqlHistory` extracted from `QueryPage`.
- Sample rows API returns structured DuckDB error codes.
- Backend tests reorganized under `tests/api/`, `tests/profiler/`, and `tests/workspace/`.
- Frontend coverage baseline raised to **92%** (lines/statements); `types.ts` excluded from v8 coverage (still validated via `types.test.ts`).
- Workspace startup drops a legacy **`schema_version`** table when the current **`dcc_*`** schema validates (avoids requiring **`make clean-local`** after the migration removal).
- Documentation reorganized: slim root **`README.md`**, tightened **`docs/5-minute-tour.md`**, authoritative tier READMEs, expanded **`SECURITY.md`**, contributor-focused **`CONTRIBUTING.md`** / **`AGENTS.md`**.
- Dependency: **`idna`** 3.15 (addresses CVE-2026-45409 in 3.14).

### Removed

- README Screenshots section and wireframe SVGs under `docs/images/`.
- Unused `frontend/public/icons.svg` marketing sprite.
- Unused `Label` and `Kbd` UI primitives (and their tests).
- Unused exports `cardPadding` and `severityCssVar` from `tokens.ts`, and `chartGrid` from `chartTheme.ts`.
- Stale `.streamlit/secrets.toml` entry from `.gitignore`.
- Frontend **Quality** tab UI (`QualityPage`, profile diff dialog, issue list page).

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
