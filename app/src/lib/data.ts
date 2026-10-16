import type { CosmosGraph, TraceManifestEntry, TravelTrace } from "./types";

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
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
