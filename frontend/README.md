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

You can also run **`npm run dev`** from the **repository root** (see root [`README.md`](../README.md)); it forwards to this package.

## API proxy

[`vite.config.ts`](vite.config.ts) proxies **`/api`** → **`http://127.0.0.1:8000`**. Start the FastAPI backend separately (`make backend` or `make dev` from the repo root).

## Layout & conventions

- **`src/features/`** — route-level pages (overview, columns, quality, samples, SQL).
- **`src/api/`** — typed fetch client ([`client.ts`](src/api/client.ts)) and shared DTOs ([`types.ts`](src/api/types.ts)).
- **`src/lib/sql.ts`** — SQL identifier/string quoting and snippet builders (see unit tests in [`sql.test.ts`](src/lib/sql.test.ts)).
- **`src/hooks/useDisposableEChart.ts`** — shared ECharts init / `setOption` / resize / dispose lifecycle ([`useDisposableEChart.test.tsx`](src/hooks/useDisposableEChart.test.tsx)).
- **`src/store/uiStore.ts`** — Zustand UI state (active dataset, drawer, filters).

TanStack Query keys commonly used: `['datasets']`, `['profile', datasetId]`, `['quality', datasetId]`. Expensive profile recomputes use **`api.refreshProfile`** before invalidating those keys.

## Tests & coverage

Tests live next to sources as `*.test.ts(x)`. Coverage thresholds are defined in [`vitest.config.ts`](vitest.config.ts) (baseline **~85%** lines/statements with deliberate excludes); CI runs `npm run test:coverage`.
