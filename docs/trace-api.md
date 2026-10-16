# `memory_trace` — live recall telemetry (design doc for v2)

Memory Travel v1 animates **saved** recall fixtures (`app/public/data/traces/*.json`,
compiled by `scripts/compile_trace.py` from real `memory_recall` responses).
v2 should animate a recall **while it executes**. This doc specifies the SSE
endpoint the memory service (`hars-longterm-memory`) SHOULD expose so the
frontend can subscribe to a recall's stage events instead of replaying fixtures.

Spec only — the live service is deliberately NOT modified (no branch, no patch).

## Endpoint

```
GET /mcp/trace?question=...&mode=hybrid&top_k=10&...   (Streamable HTTP, same auth as /mcp)
Accept: text/event-stream
```

Semantics: behaves exactly like `tools/call memory_recall` with
`context_only=true`, except that **before** the final result it emits one SSE
`data:` frame per pipeline stage, then a final frame with the full result
(identical schema to today's `memory_recall` response — additive change only).

Suggested event names (`event:` field; default `message` if omitted):

| # | event | when | payload (JSON) |
|---|-------|------|----------------|
| 0 | `trace_start` | recall accepted | `{trace_id, question, mode, top_k, fetch_top_k, alpha, index_id, stale_days}` |
| 1 | `embed` | query embedded | `{dim: 768, embedder: "embeddinggemma-300m", latency_ms, query_xy_hint?: [x,y]}` |
| 2 | `vector_hits` | dense channel done | `{latency_ms, hits: [{chunk_id, dense_score, doc, section}]}` (pool order, pre-fusion) |
| 3 | `graph_expand` | LightRAG entity/relation pass done | `{mode: "mix", entities: [{name, type}], relations: [{e1, e2}], traversed_edge_count}` |
| 4 | `bm25_hits` | sparse channel done | `{latency_ms, chunks_indexed, hits: [{chunk_id, sparse_score, doc}]}` |
| 5 | `fusion` | RRF/alpha blend done | `{alpha, order: [chunk_id…], scores: {id: fused}}` (pre-rerank order) |
| 6 | `rerank` | cross-encoder done | `{applied, backend, latency_ms, pool, before: [ids], after: [ids], blocked_inversions, fusion_margin}` |
| 7 | `context` | prompt assembled | `{entity_count, relation_count, sources: [{reference_id, chunk_id, doc}]}` |
| 8 | `result` | final | today's full `memory_recall` JSON (unchanged) |

## Frontend mapping (already implemented against fixtures)

Travel-view stages 0–7 consume events 1–7 respectively; stage 8 feeds the
answer/grounding panel. The fixture schema (`TravelTrace` in
`app/src/lib/types.ts`) is a 1:1 serialisation of events 1–7 + `result`, so a
v2 client only needs an SSE parser that appends events into the same shape —
no component changes.

## Notes for the implementer

- `vector_hits`/`bm25_hits`/`fusion` payloads SHOULD carry the **pre-rerank**
  pool order. Today's response only exposes post-rerank `fused_chunks`, which
  forces v1 to reconstruct "before" as dense-score order (documented
  approximation in `scripts/compile_trace.py`). Emitting the true pre-rerank
  order removes the only reconstructed pixel in the whole demo.
- `embed.query_xy_hint`: optional 2D projection of the query vector (e.g.
  UMAP-transform with the index's saved reducer, if one is ever persisted).
  v1 places the query at the centroid of its top hits instead.
- Keep-alive comment frames (`: ping`) every ≤15 s; rerank can take 7+ s.
- Backpressure: cap `hits` arrays at pool size (today 20–30); full chunk text
  travels only in `result`, as today.
- Read-only: this endpoint performs zero index writes; safe to expose next to
  the existing MCP bridge without new auth.
