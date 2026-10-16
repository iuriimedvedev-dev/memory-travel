// Trace JSON (public/data/traces/trace_XX.json) — compiled from REAL
// memory_recall telemetry by scripts/compile_trace.py. Every score,
// latency, id and text in here came off the wire or out of the index.

export interface ChunkHit {
  chunk_id: string;
  dense: number;
  sparse: number;
  fused: number;
  dense_rank: number | null;
  sparse_rank: number | null;
  doc: string;
  section: string;
  xy: [number, number] | null;
  file: string;
  /** graph entity names sourced from this chunk (for map placement + grounding) */
  entities: string[];
}

export interface RerankInfo {
  before: string[];
  after: string[];
  applied: boolean | null;
  backend: string | null;
  latency_ms: number | null;
  pool: number | null;
  blocked_inversions: number | null;
  fusion_margin: number | null;
  max_fusion_score: number | null;
}

export interface GraphNode {
  i: number; // index into graph.json nodes
  name: string;
  type: string;
  desc: string;
  deg: number;
  xy: [number, number] | null;
  seed: boolean;
}

export interface TraceMeta {
  id: string;
  question: string;
  ll_keywords: string[];
  hl_keywords: string[];
  mode: string | null;
  lightrag_mode: string | null;
  mode_fallback: string | null;
  top_k: number | null;
  fetch_top_k: number | null;
  candidate_pool: number | null;
  alpha: number | null;
  latency_ms: { dense: number | null; sparse: number | null; rerank: number | null };
  confidence: { low: boolean | null; threshold: number | null; top_dense: number | null };
  bm25_chunks: number | null;
  client_latency_s: number | null;
}

export interface TravelTrace {
  meta: TraceMeta;
  query: { text: string; xy: [number, number] };
  vector_hits: ChunkHit[];
  bm25_hits: ChunkHit[];
  fusion: ChunkHit[];
  rerank: RerankInfo;
  graph: { nodes: GraphNode[]; edges: [number, number][] };
  context_blocks: {
    entities: { entity: string; type?: string; description?: string }[];
    relations: { entity1: string; entity2: string; description?: string }[];
    sources: { ref: string; doc: string; preview: string }[];
    source_count: number;
  };
  answer_preview: {
    quote: string;
    chunk_id: string;
    doc: string;
    entities: string[];
    xy: [number, number] | null;
  }[];
  full_chunks: { chunk_id: string; content: string }[];
}

export interface CosmosGraph {
  nodes: { id: string; t: string; d: string; deg: number }[];
  edges: [number, number][];
}

export interface TraceManifestEntry {
  id: string;
  question: string;
  file: string;
  kb: number;
}
