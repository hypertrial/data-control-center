import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts')) return 'echarts'
          if (id.includes('@codemirror') || id.includes('@uiw/react-codemirror')) return 'codemirror'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['**/coverage/**'],
    },
    // If you see `http proxy error` + `socket hang up` for several `/api/...` paths at the same
    // second, check the Uvicorn terminal for a reload/restart — that drops in-flight requests
    // (see root Makefile: `--reload-dir app` reduces restarts on test edits only).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
