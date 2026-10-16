import type { CosmosGraph, TraceManifestEntry, TravelTrace } from "./types";

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  // Vite dev answers unknown paths with index.html (SPA fallback, HTTP 200):
  // detect the HTML masquerade so the error still names the missing file.
  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) throw new Error(`fetch ${path}: got HTML instead of JSON (file missing — dev fallback served index.html)`);
  return (await r.json()) as T;
}

export const loadGraph = () => getJSON<CosmosGraph>("data/graph.json");
export const loadNodeIndex = () => getJSON<string[]>("data/node_index.json");
export const loadEntityCoords = () =>
  getJSON<{ ids: string[]; xy: [number, number][] }>("data/coords_entities.json");
export const loadChunkCoords = () =>
  getJSON<Record<string, [number, number]>>("data/coords_chunks.json");
export const loadManifest = () =>
  getJSON<TraceManifestEntry[]>("data/traces/manifest.json");
export const loadTrace = (file: string) => getJSON<TravelTrace>(`data/${file}`);
