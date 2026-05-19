# Data Control Center — Frontend

React + Vite + TypeScript UI for browsing datasets, profiles, and SQL.

Product usage (tabs, shortcuts, Ask): [`docs/user-guide.md`](../docs/user-guide.md).

## Prerequisites

**Node.js 22** from [`.nvmrc`](../.nvmrc) (matches CI). Install dependencies via
**`make install`** from the repo root or **`npm install`** in this directory.

## Commands

From `frontend/`:

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Dev server on port **5173** |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm test` | Vitest (happy-dom) |
| `npm run test:coverage` | Vitest with **v8** coverage thresholds |

You can also run **`npm run dev`**, **`npm run lint`**, **`npm test`**, and **`npm run build`**
from the **repository root** — see root [`package.json`](../package.json); scripts delegate
into this package.

**Validation:** run **`make check`** from the repo root. After **`frontend/package-lock.json`**
changes, use **`make check-ci`**. See [`CONTRIBUTING.md`](../CONTRIBUTING.md#validation).

## API proxy

[`vite.config.ts`](vite.config.ts) proxies **`/api`** → **`http://127.0.0.1:8000`**. Start
the FastAPI backend separately (`make backend` or `make dev` from the repo root).

If Vite logs **`http proxy error`** / **`socket hang up`** for several `/api/...` paths at
once, the connection to the API was cut mid-request — often a **Uvicorn auto-reload** while
editing [`backend/app/`](../backend/app) (see root **`Makefile`**: `--reload-dir app`).
[`App.tsx`](src/App.tsx) configures TanStack Query with extra retries for transport failures.

## Layout and conventions

- **`src/features/`** — route-level pages (columns, samples, SQL, ask). The app
  opens on **Columns** by default; see [user guide](../docs/user-guide.md#profiles-and-jobs).
- **`src/api/`** — typed fetch client ([`client.ts`](src/api/client.ts)) and DTOs
  ([`types.ts`](src/api/types.ts)).
- **`src/lib/sql.ts`** — SQL identifier quoting and snippet builders ([`sql.test.ts`](src/lib/sql.test.ts)).
- **`src/hooks/useDisposableEChart.ts`** — ECharts lifecycle ([`useDisposableEChart.test.tsx`](src/hooks/useDisposableEChart.test.tsx)).
- **`src/store/uiStore.ts`** — Zustand UI state (active dataset, drawer, filters, SQL editor
  split height, schema rail collapse).

### TanStack Query keys

| Key | Purpose |
| --- | --- |
| `['datasets']` | Dataset list |
| `['profile', datasetId]` | Cached profile (prefer **`useDatasetProfile`**) |

Prefer **`useDatasetProfile`** (or **`api.fetchDatasetProfile`**) for profile loads; it
handles **`PROFILE_NOT_READY`** by polling **`details.job_id`**. Manual refresh uses
**`api.refreshProfile`** and job polling before invalidating profile-related keys.

**Ask** uses **`askAgentStream`** (SSE) only. First-run **AskHero**, **AskContextBar**,
conversation search/auto-title, follow-up chips, per-turn actions, and **SqlResultsGrid** for
in-turn previews live under `src/features/ask/`.
Profiles are **v4**-shaped (`entity_id_columns`,
`primary_grain_key_columns`, `primary_temporal_column`, etc.).

## Tests and coverage

Tests live next to sources as `*.test.ts(x)`. Thresholds in [`vitest.config.ts`](vitest.config.ts):
**`COVERAGE_BASELINE`** is **92** for lines and statements (excludes such as `main.tsx` and
`types.ts`). CI runs coverage via **`make check`** — see [`CONTRIBUTING.md`](../CONTRIBUTING.md#coverage).

[`src/api/types.ts`](src/api/types.ts) is validated by [`types.test.ts`](src/api/types.test.ts)
using fixtures in [`src/api/__fixtures__/`](src/api/__fixtures__/); keep fixtures aligned with
backend models when API shapes change.
