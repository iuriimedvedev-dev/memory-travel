# Memory Travel ✦ — how machine memory remembers

A browser tool that shows how HARS long-term memory works: a query's journey
through embeddings → vector hits → graph walk → BM25 → fusion → rerank →
context assembly → grounded answer. Cosmic look, zero mockups — every pixel is
driven by real memory telemetry or the real index.

## Run it (offline-first, zero live dependencies)

```bash
cd app
npm install
npm run dev      # → http://localhost:5173
```

The demo serves only static files under `app/public/data/`. It survives memory
service restarts — no live calls at runtime.

## Views

- **Cosmos** — the full production index: 47,355 entities / 54,502 relations,
  positioned by UMAP over the stored 768-dim vectors. Search, click for entity
  info, pan/zoom. “Take the tour” jumps into Travel.
- **Travel** — scripted playback of a saved recall trace (5 questions, picker
  at top): scrubbable 8-stage timeline with eased camera flights, score bars,
  before/after rerank lists, context blocks, and an extractive answer preview
  whose citations fly back to their nodes.

## Where the data came from (reproducible pipeline)

All under `scripts/` (Python 3.13, see `.venv`; read-only wrt the live index):

1. `capture_fixtures.py` — 5 real `memory_recall` calls via the HTTP bridge
   (`initialize → notifications/initialized → tools/call`), saved raw to
   `fixtures/trace_*.json`. The ONLY step that ever touched a live service.
2. `export_graph.py` — `graphml` → `app/public/data/graph.json` (9.2 MB:
   entity names/types/descriptions/degrees + index-pair edges) and
   `node_index.json`.
3. `compute_umap.py` — UMAP (cosine, seed-fixed) over the **stored** vectors
   from `vdb_entities.json` / `vdb_chunks.json` → `coords_entities.json`,
   `coords_chunks.json`. CPU-only, ~10 min for 47k points.
4. `compile_trace.py` — fixture → `app/public/data/traces/trace_XX.json`:
   ranked hits per channel, rerank before/after, traversed subgraph (context
   entities + chunk-linked entities + 1-hop BFS, capped 350 nodes), context
   blocks, extractive answer preview. Query markers are embedded live ONCE at
   compile time (`localhost:8791`) and UMAP-projected with the same fit.

Re-running 2–4 needs only the index dumps + (for 4) the embedder; the app
itself needs none of it.

## What works vs what's stubbed/honest-approximation

- WORKS: full-graph cosmos render (GraphGPU/WebGPU), search + node info,
  all 8 travel stages with real scores/latencies/ids, camera flights, trace
  picker, autoplay + scrubber, `tsc` + `vite build` clean.
- APPROXIMATIONS (all labelled in-UI):
  - “Pre-rerank” order is reconstructed as dense-score order — the live
    response only exposes post-rerank `fused_chunks`. `docs/trace-api.md`
    specifies the event that would remove this.
  - Query marker sits at the centroid of its top vector hits on the entity
    map (true embedding-space xy ships in the trace file for a future inset).
  - Answer panel is an *extractive preview* (verbatim quotes), because the
    service runs `context_only=true` — the LLM synthesis happens in the
    caller. The UI says so.
- NOT DONE (v2): live SSE animation — see `docs/trace-api.md` for the
  `memory_trace` endpoint spec the memory service should expose. No service
  code was touched.

## Docs

- `docs/trace-api.md` — SSE `memory_trace` spec for live v2 animation.
- `docs/renderer.md` — why GraphGPU survived the 1-hour challenge (README
  gaps vs actual `dist/` API).

## Constraints honoured

Read-only index access throughout; no service restarts; no index writes; no
GPU jobs on the box (UMAP on CPU, npm/vite only); nothing pushed anywhere —
local commits only; no commits to `hars-longterm-memory`.
