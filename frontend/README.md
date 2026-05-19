# Data Control Center — Frontend

React + Vite + TypeScript UI for browsing datasets, profiles, SQL, and quality insights.

## Prerequisites

Use the Node version from [`.nvmrc`](../.nvmrc) (same as CI).

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

You can also run **`npm run dev`**, **`npm run lint`**, **`npm test`**, and **`npm run build`** from the **repository root** — see root [`package.json`](../package.json) / [`README.md`](../README.md); scripts delegate into this package.

## API proxy

[`vite.config.ts`](vite.config.ts) proxies **`/api`** → **`http://127.0.0.1:8000`**. Start the FastAPI backend separately (`make backend` or `make dev` from the repo root).

If Vite logs **`http proxy error`** / **`socket hang up`** for several `/api/...` paths at once, the connection to the API was cut mid-request — often a **Uvicorn auto-reload** while editing [`backend/app/`](../backend/app) (see root **`Makefile`**: `--reload-dir app`). [`App.tsx`](src/App.tsx) configures TanStack Query with **extra retries** for typical fetch/transport failures so the UI usually recovers without manual reload.

## Layout & conventions

- **`src/features/`** — route-level pages (overview, columns, quality, samples, SQL). On **Overview**, the **Structure** card separates **Entities** (identifier-like columns) from **Row grain** (composite key chips); see root [`README.md`](../README.md) usage notes.
- **`src/api/`** — typed fetch client ([`client.ts`](src/api/client.ts)) and shared DTOs ([`types.ts`](src/api/types.ts)).
- **`src/lib/sql.ts`** — SQL identifier/string quoting and snippet builders (see unit tests in [`sql.test.ts`](src/lib/sql.test.ts)).
- **`src/hooks/useDisposableEChart.ts`** — shared ECharts init / `setOption` / resize / dispose lifecycle ([`useDisposableEChart.test.tsx`](src/hooks/useDisposableEChart.test.tsx)).
- **`src/store/uiStore.ts`** — Zustand UI state (active dataset, drawer, filters).

TanStack Query keys commonly used: `['datasets']`, `['profile', datasetId]`, `['quality', datasetId]`. Prefer **`useDatasetProfile`** (or **`api.fetchDatasetProfile`**) for profile loads; it handles **`PROFILE_NOT_READY`** by polling the job in **`details.job_id`**. Manual refresh uses **`api.refreshProfile`** and the hook’s job polling before invalidating profile-related keys.

## Tests & coverage

Tests live next to sources as `*.test.ts(x)`. Coverage thresholds are defined in [`vitest.config.ts`](vitest.config.ts): **`COVERAGE_BASELINE`** is **92** for both **lines** and **statements** (with deliberate excludes such as `main.tsx` and `types.ts`); CI runs `npm run test:coverage`.

[`src/api/types.ts`](src/api/types.ts) is validated by [`types.test.ts`](src/api/types.test.ts) using fixtures in [`src/api/__fixtures__/`](src/api/__fixtures__/); keep those fixtures aligned with backend models when API shapes change.
