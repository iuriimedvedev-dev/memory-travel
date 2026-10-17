import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Memory bridge target — configurable so colleagues can point this at THEIR
// own memory service:  MEMORY_BRIDGE_URL=http://their-host:8099/mcp npm run dev
const BRIDGE_URL = process.env.MEMORY_BRIDGE_URL ?? 'http://10.66.66.99:8099/mcp'
const bridgeOrigin = new URL(BRIDGE_URL)
const BRIDGE_PATH = bridgeOrigin.pathname === '/' ? '/mcp' : bridgeOrigin.pathname

// Live recall-trace service (SSE stage telemetry). It runs on the SAME host as
// the MCP bridge on a different port (8098), and its routes are served at the
// root (/trace, /healthz). Assumption: when MEMORY_BRIDGE_URL is overridden we
// keep its host but swap the port to 8098; otherwise the documented default.
const TRACE_ORIGIN = `${bridgeOrigin.protocol}//${bridgeOrigin.hostname}:8098`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // baked into the client bundle as the DIRECT fallback URLs (used when no
    // same-origin proxy exists, e.g. `vite preview` / static hosting)
    __MEMORY_BRIDGE_URL__: JSON.stringify(BRIDGE_URL),
    __MEMORY_TRACE_URL__: JSON.stringify(TRACE_ORIGIN),
  },
  server: {
    proxy: {
      // Live memory bridge (Streamable HTTP MCP, no auth). The page and the
      // bridge are cross-origin, so dev traffic goes same-origin here and
      // the proxy forwards to the bridge. READ-ONLY: the client only ever
      // calls the `memory_recall` tool — nothing else is proxied.
      '/api/memory': {
        target: bridgeOrigin.origin,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/memory/, BRIDGE_PATH),
      },
      // Live recall trace (SSE). Root-served, so /api/trace/healthz -> /healthz
      // and /api/trace/trace?... -> /trace?... on the trace host. Read-only.
      '/api/trace': {
        target: TRACE_ORIGIN,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/trace/, ''),
      },
    },
  },
})
