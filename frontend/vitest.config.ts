import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Pragmatic omission: Vite bootstrap only (see plan).
const coverageExclude = ['src/main.tsx']

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        ...coverageExclude,
        '**/*.test.{ts,tsx}',
        '**/types.ts',
        'src/test/**',
      ],
      all: true,
      thresholds: {
        statements: 100,
        lines: 100,
      },
    },
  },
})
