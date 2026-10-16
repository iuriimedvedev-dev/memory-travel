import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Live memory bridge (Streamable HTTP MCP, no auth). The page and the
      // bridge are cross-origin, so dev traffic goes same-origin here and
      // the proxy forwards to the bridge. The app falls back to the direct
      // URL when no proxy is present (static preview / build).
      '/api/memory': {
        target: 'http://10.66.66.99:8099',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/memory/, '/mcp'),
      },
    },
  },
})
