// Cosmos data source: LIVE (the connected memory scope) vs DEMO (baked snapshot).
//
// Data-integrity rule (the reason this module exists): the UI must never render
// a graph from a memory it is not connected to.
//
//   1. probe GET /api/stats?project=<id>  (proxy /memory/api/graph-stats -> :8098)
//   2. reachable  -> load /api/graph?project=<id> + /api/coords?dim=3&project=<id>
//   3. unreachable -> honest "not connected" state; fixtures exist ONLY behind
//      an explicit user action ("Open demo data"), badged "demo: offline snapshot".
//
// Uses `fetchWithOAuth` so protected scopes (`user_*`, `dept_*`, `chat_*`)
// automatically attach the OAuth 2.1 Bearer token and handle 401 refresh/redirect.

import { DEFAULT_PROJECT_ID } from "./projects.ts";
import {
  OAuthLoopGuardError,
  OAuthRedirectInProgressError,
  fetchWithOAuth,
  isOAuthRedirectInProgress,
} from "./oauth.ts";
import type { CosmosGraph } from "./types.ts";

export interface GraphStats {
  index_id: string;
  project?: string;
  empty?: boolean;
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
  projectId: string;
  empty: boolean;
  graph: CosmosGraph;
  names: string[];
  coords: { ids: string[]; xy: [number, number][]; xyz?: [number, number, number][] };
  chunkCoords: Record<string, [number, number, number]>;
  /** Identity shown to the user: the /api/stats payload when source==="live",
   *  a fixture-derived synthetic identity when source==="demo" (never live). */
  identity: GraphStats | null;
  /** present when the live /graph response was sampled (meta.sampled). */
  sampled: { nodes: number; fullNodes: number; edges: number; fullEdges: number } | null;
}

export type SourcePhase =
  | { phase: "probing" }
  | { phase: "live" }
  | { phase: "unreachable"; error: string }
  | { phase: "demo" };

const API_BASE = (import.meta.env?.BASE_URL ?? "").replace(/\/+$/, "");
export const GRAPH_PROXY_PATH = `${API_BASE}/api/graph-stats`;

declare const __MEMORY_TRACE_URL__: string;
const TRACE_DIRECT_URL =
  typeof __MEMORY_TRACE_URL__ === "string" ? __MEMORY_TRACE_URL__ : "";

export function graphBases(pathnameOverride?: string): string[] {
  const pathname =
    pathnameOverride !== undefined
      ? pathnameOverride
      : typeof window !== "undefined"
        ? window.location.pathname
        : "";
  const onMemoryMount = pathname === "/memory" || pathname.startsWith("/memory/");
  if (onMemoryMount) {
    return [...new Set(["/memory/api/graph-stats", TRACE_DIRECT_URL].filter(Boolean))];
  }
  const candidates = [
    GRAPH_PROXY_PATH,
    "/memory/api/graph-stats",
    "/travel/api/graph-stats",
    "/api/graph-stats",
    TRACE_DIRECT_URL,
  ];
  return [...new Set(candidates.filter(Boolean))];
}

export type OAuthFetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** fetch JSON via `fetchWithOAuth` with the HTML-masquerade check (SPA fallback answers 200). */
export async function getJSON<T>(
  path: string,
  signal?: AbortSignal,
  oauthFetch: OAuthFetchLike = (input, init) => fetchWithOAuth(input, init),
): Promise<T> {
  const r = await oauthFetch(path, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) throw new Error(`fetch ${path}: got HTML instead of JSON`);
  return (await r.json()) as T;
}

async function getStaticJSON<T>(path: string): Promise<T> {
  const r = await fetch(path, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) throw new Error(`fetch ${path}: got HTML instead of JSON`);
  return (await r.json()) as T;
}

export const GRAPH_PROBE_TIMEOUT_MS = 20_000;
export const GRAPH_LOAD_TIMEOUT_MS = 120_000;

export interface GraphRequestDeps {
  bases?: string[];
  oauthFetch?: OAuthFetchLike;
}

async function getJSONFromBases<T>(
  make: (base: string) => string,
  timeoutMs = GRAPH_LOAD_TIMEOUT_MS,
  deps: GraphRequestDeps = {},
): Promise<T> {
  const failures: string[] = [];
  const bases = deps.bases ?? graphBases();
  const oauthFetch = deps.oauthFetch;
  for (const base of bases) {
    const cleanBase = base.replace(/\/+$/, "");
    const url = make(cleanBase);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
      return await getJSON<T>(url, ctrl.signal, oauthFetch);
    } catch (e) {
      if (
        e instanceof OAuthRedirectInProgressError ||
        e instanceof OAuthLoopGuardError ||
        isOAuthRedirectInProgress()
      ) {
        throw e;
      }
      failures.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(failures.join(" | "));
}

export interface GraphApiResponse {
  ok: boolean;
  empty?: boolean;
  meta?: {
    index_id?: string;
    docs?: number | null;
    nodes?: number;
    edges?: number;
    full_nodes?: number;
    full_edges?: number;
    sampled?: boolean;
    node_limit?: number;
    edge_limit?: number;
  };
  nodes?: { id: string; label?: string; type: string; degree: number; desc_head: string }[];
  edges?: [number, number][];
}

export interface CoordsApiResponse {
  ok: boolean;
  empty?: boolean;
  meta?: { index_id?: string; dim?: number; generated_at?: string };
  entities?: { ids?: string[]; xy?: [number, number][]; xyz?: [number, number, number][] };
  chunks?: Record<string, [number, number, number]>;
}

/** Identity probe: decides live vs not-connected for the selected project scope. */
export function probeGraphStats(
  projectId: string = DEFAULT_PROJECT_ID,
  timeoutMs = GRAPH_PROBE_TIMEOUT_MS,
  deps: GraphRequestDeps = {},
): Promise<GraphStats> {
  const proj = encodeURIComponent((projectId || DEFAULT_PROJECT_ID).trim());
  return getJSONFromBases<GraphStats>((base) => `${base}/stats?project=${proj}`, timeoutMs, deps);
}

/** The connected graph + coords for `projectId`. Handles empty scopes cleanly. */
export async function loadLiveCosmos(
  identity: GraphStats,
  projectId: string = DEFAULT_PROJECT_ID,
  timeoutMs = GRAPH_LOAD_TIMEOUT_MS,
  deps: GraphRequestDeps = {},
): Promise<LoadedCosmos> {
  const cleanProject = (projectId || DEFAULT_PROJECT_ID).trim();
  const proj = encodeURIComponent(cleanProject);

  // Short-circuit if `/stats` already explicitly reported an empty scope with 0 nodes
  const gPromise = getJSONFromBases<GraphApiResponse>((base) => `${base}/graph?project=${proj}`, timeoutMs, deps);
  const coordsPromise = getJSONFromBases<CoordsApiResponse>(
    (base) => `${base}/coords?dim=3&project=${proj}`,
    timeoutMs,
    deps,
  ).catch((coordsErr: unknown) => {
    if (
      coordsErr instanceof OAuthRedirectInProgressError ||
      coordsErr instanceof OAuthLoopGuardError ||
      isOAuthRedirectInProgress()
    ) {
      throw coordsErr;
    }
    return { __coordsErr: coordsErr } as unknown as CoordsApiResponse & { __coordsErr?: unknown };
  });

  const [g, maybeCoords] = await Promise.all([gPromise, coordsPromise]);
  const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
  const rawEdges = Array.isArray(g.edges) ? g.edges : [];
  const isEmpty = Boolean(g.empty || identity.empty || rawNodes.length === 0);

  if (!isEmpty && "__coordsErr" in maybeCoords && maybeCoords.__coordsErr) {
    throw maybeCoords.__coordsErr;
  }

  const coords: CoordsApiResponse =
    "__coordsErr" in maybeCoords ? { ok: true, empty: true, entities: { ids: [], xy: [], xyz: [] }, chunks: {} } : maybeCoords;

  const ids = Array.isArray(coords.entities?.ids) ? coords.entities!.ids! : [];
  const xy = Array.isArray(coords.entities?.xy) ? coords.entities!.xy! : [];
  const xyz = Array.isArray(coords.entities?.xyz) ? coords.entities!.xyz : undefined;
  const chunks = coords.chunks ?? {};
  const meta = g.meta;

  return {
    source: "live",
    projectId: cleanProject,
    empty: isEmpty,
    graph: {
      nodes: rawNodes.map((n) => ({ id: n.id, t: n.type ?? "unknown", d: n.desc_head ?? "", deg: n.degree ?? 0 })),
      edges: rawEdges,
    },
    names: rawNodes.map((n) => n.id),
    coords: { ids, xy, xyz },
    chunkCoords: chunks,
    identity: {
      ...identity,
      empty: isEmpty,
      nodes: identity.nodes ?? rawNodes.length,
      edges: identity.edges ?? rawEdges.length,
    },
    sampled:
      meta?.sampled && typeof meta.nodes === "number" && typeof meta.full_nodes === "number"
        ? {
            nodes: meta.nodes,
            fullNodes: meta.full_nodes,
            edges: meta.edges ?? rawEdges.length,
            fullEdges: meta.full_edges ?? rawEdges.length,
          }
        : null,
  };
}

/** Identity of the synthetic demo dataset. NEVER read from /api/stats: the
 *  demo is not the connected index, so its numbers come from its own files. */
export const DEMO_INDEX_ID = "demo-hars-snapshot (synthetic)";

function demoIdentity(g: CosmosGraph, chunks: number): GraphStats {
  return {
    index_id: DEMO_INDEX_ID,
    docs: null,
    chunks,
    entities: g.nodes.length,
    relations: g.edges.length,
    nodes: g.nodes.length,
    edges: g.edges.length,
    last_ingest: "synthetic fixture — no live data",
  };
}

/** The explicit demo dataset: the baked SYNTHETIC snapshot in public/data. */
export async function loadDemoCosmos(): Promise<LoadedCosmos> {
  const base = import.meta.env?.BASE_URL ?? "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  const [g, idx, coords, cxyz] = await Promise.all([
    getStaticJSON<CosmosGraph>(`${prefix}data/graph.json`),
    getStaticJSON<string[]>(`${prefix}data/node_index.json`),
    getStaticJSON<{ ids: string[]; xy: [number, number][]; xyz?: [number, number, number][] }>(
      `${prefix}data/coords_entities.json`,
    ),
    getStaticJSON<Record<string, [number, number, number]>>(`${prefix}data/coords_chunks.json`),
  ]);
  return {
    source: "demo",
    projectId: "demo",
    empty: g.nodes.length === 0,
    graph: g,
    names: idx,
    coords,
    chunkCoords: cxyz,
    identity: demoIdentity(g, Object.keys(cxyz).length),
    sampled: null,
  };
}
