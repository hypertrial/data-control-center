import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Pragmatic omission: Vite bootstrap only (see plan).
const coverageExclude = ['src/main.tsx', 'src/vite-env.d.ts']

// Current baseline (~85%). Raise toward 100% as UiUrlSync, hooks, and chart branches gain tests.
const COVERAGE_BASELINE = 92

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageExclude,
        '**/*.test.{ts,tsx}',
        'src/test/**',
        '**/types.ts',
      ],
      all: true,
      thresholds: {
        statements: COVERAGE_BASELINE,
        lines: COVERAGE_BASELINE,
      },
    },
  },
})
