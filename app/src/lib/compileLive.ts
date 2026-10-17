// Browser port of scripts/compile_trace.py — the SAME compiler path for
// live questions as for fixtures, so fixture and live traces are one format.
// Output is byte-shape-identical to TravelTrace (see src/lib/types.ts).
//
// Two honest browser-side approximations (compile_trace.py has the true
// versions; both are labelled in-UI):
//  1. per-chunk entity names: the app is not shipped the index's
//     entity->chunk map, so chunk entities = context entities (parsed from
//     the recall `context` JSON-lines, exactly like parse_context) whose
//     name occurs in the chunk text (case-insensitive substring, cap 6).
//  2. query xy: no embedder/UMAP in the browser, so the query marker uses
//     the centroid of its top-3 vector hits — the same fallback TravelView
//     already uses when a trace has no positioned hits.

import type { ChunkHit, CosmosGraph, TravelTrace } from "./types";

const DOC_HDR = /\[Document:\s*(.*?)\s*\|\s*Section:\s*(.*?)\s*\|\s*Date:\s*(.*?)\]/;
const DOC_HDR_ALL = new RegExp(DOC_HDR.source, "g");

export interface CompileAux {
  graph: CosmosGraph;
  /** entity name -> global graph index */
  idxOf: Map<string, number>;
  /** entity name -> UMAP xy (entity map space, 2D projection for old panels) */
  entityXy: Map<string, [number, number]>;
  /** entity name -> UMAP xyz (starfield space) */
  entityXyz: Map<string, [number, number, number]>;
  /** chunk_id -> UMAP xyz (chunk starfield space; placement of chunk markers) */
  chunkXyz: Record<string, [number, number, number]>;
}

interface RawChunk {
  chunk_id: string;
  content?: string;
  dense_score?: number | null;
  sparse_score?: number | null;
  fused_score?: number | null;
  file_path?: string;
}

function docOf(content: string): { doc: string; section: string } {
  const m = DOC_HDR.exec(content ?? "");
  if (!m) return { doc: "unknown", section: "" };
  return { doc: m[1].trim(), section: m[2].trim() };
}

function parseContext(ctx: string): {
  entities: { entity: string; type?: string; description?: string }[];
  relations: { entity1: string; entity2: string; description?: string }[];
  sources: Record<string, unknown>[];
} {
  const entities: { entity: string; type?: string; description?: string }[] = [];
  const relations: { entity1: string; entity2: string; description?: string }[] = [];
  const sources: Record<string, unknown>[] = [];
  for (const line of (ctx ?? "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if ("reference_id" in o) sources.push(o);
      else if ("entity1" in o)
        relations.push(o as unknown as { entity1: string; entity2: string; description?: string });
      else if ("entity" in o) entities.push(o as unknown as { entity: string; type?: string; description?: string });
    } catch {
      /* skip malformed line */
    }
  }
  return { entities, relations, sources };
}

type XYZ = [number, number, number];
type XY = [number, number];

function centroid3(names: string[], posOf: Map<string, XYZ>): XYZ | null {
  let sx = 0,
    sy = 0,
    sz = 0,
    k = 0;
  for (const n of names) {
    const p = posOf.get(n);
    if (p) {
      sx += p[0];
      sy += p[1];
      sz += p[2];
      k++;
    }
  }
  return k ? [sx / k, sy / k, sz / k] : null;
}

/**
 * Compile a parsed live memory_recall result into a TravelTrace.
 * `question` is the user's text; `clientLatencyS` the wall-clock recall time.
 */
export function compileLiveTrace(
  question: string,
  r: Record<string, unknown>,
  clientLatencyS: number,
  aux: CompileAux,
): TravelTrace {
  const h = (r["hybrid"] ?? {}) as Record<string, unknown>;
  const fc = (h["fused_chunks"] ?? []) as RawChunk[];
  if (!Array.isArray(fc) || fc.length === 0) throw new Error("live recall returned no fused_chunks");
  const ctx = typeof r["context"] === "string" ? (r["context"] as string) : "";
  const { entities, relations, sources } = parseContext(ctx);

  // Candidate entity vocabulary: context entities known to the graph.
  const vocab = [...new Set(entities.map((e) => e.entity).filter((n) => aux.idxOf.has(n)))];
  const lowered = new Map(vocab.map((n) => [n.toLowerCase(), n] as const));

  const byDense = [...fc].sort((a, b) => (b.dense_score ?? 0) - (a.dense_score ?? 0));
  const bySparse = [...fc].sort((a, b) => (b.sparse_score ?? 0) - (a.sparse_score ?? 0));
  const drank = new Map(byDense.map((c, i) => [c.chunk_id, i + 1]));
  const srank = new Map(bySparse.map((c, i) => [c.chunk_id, i + 1]));

  // Per-chunk entities: context entities mentioned in the chunk text.
  const entitiesOf = (c: RawChunk): string[] => {
    const body = (c.content ?? "").toLowerCase();
    const out: string[] = [];
    for (const [, name] of lowered) {
      if (out.length >= 6) break;
      if (name.length > 1 && body.includes(name.toLowerCase())) out.push(name);
    }
    return out;
  };

  const slim = (c: RawChunk): ChunkHit => {
    const d = docOf(c.content ?? "");
    const cp = aux.chunkXyz[c.chunk_id] ?? null;
    return {
      chunk_id: c.chunk_id,
      dense: Math.round((c.dense_score ?? 0) * 1e4) / 1e4,
      sparse: Math.round((c.sparse_score ?? 0) * 1e4) / 1e4,
      fused: Math.round((c.fused_score ?? 0) * 1e4) / 1e4,
      dense_rank: drank.get(c.chunk_id) ?? null,
      sparse_rank: srank.get(c.chunk_id) ?? null,
      doc: d.doc,
      section: d.section,
      xy: cp ? [cp[0], cp[1]] : null,
      xyz: cp,
      file: c.file_path ?? "",
      entities: entitiesOf(c),
    };
  };

  const topFused = fc.slice(0, 14);
  const vectorHits = byDense.slice(0, 12).map(slim);
  const bm25Hits = bySparse
    .filter((c) => (c.sparse_score ?? 0) > 0)
    .slice(0, 12)
    .map(slim);
  const fusion = topFused.map(slim);

  const rr = (h["rerank"] ?? {}) as Record<string, unknown>;
  const rerank = {
    before: byDense.slice(0, 20).map((c) => c.chunk_id),
    after: fc.slice(0, 20).map((c) => c.chunk_id),
    applied: (rr["applied"] as boolean | null) ?? null,
    backend: (rr["backend"] as string | null) ?? null,
    latency_ms: (rr["latency_ms"] as number | null) ?? null,
    pool: (rr["pool"] as number | null) ?? null,
    blocked_inversions: (rr["blocked_inversions"] as number | null) ?? null,
    fusion_margin: (rr["fusion_margin"] as number | null) ?? null,
    max_fusion_score: (rr["max_fusion_score"] as number | null) ?? null,
    fallback_reason: (rr["fallback_reason"] as string | null) ?? null,
    skip_threshold: (rr["skip_threshold"] as number | null) ?? null,
  };

  // --- traversed subgraph: context entities + top-chunk entities + 1-hop BFS, cap 350
  const seeds = new Set<string>();
  for (const e of entities) if (aux.idxOf.has(e.entity)) seeds.add(e.entity);
  for (const rel of relations) {
    if (aux.idxOf.has(rel.entity1)) seeds.add(rel.entity1);
    if (aux.idxOf.has(rel.entity2)) seeds.add(rel.entity2);
  }
  for (const c of topFused) for (const ent of entitiesOf(c).slice(0, 6)) seeds.add(ent);
  if (seeds.size === 0) {
    // Fallback for naive-mode responses (no entities/relations in context):
    // mine seed entities by scanning top-chunk text for graph names
    // (len>=4, cap 40). Slower, but keeps a live answer playable as a map.
    const bodies = topFused.map((c) => (c.content ?? "").toLowerCase());
    for (const [name] of aux.idxOf) {
      if (seeds.size >= 40) break;
      if (name.length < 4) continue;
      const low = name.toLowerCase();
      for (const b of bodies) {
        if (b.includes(low)) {
          seeds.add(name);
          break;
        }
      }
    }
  }
  const seedIdx = new Set([...seeds].map((s) => aux.idxOf.get(s)!));

  const adj = new Map<number, Set<number>>();
  aux.graph.edges.forEach(([s, t]) => {
    if (!adj.has(s)) adj.set(s, new Set());
    if (!adj.has(t)) adj.set(t, new Set());
    adj.get(s)!.add(t);
    adj.get(t)!.add(s);
  });
  const seen = new Set([...seedIdx].sort((a, b) => a - b));
  for (const s of [...seedIdx].sort((a, b) => a - b)) {
    for (const nb of [...(adj.get(s) ?? [])].sort((a, b) => a - b)) {
      if (seen.size >= 350) break;
      seen.add(nb);
    }
    if (seen.size >= 350) break;
  }
  const nodes = [...seen]
    .sort((a, b) => a - b)
    .map((i) => {
      const gn = aux.graph.nodes[i];
      return {
        i,
        name: gn.id,
        type: gn.t,
        desc: gn.d,
        deg: gn.deg,
        xy: aux.entityXy.get(gn.id) ?? null,
        xyz: aux.entityXyz.get(gn.id) ?? null,
        seed: seedIdx.has(i),
      };
    });
  const inset = seen;
  const gedges = aux.graph.edges.filter(([s, t]) => inset.has(s) && inset.has(t)).slice(0, 1200) as [number, number][];

  const srcBlocks = sources.slice(0, 10).map((s) => {
    const body = typeof s["content"] === "string" ? (s["content"] as string) : "";
    const m = DOC_HDR.exec(body);
    return { ref: String(s["reference_id"] ?? "?"), doc: m ? m[1].trim() : "unknown", preview: body.slice(0, 600) };
  });

  const bullets = fc.slice(0, 3).map((c) => {
    const body = (c.content ?? "").replace(DOC_HDR_ALL, "").trim().slice(0, 260).replace(/\n/g, " ");
    const d = docOf(c.content ?? "");
    const cp = aux.chunkXyz[c.chunk_id] ?? null;
    return {
      quote: body,
      chunk_id: c.chunk_id,
      doc: d.doc,
      entities: entitiesOf(c).slice(0, 4),
      xy: cp ? [cp[0], cp[1]] as [number, number] : null,
      xyz: cp,
    };
  });

  const lat = (h["latency_ms"] ?? {}) as Record<string, number | null>;
  const conf = (h["confidence"] ?? {}) as Record<string, number | boolean | null>;
  const q = typeof r["question"] === "string" ? (r["question"] as string) : question;

  // Query marker: centroid of top-3 vector hits (no embedder in browser).
  let qsx = 0,
    qsy = 0,
    qsz = 0,
    qk = 0;
  for (const hb of vectorHits.slice(0, 3)) {
    const p = centroid3(hb.entities, aux.entityXyz);
    if (p) {
      qsx += p[0];
      qsy += p[1];
      qsz += p[2];
      qk++;
    }
  }
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const queryXy: XY = qk ? [r4(qsx / qk), r4(qsy / qk)] : [0, 0];
  const queryXyz: XYZ = qk ? [r4(qsx / qk), r4(qsy / qk), r4(qsz / qk)] : [0, 0, 0];

  return {
    meta: {
      id: "live",
      question: q,
      ll_keywords: [],
      hl_keywords: [],
      mode: (r["mode"] as string | null) ?? null,
      lightrag_mode: (r["lightrag_mode"] as string | null) ?? null,
      mode_fallback: (r["mode_fallback"] as string | null) ?? null,
      top_k: (r["top_k"] as number | null) ?? null,
      fetch_top_k: (r["fetch_top_k"] as number | null) ?? null,
      candidate_pool: (h["candidate_pool_size"] as number | null) ?? null,
      alpha: (h["alpha"] as number | null) ?? null,
      latency_ms: {
        dense: lat["dense_channel"] ?? null,
        sparse: lat["sparse_channel"] ?? null,
        rerank: lat["rerank_channel"] ?? null,
      },
      confidence: {
        low: (conf["low_confidence"] as boolean | null) ?? null,
        threshold: (conf["threshold"] as number | null) ?? null,
        top_dense: (conf["top_dense_score"] as number | null) ?? null,
      },
      bm25_chunks: ((h["bm25_index"] as Record<string, unknown> | undefined)?.["chunks_indexed"] as number | null) ?? null,
      client_latency_s: Math.round(clientLatencyS * 100) / 100,
    },
    query: { text: q, xy: queryXy, xyz: queryXyz },
    vector_hits: vectorHits,
    bm25_hits: bm25Hits,
    fusion,
    rerank,
    graph: { nodes, edges: gedges },
    context_blocks: {
      entities: entities.slice(0, 12),
      relations: relations.filter((x) => seeds.has(x.entity1) || seeds.has(x.entity2)).slice(0, 10),
      sources: srcBlocks,
      source_count: sources.length,
    },
    answer_preview: bullets,
    full_chunks: fc.slice(0, 12).map((c) => ({ chunk_id: c.chunk_id, content: (c.content ?? "").slice(0, 4000) })),
  };
}
