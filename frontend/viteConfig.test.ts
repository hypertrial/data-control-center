import { describe, expect, it } from 'vitest'
import viteConfig from './vite.config'

describe('vite.config optimizeDeps', () => {
  it('pre-bundles dependencies that are only reachable via lazy-loaded routes', () => {
    // Columns/Charts/Query pages are lazy-loaded in App.tsx (`lazy(() => import(...))`), so
    // Vite's static-import crawl at dev-server startup never discovers packages that are only
    // imported from those chunks (@tanstack/react-table, echarts, sql-formatter). Without
    // listing them here, the first navigation to one of those routes triggers a live
    // dependency re-optimization mid-session, which surfaces to users as
    // `504 (Outdated Optimize Dep)` / "Failed to fetch dynamically imported module" errors.
    // If this test starts failing after adding a new lazy route, add its route-only
    // dependencies to `optimizeDeps.include` in vite.config.ts rather than removing them here.
    expect(viteConfig.optimizeDeps?.include).toEqual(
      expect.arrayContaining(['@tanstack/react-table', 'echarts', 'sql-formatter']),
    )
  })
})
