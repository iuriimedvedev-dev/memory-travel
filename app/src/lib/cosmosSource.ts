// Cosmos data source: LIVE (the connected memory) vs DEMO (baked snapshot).
//
// Data-integrity rule (the reason this module exists): the UI must never render
// a graph from a memory it is not connected to. The old behaviour loaded the
// baked fixtures unconditionally in every deployment, so a deployment pointed
// at a DIFFERENT index showed our HARS data as if it were theirs. Now:
//
//   1. probe GET /api/stats  (Vite proxy /api/graph-stats -> trace server :8098)
//   2. reachable  -> load /api/graph + /api/coords -> LIVE, badged "live: <index_id>"
//   3. unreachable -> honest "not connected" state; fixtures exist ONLY behind
//      an explicit user action ("Open demo data"), badged "demo: offline snapshot".
//
// The identity (index_id, docs, counts, last_ingest) always comes from the
// server response — never hardcoded here. Same endpoint-tries order as
// lib/live.ts: same-origin proxy first, then the baked direct URL.

import type { CosmosGraph } from "./types";

export interface GraphStats {
  index_id: string;
  docs: number | null;
  chunks: number | null;
  entities: number | null;
  relations: number | null;
  nodes: number | null;
  edges: number | null;
  last_ingest: string | null;
  generated_at?: string;
}

/** Anything served by /api/graph: fixture-compatible CosmosGraph + identity. */
export interface LoadedCosmos {
  source: "live" | "demo";
  graph: CosmosGraph;
  names: string[];
  coords: { ids: string[]; xy: [number, number][]; xyz?: [number, number, number][] };
  chunkCoords: Record<string, [number, number, number]>;
  /** /api/stats payload when source==="live", null for the demo snapshot. */
  identity: GraphStats | null;
  /** present when the live /graph response was sampled (meta.sampled). */
  sampled: { nodes: number; fullNodes: number; edges: number; fullEdges: number } | null;
}

export type SourcePhase =
  | { phase: "probing" }
  | { phase: "live" }
  | { phase: "unreachable"; error: string }
  | { phase: "demo" };

// Same bases as the trace client (vite.config.ts): dev proxy first, then the
// build-time direct URL. The trace server sends CORS *, so direct works too.
export const GRAPH_PROXY_PATH = "/api/graph-stats";

declare const __MEMORY_TRACE_URL__: string;
const TRACE_DIRECT_URL =
  typeof __MEMORY_TRACE_URL__ === "string" ? __MEMORY_TRACE_URL__ : "http://10.66.66.99:8098";

function graphBases(): string[] {
  return [GRAPH_PROXY_PATH, TRACE_DIRECT_URL];
}

/** fetch JSON with the HTML-masquerade check (Vite SPA fallback answers 200). */
async function getJSON<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) throw new Error(`fetch ${path}: got HTML instead of JSON`);
  return (await r.json()) as T;
}

async function getJSONFromBases<T>(make: (base: string) => string, timeoutMs = 8000): Promise<T> {
  const failures: string[] = [];
  for (const base of graphBases()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await getJSON<T>(make(base), ctrl.signal);
    } catch (e) {
      failures.push(`${base}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(failures.join(" | "));
}

export interface GraphApiResponse {
  ok: boolean;
  meta: {
    index_id: string;
    docs: number | null;
    nodes: number;
    edges: number;
    full_nodes: number;
    full_edges: number;
    sampled: boolean;
    node_limit: number;
    edge_limit: number;
  };
  nodes: { id: string; label: string; type: string; degree: number; desc_head: string }[];
  edges: [number, number][];
}

export interface CoordsApiResponse {
  ok: boolean;
  meta: { index_id: string; dim: number; generated_at?: string };
  entities: { ids: string[]; xy: [number, number][]; xyz?: [number, number, number][] };
  chunks: Record<string, [number, number, number]>;
}

/** Identity probe: the ONLY thing that decides live vs not-connected. */
export function probeGraphStats(timeoutMs = 8000): Promise<GraphStats> {
  return getJSONFromBases<GraphStats>((base) => `${base}/stats`, timeoutMs);
}

/** The connected graph + coords. `identity` is the /stats payload probed
 *  beforehand (kept for the HUD/About card). Throws with the server's hint. */
export async function loadLiveCosmos(identity: GraphStats): Promise<LoadedCosmos> {
  const [g, coords] = await Promise.all([
    getJSONFromBases<GraphApiResponse>((base) => `${base}/graph`),
    getJSONFromBases<CoordsApiResponse>((base) => `${base}/coords?dim=3`),
  ]);
  return {
    source: "live",
    graph: {
      nodes: g.nodes.map((n) => ({ id: n.id, t: n.type, d: n.desc_head, deg: n.degree })),
      edges: g.edges,
    },
    names: g.nodes.map((n) => n.id),
    coords: { ids: coords.entities.ids, xy: coords.entities.xy, xyz: coords.entities.xyz },
    chunkCoords: coords.chunks,
    identity,
    sampled: g.meta.sampled
      ? {
          nodes: g.meta.nodes,
          fullNodes: g.meta.full_nodes,
          edges: g.meta.edges,
          fullEdges: g.meta.full_edges,
        }
      : null,
  };
}

/** The explicit demo dataset: the baked offline snapshot in public/data. */
export async function loadDemoCosmos(): Promise<LoadedCosmos> {
  const [g, idx, coords, cxyz] = await Promise.all([
    getJSON<CosmosGraph>("data/graph.json"),
    getJSON<string[]>("data/node_index.json"),
    getJSON<{ ids: string[]; xy: [number, number][]; xyz?: [number, number, number][] }>(
      "data/coords_entities.json",
    ),
    getJSON<Record<string, [number, number, number]>>("data/coords_chunks.json"),
  ]);
  return {
    source: "demo",
    graph: g,
    names: idx,
    coords,
    chunkCoords: cxyz,
    identity: null,
    sampled: null,
  };
}
