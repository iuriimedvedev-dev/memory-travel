import type { TravelTrace } from "./types";

export interface StageDef {
  id: string;
  title: string;
  /** 1–2 lines for a smart non-expert. Receives the trace for live numbers. */
  caption: (t: TravelTrace) => string;
}

export const STAGES: StageDef[] = [
  {
    id: "query",
    title: "The question lands",
    caption: (_t) =>
      `Your question is embedded into 768 numbers (EmbeddingGemma, llama.cpp :8791) and dropped onto the memory map — here, at the centroid of the chunks it will hit. Pink marker. Everything that follows is real telemetry from a saved recall of this exact question.`,
  },
  {
    id: "vector",
    title: "Vector search",
    caption: (t) =>
      `The index compares the question vector against all 2,813 stored chunk vectors by cosine similarity (${t.meta.latency_ms.dense ?? "?"} ms). Cyan markers swell with their raw dense score — best ${t.vector_hits[0] ? t.vector_hits[0].dense.toFixed(3) : "?"} — meaning “talks about the same thing”, even with different words.`,
  },
  {
    id: "graph",
    title: "Graph walk",
    caption: (t) =>
      `LightRAG mode “${t.meta.lightrag_mode ?? "?"}” pulls the entities named in the retrieved text and walks one hop along real index relations (${t.graph.edges.length} edges shown). Gold = entities the answer came from; magenta = their neighbours. Meaning travels along connections, not just similarity.`,
  },
  {
    id: "bm25",
    title: "Keyword search (BM25)",
    caption: (t) =>
      `In parallel, a classic keyword index (${(t.meta.bm25_chunks ?? "?").toLocaleString()} chunks) scores exact-word matches (${t.meta.latency_ms.sparse ?? "?"} ms). Green markers: high raw scores up to ${t.bm25_hits[0] ? t.bm25_hits[0].sparse.toFixed(2) : "?"} — precise, but blind to synonyms. Note how its winners differ from the vector winners.`,
  },
  {
    id: "fusion",
    title: "Hybrid fusion",
    caption: (t) =>
      `Both rankings are min-max normalised and blended 50/50 (α = ${t.meta.alpha ?? 0.5}, the measured optimum on 46 benchmark queries). Orange markers show the fused top-${t.fusion.length}: chunks that are both about the topic AND use its words rise to the top.`,
  },
  {
    id: "rerank",
    title: "Rerank",
    caption: (t) =>
      t.rerank.applied
        ? `A cross-encoder reranker (${t.rerank.backend ?? "?"} backend) reads the top-${t.rerank.pool ?? "?"} candidates properly — slowly (${t.rerank.latency_ms ? (t.rerank.latency_ms / 1000).toFixed(1) + " s" : "? s"}) — and reorders them, with ${t.rerank.blocked_inversions ?? "?"} would-be swaps blocked by a fusion guardrail. White = chunks that moved. This final order is what gets served.`
        : `Plot twist, straight from telemetry: the reranker STOOD DOWN (${t.rerank.fallback_reason ?? "confident"} — best fused score ${t.rerank.max_fusion_score ?? "?"} beat the ${t.rerank.skip_threshold ?? "?"} skip threshold), so the fusion order was served as-is. White markers show where the fusion blend alone moved chunks versus pure vector order.`,
  },
  {
    id: "context",
    title: "Context assembly",
    caption: (t) =>
      `The winners are packed into the prompt: ${t.context_blocks.entities.length} entity facts, ${t.context_blocks.relations.length} sampled relations, ${t.context_blocks.source_count} cited sources with reference ids. Token budget, not relevance, decides where it cuts off.`,
  },
  {
    id: "answer",
    title: "Answer + grounding",
    caption: () =>
      `The live service returns context_only — the caller’s LLM writes the final answer. Below is an honest extractive preview: verbatim quotes from the top sources. Click any citation to fly back to the exact nodes it came from.`,
  },
];
