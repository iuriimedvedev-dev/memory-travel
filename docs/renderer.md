# Renderer decision: GraphGPU (kept, no fallback needed)

The brief allowed falling back to Reagraph if GraphGPU fought back for >1h.
It didn't — but only because the README undersells the library. Record of the
spike (graphgpu@0.3.2, `npm pack` inspection of `dist/`, ~25 min):

**README gaps (all resolved by reading `dist/index.d.ts` + `dist/index.js`):**

| Need | README says | dist actually has |
|------|-------------|-------------------|
| per-node highlight | only tag-based palettes | `getGraph().setNodeColor(id, [r,g,b,a])`, `setNodeSize(id, s)` + `markDirty()` |
| fixed UMAP positions | only force layouts | `put(tag, label, props, {x, y, size, color})`; layout simply never started |
| camera flights | only `fitView` | `setView(x, y, zoom)` / `getView()` — eased manually via rAF in `app/src/lib/cosmos.ts` |
| click / hover | event names only | `on('node:click'|'node:hover'|'node:hoverout')` with `e.target` |
| labels at 47k nodes | Canvas2D overlay, behaviour unclear | avoided entirely: `setLabelsVisible(false)` + HTML tooltip/panel |
| capacity | defaults 10k nodes / 50k edges | constructor `maxNodes` / `maxEdges` raised to 60k / 80k |

**What we rely on that issemi-undocumented:** `getGraph()` escape hatch for
per-node colour/size/position, and the `positions`/`colors` buffers. If a
future graphgpu release removes those, highlights degrade to selection halos
(all paint calls are already wrapped in try/catch).

**Known v1 limitations of this choice:**
- No bloom postprocessing — glow is faked with bright additive-ish colours on
  near-black background plus larger halo sizes. Honest and cheap.
- Edge highlight is global (`setEdgeOpacity`) rather than per-edge; the
  traversed subgraph reads clearly anyway because the travel canvas only
  contains ~350 nodes.
- Camera zoom units are lib-internal; flights use `currentZoom()`-relative
  factors, so they behave sanely regardless of scale conventions.
- WebGPU required (Chrome/Edge 113+). No WebGL fallback in v1 — acceptable
  for a local demo; Reagraph remains the documented fallback if this bites.
