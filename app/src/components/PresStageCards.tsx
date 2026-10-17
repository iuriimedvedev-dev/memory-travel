// Presentation chapters 3–8 — docked transformation cards.
//
// The "transformation" chapters (question→embedding, channels, fusion, rerank,
// context, synthesis) each get a row of AnimatedCards docked at the TOP of the
// cosmos view, showing that chapter's REAL example data straight out of the
// loaded trace (never invented numbers). Cards animate in per chapter with the
// two-phase AnimatedCard entrance, staggered left→right by `delayMs`, and the
// camera flight keeps playing behind them.
import type { ReactNode } from "react";
import { PIPELINE } from "../lib/presentation";
import type { ChunkHit, TravelTrace } from "../lib/types";
import { fmt, type Dict, type Lang } from "../i18n/strings";
import { AnimatedCard, type CardSize, type CardVariant } from "./AnimatedCard";

interface CardSpec {
  key: string;
  title: string;
  meta?: ReactNode;
  variant?: CardVariant;
  size?: CardSize;
  cls?: string;
  body: ReactNode;
}

/** Chapter id → docked cards (empty for 1, 2 and 9: they own the screen). */
export function PresStageCards({
  chapterId,
  trace,
  t,
  lang,
}: {
  chapterId: string;
  trace: TravelTrace | null;
  t: Dict;
  lang: Lang;
}) {
  if (!trace) return null;
  const cards = cardsFor(chapterId, trace, t, lang);
  if (!cards.length) return null;
  return (
    <div className="topcards" aria-label={t.cardsAria}>
      {cards.map((c, i) => (
        <AnimatedCard
          key={`${chapterId}-${c.key}`}
          open
          variant={c.variant ?? "accent"}
          size={c.size ?? "md"}
          title={c.title}
          meta={c.meta}
          delayMs={i * 110}
          className={`topcard ${c.cls ?? ""}`}
        >
          {c.body}
        </AnimatedCard>
      ))}
    </div>
  );
}

const n1 = (v: number | null | undefined, digits = 3) => (typeof v === "number" ? v.toFixed(digits) : "—");
const int = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("en-US") : "—");

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="crow">
      <span className="ck dim">{k}</span>
      <span className="cv">{v}</span>
    </div>
  );
}

/** Horizontal score bars: `{label, v}` normalised to the max in the set. */
function Bars({ items, color = "var(--accent)", digits = 3 }: { items: { label: string; v: number }[]; color?: string; digits?: number }) {
  const max = Math.max(...items.map((i) => i.v), 1e-9);
  return (
    <div className="cbars">
      {items.map((i, n) => (
        <div className="cbar" key={`${i.label}-${n}`} title={`${i.label} ${i.v}`}>
          <span className="cblabel">{i.label}</span>
          <span className="cbtrack">
            <span style={{ width: `${Math.max(3, (i.v / max) * 100)}%`, background: color }} />
          </span>
          <span className="cbval">{n1(i.v, digits)}</span>
        </div>
      ))}
    </div>
  );
}

/** Compact vector strip: one cell per dimension, brightness ∝ |value|. */
function DimStrip({ values, max, label }: { values: number[]; max: number; label: string }) {
  return (
    <div className="cstrip" title={values.map((v) => v.toFixed(4)).join("  ")}>
      <span className="cslabel dim">{label}</span>
      <span className="csells">
        {values.map((v, i) => (
          <i key={i} style={{ opacity: 0.15 + 0.85 * Math.min(1, Math.abs(v) / (max || 1)) }} />
        ))}
      </span>
      <span className="csval">{values.map((v) => v.toFixed(3)).join(" · ")}</span>
    </div>
  );
}

const shortDoc = (h: { doc: string; section?: string }) =>
  `${h.doc.replace(/\.md$/, "")}${h.section && h.section !== "docs" ? ` › ${h.section}` : ""}`;

const topBy = (hits: ChunkHit[], key: "dense" | "sparse", n: number) =>
  [...hits].sort((a, b) => b[key] - a[key]).slice(0, n);

function cardsFor(chapterId: string, trace: TravelTrace, t: Dict, lang: Lang): CardSpec[] {
  const m = trace.meta;
  switch (chapterId) {
    case "embed":
      return [
        {
          key: "q",
          title: t.cardQuestion,
          meta: `top_k ${m.top_k ?? "—"} · ${m.mode ?? "—"}`,
          size: "md",
          body: <p className="cardq">{m.question}</p>,
        },
        {
          key: "emb",
          title: t.cardEmbedding,
          meta: `${PIPELINE.embedder.model} · ${PIPELINE.embedder.dim}-d · ${PIPELINE.embedder.via}`,
          size: "md",
          body: (
            <>
              <DimStrip
                values={trace.query.xyz ?? [trace.query.xy[0], trace.query.xy[1], 0]}
                max={Math.max(...(trace.query.xyz ?? [0, 0, 0]).map((v) => Math.abs(v)), 1e-9)}
                label={t.cardVectorDims}
              />
              <Row k={t.cardPool} v={int(m.candidate_pool)} />
              <Row k={t.cardLatencyDense} v={m.latency_ms.dense != null ? Math.round(m.latency_ms.dense * 10) / 10 : "—"} />
              <Row
                k={t.cardTopScore}
                v={trace.vector_hits.length ? `${n1(Math.max(...trace.vector_hits.map((h) => h.dense)))} · ${shortDoc(trace.vector_hits[0])}` : "—"}
              />
              <p className="ck dim cbarcap">{t.cardTopDense}</p>
              <Bars items={topBy(trace.vector_hits, "dense", 12).map((h, i) => ({ label: `${i + 1}`, v: h.dense }))} />
            </>
          ),
        },
      ];

    case "channels": {
      const seeds = trace.graph.nodes.filter((n) => n.seed);
      return [
        {
          key: "vector",
          title: t.cardVectorCh,
          meta: t.scoreDense,
          body: (
            <>
              <Row k={t.cardHits} v={trace.vector_hits.length} />
              <Row k={t.cardTopScore} v={n1(trace.vector_hits.length ? Math.max(...trace.vector_hits.map((h) => h.dense)) : null)} />
              <Row k={t.cardLatencyDense} v={m.latency_ms.dense != null ? Math.round(m.latency_ms.dense * 10) / 10 : "—"} />
              <Bars items={topBy(trace.vector_hits, "dense", 5).map((h) => ({ label: shortDoc(h).slice(0, 18), v: h.dense }))} />
            </>
          ),
        },
        {
          key: "sparse",
          title: t.cardSparseCh,
          meta: t.scoreSparse,
          body: (
            <>
              <Row k={t.cardHits} v={trace.bm25_hits.length} />
              <Row k={t.cardTopScore} v={n1(trace.bm25_hits.length ? Math.max(...trace.bm25_hits.map((h) => h.sparse)) : null, 2)} />
              <Row k={t.cardLatencySparse} v={m.latency_ms.sparse != null ? Math.round(m.latency_ms.sparse * 10) / 10 : "—"} />
              <Row k={t.cardBm25Chunks} v={int(m.bm25_chunks)} />
              <Bars
                items={topBy(trace.bm25_hits, "sparse", 5).map((h) => ({ label: shortDoc(h).slice(0, 18), v: h.sparse }))}
                color="#59ff8c"
                digits={2}
              />
            </>
          ),
        },
        {
          key: "graph",
          title: t.cardGraphCh,
          meta: `BFS · ${trace.graph.edges.length} ${t.cardEdges}`,
          body: (
            <>
              <Row k={t.cardSeeds} v={seeds.length} />
              <Row k={t.cardNodes} v={trace.graph.nodes.length} />
              <Row k={t.cardEdges} v={trace.graph.edges.length} />
              <Row
                k={t.cardTopScore}
                v={seeds.length ? `${seeds.slice(0, 2).map((s) => s.name).join(", ")}${seeds.length > 2 ? "…" : ""}` : "—"}
              />
              <Bars
                items={seeds.slice(0, 5).map((s) => ({ label: s.name.slice(0, 18), v: s.deg }))}
                color="var(--gold)"
                digits={0}
              />
            </>
          ),
        },
      ];
    }

    case "fusion": {
      const top = trace.fusion.slice(0, 5);
      const maxDense = Math.max(...trace.fusion.map((h) => h.dense), 1e-9);
      const maxSparse = Math.max(...trace.fusion.map((h) => h.sparse), 1e-9);
      return [
        {
          key: "fused",
          title: t.cardFused,
          meta: `${t.cardAlpha} = ${m.alpha ?? "—"}`,
          size: "lg",
          body: (
            <>
              <Bars items={top.map((h, i) => ({ label: `${i + 1} ${shortDoc(h).slice(0, 20)}`, v: h.fused }))} color="#ff9d4d" />
              <div className="cmix">
                {top.map((h, i) => (
                  <div className="cmixrow" key={h.chunk_id}>
                    <span className="cmlabel">#{i + 1}</span>
                    <span className="cmbar" title={`${t.scoreDense} ${n1(h.dense)}`}>
                      <i style={{ width: `${(h.dense / maxDense) * 100}%`, background: "var(--accent)" }} />
                    </span>
                    <span className="cmbar" title={`${t.scoreSparse} ${n1(h.sparse, 2)}`}>
                      <i style={{ width: `${(h.sparse / maxSparse) * 100}%`, background: "#59ff8c" }} />
                    </span>
                    <span className="cmr dim">
                      {h.dense_rank ?? "—"}/{h.sparse_rank ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ),
        },
      ];
    }

    case "rerank": {
      const rr = trace.rerank;
      const byId = new Map(trace.fusion.map((h) => [h.chunk_id, h]));
      const name = (id: string) => shortDoc(byId.get(id) ?? { doc: id.slice(0, 12) });
      const moved = rr.before.filter((id, i) => rr.after[i] !== id).length;
      return [
        {
          key: "order",
          title: t.scoreRerank,
          meta: rr.applied
            ? `${t.cardApplied} · ${rr.backend ?? "?"} · ${rr.latency_ms != null ? Math.round(rr.latency_ms) : "—"} ms`
            : fmt(t.rerankSkipped, { reason: rr.fallback_reason ?? "fusion_confident" }),
          size: "lg",
          body: (
            <>
              <div className="csplit">
                <div>
                  <p className="ck dim">{t.beforeAfter_in}</p>
                  <ol className="corder">
                    {rr.before.slice(0, 5).map((id, i) => (
                      <li key={id} className={rr.after[i] !== id ? "moved" : ""}>
                        {i + 1}. {name(id)}
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="ck dim">{t.beforeAfter_out}</p>
                  <ol className="corder">
                    {rr.after.slice(0, 5).map((id, i) => (
                      <li key={id} className={rr.before[i] !== id ? "moved" : ""}>
                        {i + 1}. {name(id)}
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
              <Row k={t.cardRerankPool} v={int(rr.pool)} />
              <Row k={t.cardBlocked} v={int(rr.blocked_inversions)} />
              <Row k={t.cardMoved} v={moved} />
            </>
          ),
        },
      ];
    }

    case "context": {
      const used = trace.full_chunks.reduce((a, c) => a + c.content.length, 0);
      const cb = trace.context_blocks;
      return [
        {
          key: "ctx",
          title: t.cardContext,
          meta: fmt(t.contextBudget, { used: used.toLocaleString(lang === "ru" ? "ru-RU" : "en-US"), total: "15 000" }),
          size: "lg",
          body: (
            <>
              <Row k={t.cardEntityFacts} v={cb.entities.length} />
              <Row k={t.cardSources} v={cb.source_count} />
              <Row k={t.ingestRelations} v={cb.relations.length} />
              <Row k={t.cardQuotes} v={trace.answer_preview.length} />
              <ul className="clist">
                {cb.entities.slice(0, 5).map((e, i) => (
                  <li key={`${e.entity}-${i}`}>
                    <b>{e.entity}</b> <span className="dim">{(e.description ?? "").slice(0, 60)}</span>
                  </li>
                ))}
              </ul>
            </>
          ),
        },
      ];
    }

    case "answer": {
      const a = trace.answer_preview[0];
      return [
        {
          key: "ans",
          title: t.cardAnswer,
          meta: `${m.client_latency_s ?? "—"} s · ${m.lightrag_mode ?? "—"}`,
          size: "lg",
          body: (
            <>
              {a ? (
                <p className="cardq">
                  {a.quote.slice(0, 180)}
                  {a.quote.length > 180 ? "…" : ""}
                </p>
              ) : (
                <p className="dim">—</p>
              )}
              <Row k={t.cardQuotes} v={trace.answer_preview.length} />
              <Row k={t.cardCitations} v={trace.context_blocks.source_count} />
            </>
          ),
        },
        {
          key: "cites",
          title: t.cardCitations,
          meta: `${trace.context_blocks.source_count} [ref]`,
          body: (
            <ul className="clist">
              {trace.answer_preview.slice(0, 4).map((b, i) => (
                <li key={`${b.chunk_id}-${i}`}>
                  <span className="ref">[A{i + 1}]</span> <b>{shortDoc(b)}</b>{" "}
                  <span className="dim">via {b.entities.slice(0, 2).join(", ")}</span>
                </li>
              ))}
              {trace.context_blocks.sources.slice(0, 3).map((s, i) => (
                <li key={`${s.ref}-${i}`}>
                  <span className="ref">[ref {s.ref}]</span> <span className="dim">{s.doc}</span>
                </li>
              ))}
            </ul>
          ),
        },
      ];
    }

    default:
      return [];
  }
}
