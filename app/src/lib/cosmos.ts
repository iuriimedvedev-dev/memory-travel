// GraphGPU facade for Memory Travel.
// Verified against graphgpu@0.3.2 dist: put(tag,label,props,opts{x,y,size,color}),
// link(a,tag,b), fitView, setView/getView, on('node:click'...), getGraph() with
// setNodeColor(id,[r,g,b,a]) / setNodeSize(id,s) / setNodePosition(id,x,y),
// markDirty, destroy. Camera flights are eased manually via rAF + setView
// (the lib only exposes instant setView).
import { GraphGPU } from "graphgpu";
import type { CosmosGraph } from "./types";
import { colorForType, familyOf, hexToRGBA } from "./palette";
import { hasWebGPU, webgpuInitFailedError, webgpuMissingError } from "./webgpu";

export type RGBA = [number, number, number, number];

/** UMAP [-1,1] -> world scale. Marker positions must use toWorld(). */
export const WORLD_SCALE = 90;

export function toWorld(xy: [number, number]): [number, number] {
  return [xy[0] * WORLD_SCALE, -xy[1] * WORLD_SCALE];
}

export const INK: Record<string, RGBA> = {
  base: [0.23, 0.3, 0.48, 1],
  dim: [0.13, 0.16, 0.28, 1],
  cyan: [0.2, 0.95, 1.0, 1],
  gold: [1.0, 0.78, 0.25, 1],
  magenta: [1.0, 0.35, 0.85, 1],
  green: [0.35, 1.0, 0.55, 1],
  orange: [1.0, 0.55, 0.2, 1],
  white: [1.0, 1.0, 1.0, 1],
  query: [1.0, 0.3, 0.5, 1],
};

export interface SelectedNode {
  gpuId: number;
  graphIdx: number;
  name: string;
}

export class Cosmos {
  private g: GraphGPU | null = null;
  private gpuOf: number[] = []; // graphIdx -> gpu node id
  private idxOf = new Map<number, number>(); // gpu node id -> graphIdx
  private baseSize: number[] = [];
  private baseColor: RGBA[] = [];
  private types: string[] = [];
  private hidden = new Set<string>(); // legend-off families (see setHiddenTypes)
  private linkBatch: number[] = [];
  private raf = 0;
  onSelect: ((s: SelectedNode | null) => void) | null = null;
  onHover: ((s: SelectedNode | null) => void) | null = null;
  private nameOf: string[] = [];

  get ready(): boolean {
    return this.g !== null;
  }

  get linksLoaded(): number {
    return this.linkBatch.length;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    // Fail LOUD: without WebGPU (or if GraphGPU refuses to start on the
    // real graph) callers must surface this to the error overlay — GraphGPU
    // itself resolves init() === false and renders nothing (black canvas).
    if (!canvas) throw new Error("cosmos init failed at stage=canvas: no canvas element");
    if (!hasWebGPU()) throw webgpuMissingError();
    let g: GraphGPU;
    try {
      g = new GraphGPU({
        canvas,
        background: [0.012, 0.016, 0.045, 1],
        nodeSize: 6,
        edgeOpacity: 0.09,
        maxNodes: 60000,
        maxEdges: 80000,
      });
    } catch (e) {
      throw new Error(`cosmos init failed at stage=construct: ${e instanceof Error ? e.message : String(e)}`);
    }
    let ok = false;
    try {
      ok = await g.init();
    } catch (e) {
      throw new Error(`cosmos init failed at stage=gpu-init: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!ok) {
      // init() === false means the renderer refused (no adapter/device).
      // Distinguish "browser has no WebGPU at all" from "init refused".
      try {
        g.destroy();
      } catch { /* noop */ }
      throw ((navigator as Navigator & { gpu?: unknown }).gpu == null
        ? webgpuMissingError()
        : webgpuInitFailedError("GraphGPU init() returned false"));
    }
    g.setLabelsVisible(false);
    this.g = g;
    g.on("node:click", (e: unknown) => {
      const t = (e as { target?: { id?: number } })?.target;
      const gpuId = typeof t === "number" ? t : t?.id;
      if (gpuId === undefined || !this.onSelect) return;
      const graphIdx = this.idxOf.get(gpuId) ?? -1;
      this.onSelect(
        graphIdx >= 0
          ? { gpuId, graphIdx, name: this.nameOf[graphIdx] ?? `#${gpuId}` }
          : null,
      );
    });
    g.on("node:hover", (e: unknown) => {
      if (!this.onHover) return;
      const t = (e as { target?: { id?: number } })?.target;
      const gpuId = typeof t === "number" ? t : t?.id;
      if (gpuId === undefined) {
        this.onHover(null);
        return;
      }
      const graphIdx = this.idxOf.get(gpuId) ?? -1;
      this.onHover(
        graphIdx >= 0
          ? { gpuId, graphIdx, name: this.nameOf[graphIdx] ?? `#${gpuId}` }
          : null,
      );
    });
    g.on("node:hoverout", () => this.onHover?.(null));
  }

  /** Load the full graph at UMAP positions. No force layout — coordinates ARE the layout. */
  async load(
    graph: CosmosGraph,
    xyByIdx: ([number, number] | null)[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const g = this.g;
    if (!g) throw new Error("cosmos not initialised");
    const n = graph.nodes.length;
    const hex = (c: RGBA) =>
      `#${c
        .slice(0, 3)
        .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
        .join("")}`;
    this.gpuOf = new Array(n);
    this.baseSize = new Array(n);
    this.baseColor = new Array(n);
    this.nameOf = graph.nodes.map((nd) => nd.id);
    const S = 90; // world scale for UMAP [-1,1]
    for (let i = 0; i < n; i++) {
      const nd = graph.nodes[i];
      const xy = xyByIdx[i];
      const size = 3.2 + Math.min(9, Math.sqrt(nd.deg) * 1.6);
      const base = hexToRGBA(colorForType(nd.t)); // colour IS the entity family (legend parity)
      const id = g.put(nd.t || "node", nd.id, {}, {
        x: xy ? xy[0] * S : (Math.random() - 0.5) * S,
        y: xy ? -xy[1] * S : (Math.random() - 0.5) * S,
        size,
        color: hex(base),
      });
      this.gpuOf[i] = id;
      this.idxOf.set(id, i);
      this.baseSize[i] = size;
      this.baseColor[i] = base;
      this.types[i] = nd.t;
      if (onProgress && i % 8000 === 0) {
        onProgress(i, n);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(n, n);
    const m = graph.edges.length;
    const batch: number[] = [];
    for (let k = 0; k < m; k++) {
      const [s, t] = graph.edges[k];
      try {
        const ids = g.link(this.gpuOf[s], "rel", this.gpuOf[t]);
        if (ids?.[0] !== undefined) batch.push(ids[0]);
      } catch {
        /* ignore stray links */
      }
      if (k % 20000 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    this.linkBatch = batch;
    g.fitView(0.12);
  }

  /** Remove all nodes/edges (e.g. before loading a different subgraph). */
  clear(): void {
    try {
      this.g?.clear();
    } catch { /* noop */ }
    this.gpuOf = [];
    this.idxOf.clear();
    this.baseSize = [];
    this.baseColor = [];
    this.types = [];
    this.linkBatch = [];
    this.nameOf = [];
  }

  /**
   * Legend toggles: families here get repainted to a near-invisible ghost.
   * Explicit paint() highlights re-apply on top; paint(null) respects hiding.
   */
  setHiddenTypes(types: Set<string>): void {
    this.hidden = types;
    const g = this.g;
    if (!g) return;
    const gg = g.getGraph() as unknown as { setNodeColor(id: number, c: RGBA): void };
    try {
      const ghost: RGBA = [0.13, 0.15, 0.24, 0.22];
      for (let i = 0; i < this.gpuOf.length; i++) {
        if (this.hidden.has(familyOf(this.types[i]))) gg.setNodeColor(this.gpuOf[i], ghost);
      }
      g.markDirty();
    } catch { /* noop */ }
  }

  /** Add an ad-hoc marker node (query point, chunk hit). Returns gpu id. */
  addMarker(label: string, x: number, y: number, size: number, color: RGBA): number {
    const g = this.g;
    if (!g) throw new Error("cosmos not initialised");
    const hex = `#${color.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
    return g.put("marker", label, {}, { x, y, size, color: hex });
  }

  moveMarker(gpuId: number, x: number, y: number, size?: number): void {
    try {
      const gg = this.g?.getGraph() as unknown as {
        setNodePosition(id: number, x: number, y: number): void;
        setNodeSize(id: number, s: number): void;
      } | undefined;
      gg?.setNodePosition(gpuId, x, y);
      if (size !== undefined) gg?.setNodeSize(gpuId, size);
    } catch { /* noop */ }
  }

  removeMarker(gpuId: number): void {
    try {
      this.g?.unput(gpuId);
    } catch { /* noop */ }
  }

  /** Recolour/resize a set of graph nodes by index. Pass null to reset all to base. */
  paint(paints: Map<number, { color: RGBA; size?: number }> | null): void {
    const g = this.g;
    if (!g) return;
    const gg = g.getGraph() as unknown as {
      setNodeColor(id: number, c: RGBA): void;
      setNodeSize(id: number, s: number): void;
    };
    try {
      if (paints === null) {
        for (let i = 0; i < this.gpuOf.length; i++) {
          gg.setNodeColor(this.gpuOf[i], this.baseColor[i]);
          gg.setNodeSize(this.gpuOf[i], this.baseSize[i]);
        }
        // re-ghost legend-hidden families after a reset
        if (this.hidden.size) {
          const ghost: RGBA = [0.13, 0.15, 0.24, 0.22];
          for (let i = 0; i < this.gpuOf.length; i++) {
            if (this.hidden.has(familyOf(this.types[i]))) gg.setNodeColor(this.gpuOf[i], ghost);
          }
        }
      } else {
        for (const [idx, p] of paints) {
          gg.setNodeColor(this.gpuOf[idx], p.color);
          gg.setNodeSize(this.gpuOf[idx], p.size ?? this.baseSize[idx] * 2.2);
        }
      }
      g.markDirty();
    } catch { /* renderer without per-node API: highlights degrade to selection */ }
  }

  /** Dim everything except the given indices (spotlight effect). */
  spotlight(keep: Set<number> | null): void {
    const g = this.g;
    if (!g) return;
    const gg = g.getGraph() as unknown as { setNodeColor(id: number, c: RGBA): void };
    try {
      if (keep === null) {
        for (let i = 0; i < this.gpuOf.length; i++) gg.setNodeColor(this.gpuOf[i], this.baseColor[i]);
      } else {
        const dim: RGBA = [0.07, 0.09, 0.16, 1];
        for (let i = 0; i < this.gpuOf.length; i++) {
          if (!keep.has(i)) gg.setNodeColor(this.gpuOf[i], dim);
        }
      }
      g.markDirty();
    } catch { /* noop */ }
  }

  setEdgeOpacity(v: number): void {
    try {
      this.g?.setEdgeOpacity(v);
    } catch { /* noop */ }
  }

  /** Smooth eased camera flight. getView shape is lib-internal; read defensively. */
  flyTo(x: number, y: number, zoom: number, ms = 1400): void {
    const g = this.g;
    if (!g) return;
    cancelAnimationFrame(this.raf);
    const v = g.getView() as unknown as Record<string, number>;
    const from = { x: v.x ?? 0, y: v.y ?? 0, z: v.zoom ?? v.scale ?? v.k ?? 1 };
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      try {
        g.setView(from.x + (x - from.x) * e, from.y + (y - from.y) * e, from.z + (zoom - from.z) * e);
      } catch { /* noop */ }
      if (p < 1) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  fit(padding = 0.12): void {
    try {
      this.g?.fitView(padding);
    } catch { /* noop */ }
  }

  currentZoom(): number {
    try {
      const v = (this.g?.getView() as unknown as Record<string, number>) ?? {};
      return v.zoom ?? v.scale ?? v.k ?? 1;
    } catch {
      return 1;
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    try {
      this.g?.destroy();
    } catch { /* noop */ }
    this.g = null;
  }
}
