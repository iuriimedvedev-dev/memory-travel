import { useEffect, useMemo, useRef, useState } from "react";
import { Cosmos, INK, toWorld, type RGBA } from "../lib/cosmos";
import { loadTrace } from "../lib/data";
import { STAGES } from "../lib/stages";
import type { ChunkHit, CosmosGraph, TraceManifestEntry, TravelTrace } from "../lib/types";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "./icons";

interface Props {
  cosmos: Cosmos | null;
  manifest: TraceManifestEntry[] | null;
  liveTrace: TravelTrace | null;
}

const LIVE_ID = "__live__";

type XY = [number, number];

export default function TravelView({ cosmos, manifest, liveTrace }: Props) {
  const [traceId, setTraceId] = useState<string>("trace_01");
  const [trace, setTrace] = useState<TravelTrace | null>(null);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const markers = useRef<number[]>([]);
  const baseZoom = useRef(1);
  const traceRef = useRef<TravelTrace | null>(null);
  traceRef.current = trace;
  const cosmosRef = useRef<Cosmos | null>(null);
  cosmosRef.current = cosmos;

  // name -> entity-space xy (raw UMAP units) for the loaded subgraph
  const posOf = useMemo(() => {
    const m = new Map<string, XY>();
    trace?.graph.nodes.forEach((n) => {
      if (n.xy) m.set(n.name, n.xy);
    });
    return m;
  }, [trace]);

  const localOf = useMemo(() => {
    const m = new Map<string, number>();
    trace?.graph.nodes.forEach((n, li) => m.set(n.name, li));
    return m;
  }, [trace]);

  const hitPos = (h: { entities: string[] }): XY | null => {
    let sx = 0,
      sy = 0,
      k = 0;
    for (const e of h.entities) {
      const p = posOf.get(e);
      if (p) {
        sx += p[0];
        sy += p[1];
        k++;
      }
    }
    return k ? [sx / k, sy / k] : null;
  };

  const queryPos: XY | null = useMemo(() => {
    if (!trace) return null;
    let sx = 0,
      sy = 0,
      k = 0;
    for (const h of trace.vector_hits.slice(0, 3)) {
      const p = hitPos(h);
      if (p) {
        sx += p[0];
        sy += p[1];
        k++;
      }
    }
    return k ? [sx / k, sy / k] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, posOf]);

  // A fresh live answer jumps the picker to the live entry.
  useEffect(() => {
    if (liveTrace) setTraceId(LIVE_ID);
  }, [liveTrace]);

  // ---- load trace + subgraph into the travel canvas.
  // The trace JSON always loads (text stages stay readable); the 3D
  // subgraph load is skipped with a note when the canvas is unavailable.
  useEffect(() => {
    if (!traceId) return;
    const useLive = traceId === LIVE_ID;
    if (useLive && !liveTrace) return;
    let dead = false;
    setStatus(useLive ? "compiling live answer…" : "loading trace…");
    setStatusErr(false);
    setTrace(null);
    const entry = manifest?.find((e) => e.id === traceId);
    const src: Promise<TravelTrace> = useLive
      ? Promise.resolve(liveTrace!)
      : loadTrace(entry?.file ?? `traces/${traceId}.json`);
    src
      .then(async (t) => {
        if (dead) return;
        setTrace(t);
        setStage(0);
        setPlaying(false);
        if (!cosmos) {
          setStatus("3D canvas unavailable (WebGPU) — telemetry text below stays readable.");
          setStatusErr(true);
          return;
        }
        const g2g = new Map<number, number>();
        t.graph.nodes.forEach((n, li) => g2g.set(n.i, li));
        const cg: CosmosGraph = {
          nodes: t.graph.nodes.map((n) => ({ id: n.name, t: n.type, d: n.desc, deg: n.deg })),
          edges: t.graph.edges
            .map(([s, e]) => [g2g.get(s), g2g.get(e)] as [number, number])
            .filter(([s, e]) => s !== undefined && e !== undefined),
        };
        setStatus("loading subgraph…");
        setStatusErr(false);
        clearMarkers();
        cosmos.clear();
        try {
          await cosmos.load(
            cg,
            t.graph.nodes.map((n) => n.xy),
          );
        } catch (e) {
          if (!dead) {
            setStatus(`subgraph render failed: ${e instanceof Error ? e.message : String(e)}`);
            setStatusErr(true);
          }
          return;
        }
        if (dead) return;
        baseZoom.current = cosmos.currentZoom();
        setStatus(null);
        setStatusErr(false);
      })
      .catch((e) => {
        if (!dead) {
          // loadTrace() names the file: `fetch <path>: <status>`.
          setStatus(`trace load failed (stage=fetch ${entry?.file ?? `traces/${traceId}.json`}): ${String(e)}`);
          setStatusErr(true);
        }
      });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmos, traceId, manifest, liveTrace]);

  // ---- markers cleanup helper (ref-based: safe from stale closures)
  const clearMarkers = () => {
    const c = cosmosRef.current;
    if (!c) return;
    markers.current.forEach((id) => c.removeMarker(id));
    markers.current = [];
  };
  useEffect(() => () => {
    const c = cosmosRef.current;
    if (c) markers.current.forEach((id) => {
      try { c.removeMarker(id); } catch { /* noop */ }
    });
    markers.current = [];
  }, [traceId]);

  const paintEntities = (names: string[], color: RGBA, boost = 2.2) => {
    if (!cosmos || !trace) return;
    const paints = new Map<number, { color: RGBA; size?: number }>();
    names.forEach((nm) => {
      const li = localOf.get(nm);
      if (li !== undefined) {
        const deg = trace.graph.nodes[li].deg;
        paints.set(li, { color, size: 3.2 + Math.min(9, Math.sqrt(deg) * 1.6) * boost });
      }
    });
    cosmos.paint(paints);
  };

  const mark = (label: string, p: XY, size: number, color: RGBA): number | null => {
    if (!cosmos) return null;
    const [x, y] = toWorld(p);
    const id = cosmos.addMarker(label, x, y, size, color);
    markers.current.push(id);
    return id;
  };

  const detail = () => baseZoom.current * 3.4;

  // ---- stage driver
  useEffect(() => {
    if (!cosmos || !trace) return;
    clearMarkers();
    cosmos.paint(null);
    cosmos.setEdgeOpacity(0.09);
    const Q = queryPos;

    if (stage === 0) {
      if (Q) {
        mark("?", Q, 15, INK.query);
        const [x, y] = toWorld(Q);
        cosmos.flyTo(x, y, detail(), 1600);
      }
    } else if (stage === 1) {
      if (Q) mark("?", Q, 12, INK.query);
      const max = Math.max(...trace.vector_hits.map((h) => h.dense), 1e-9);
      trace.vector_hits.forEach((h, i) => {
        const p = hitPos(h);
        if (p && i < 12) mark(`${i + 1}`, p, 5 + 11 * (h.dense / max), INK.cyan);
      });
      paintEntities([...new Set(trace.vector_hits.flatMap((h) => h.entities))], INK.cyan, 1.8);
      cosmos.fit(0.2);
    } else if (stage === 2) {
      if (Q) mark("?", Q, 10, INK.query);
      const paints = new Map<number, { color: RGBA; size?: number }>();
      trace.graph.nodes.forEach((n, li) => {
        const deg = n.deg;
        const s = 3.2 + Math.min(9, Math.sqrt(deg) * 1.6);
        paints.set(li, n.seed ? { color: INK.gold, size: s * 2.4 } : { color: INK.magenta, size: s });
      });
      cosmos.paint(paints);
      cosmos.setEdgeOpacity(0.35);
      const seeds = trace.graph.nodes.filter((n) => n.seed && n.xy);
      if (seeds.length) {
        const cx = seeds.reduce((a, n) => a + n.xy![0], 0) / seeds.length;
        const cy = seeds.reduce((a, n) => a + n.xy![1], 0) / seeds.length;
        const [x, y] = toWorld([cx, cy]);
        cosmos.flyTo(x, y, detail(), 1600);
      }
    } else if (stage === 3) {
      if (Q) mark("?", Q, 10, INK.query);
      const max = Math.max(...trace.bm25_hits.map((h) => h.sparse), 1e-9);
      trace.bm25_hits.slice(0, 12).forEach((h, i) => {
        const p = hitPos(h);
        if (p) mark(`${i + 1}`, p, 5 + 11 * (h.sparse / max), INK.green);
      });
      paintEntities([...new Set(trace.bm25_hits.flatMap((h) => h.entities))], INK.green, 1.8);
      cosmos.fit(0.2);
    } else if (stage === 4) {
      if (Q) mark("?", Q, 10, INK.query);
      trace.fusion.forEach((h, i) => {
        const p = hitPos(h);
        if (p) mark(`${i + 1}`, p, 13 - i * 0.5, INK.orange);
      });
      paintEntities([...new Set(trace.fusion.flatMap((h) => h.entities))], INK.orange, 2.0);
      cosmos.fit(0.2);
    } else if (stage === 5) {
      if (Q) mark("?", Q, 10, INK.query);
      const after = new Map(trace.rerank.after.map((id, i) => [id, i + 1]));
      trace.fusion.forEach((h) => {
        const p = hitPos(h);
        const moved = h.dense_rank !== after.get(h.chunk_id);
        // ASCII-only canvas labels ("!" moved vs "=" static) — no pictographs.
        if (p) mark(moved ? "!" : "=", p, moved ? 13 : 8, moved ? INK.white : INK.orange);
      });
      paintEntities([...new Set(trace.fusion.flatMap((h) => h.entities))], INK.white, 1.6);
      cosmos.fit(0.2);
    } else if (stage === 6 || stage === 7) {
      const bullets = trace.answer_preview;
      const who = stage === 6 ? trace.fusion.slice(0, 8) : [];
      who.forEach((h, i) => {
        const p = hitPos(h);
        if (p) mark(`S${i + 1}`, p, 10, INK.orange);
      });
      const bnames = [...new Set(bullets.flatMap((b) => b.entities))];
      paintEntities(bnames, INK.gold, 2.4);
      bullets.forEach((b, i) => {
        const p = posOf.size ? centroidOf(b.entities, posOf) : null;
        if (p) mark(`A${i + 1}`, p, 14, INK.query);
      });
      cosmos.fit(0.2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trace, cosmos]);

  // ---- autoplay
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setStage((s) => (s >= 7 ? 0 : s + 1)), 4200);
    return () => clearInterval(id);
  }, [playing]);

  const focusChunk = (h: ChunkHit) => {
    const p = hitPos(h);
    if (!cosmos || !p) return;
    paintEntities(h.entities, INK.white, 2.6);
    const [x, y] = toWorld(p);
    cosmos.flyTo(x, y, detail(), 1400);
  };

  return (
    <>
      <div className="panel left">
        <h1>Memory Travel</h1>
        <p className="sub">One real query’s journey through the memory machinery — every score, latency and id below is saved telemetry, not a mockup.</p>
        <select value={traceId} onChange={(e) => setTraceId(e.target.value)} className="search">
          {liveTrace && (
            <option value={LIVE_ID}>
              live: {liveTrace.meta.question.slice(0, 72)}…
            </option>
          )}
          {(manifest ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}: {m.question.slice(0, 72)}…
            </option>
          ))}
        </select>
        {traceId === LIVE_ID && (
          <p className="dim">
            Live recall — same trace format as fixtures (per-chunk entities by context-entity mention, query marker at
            top-hits centroid; no embedder in the browser).
          </p>
        )}
        {status && (
          <p className={statusErr ? "status-err" : "loading"}>
            {statusErr && <AlertIcon size={12} />} {status}
          </p>
        )}
        {trace && (
          <div className="meta">
            <MetaRow k="mode" v={`${trace.meta.mode} / LightRAG ${trace.meta.lightrag_mode}`} />
            <MetaRow k="pool" v={`${trace.meta.candidate_pool} candidates → top-${trace.meta.top_k}`} />
            <MetaRow
              k="timings"
              v={`dense ${trace.meta.latency_ms.dense}ms · sparse ${trace.meta.latency_ms.sparse}ms · rerank ${fmtS(trace.meta.latency_ms.rerank)}`}
            />
            <MetaRow
              k="confidence"
              v={trace.meta.confidence.low ? "LOW (unverified)" : `ok (top dense ${trace.meta.confidence.top_dense})`}
            />
            <MetaRow k="recall" v={`${trace.meta.client_latency_s}s wall-clock`} />
          </div>
        )}
        <StageBody stage={stage} trace={trace} onFocusChunk={focusChunk} />
      </div>
      <div className="timeline">
        <div className="caption">{trace && <><b>{STAGES[stage].title}.</b> {STAGES[stage].caption(trace)}</>}</div>
        <div className="scrub">
          <button onClick={() => setStage((s) => (s + 7) % 8)} title="previous stage"><ChevronLeftIcon size={13} /></button>
          <button onClick={() => setPlaying((p) => !p)} className="primary" title={playing ? "pause" : "play"}>
            {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
          </button>
          <button onClick={() => setStage((s) => (s + 1) % 8)} title="next stage"><ChevronRightIcon size={13} /></button>
          <input type="range" min={0} max={7} step={1} value={stage} onChange={(e) => { setPlaying(false); setStage(Number(e.target.value)); }} />
          <div className="dots">
            {STAGES.map((s, i) => (
              <button key={s.id} className={i === stage ? "dot on" : "dot"} title={s.title} onClick={() => { setPlaying(false); setStage(i); }}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function centroidOf(names: string[], posOf: Map<string, XY>): XY | null {
  let sx = 0, sy = 0, k = 0;
  for (const e of names) {
    const p = posOf.get(e);
    if (p) { sx += p[0]; sy += p[1]; k++; }
  }
  return k ? [sx / k, sy / k] : null;
}

function fmtS(ms: number | null): string {
  return ms == null ? "?" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <p className="metarow"><span className="dim">{k}</span> {v}</p>
  );
}

function ScoreBar({ v, max, color }: { v: number; max: number; color: string }) {
  return (
    <span className="bar"><span style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: color }} /></span>
  );
}

function StageBody({
  stage, trace, onFocusChunk,
}: {
  stage: number;
  trace: TravelTrace | null;
  onFocusChunk: (h: ChunkHit) => void;
}) {
  if (!trace) return <p className="dim">loading…</p>;
  const m = trace.meta;
  if (stage === 0) {
    return (
      <div>
        <p className="q">“{m.question}”</p>
        <p><span className="dim">low-level keywords</span> {m.ll_keywords.join(" · ")}</p>
        <p><span className="dim">high-level keywords</span> {m.hl_keywords.join(" · ")}</p>
        <p className="dim">Keywords skip the LLM keyword-extraction step — with them, the query runs on CPU embeddings + graph only.</p>
      </div>
    );
  }
  if (stage === 1) {
    const max = Math.max(...trace.vector_hits.map((h) => h.dense));
    return (
      <ol className="hits">
        {trace.vector_hits.map((h, i) => (
          <li key={h.chunk_id}><button onClick={() => onFocusChunk(h)}>
            <span className="rank">{i + 1}</span> {h.doc}
            <ScoreBar v={h.dense} max={max} color="#33f3ff" /> <span className="dim">{h.dense.toFixed(3)}</span>
          </button></li>
        ))}
      </ol>
    );
  }
  if (stage === 2) {
    const seeds = trace.graph.nodes.filter((n) => n.seed);
    return (
      <div>
        <p><b>{seeds.length}</b> seed entities × 1 hop → <b>{trace.graph.nodes.length}</b> nodes, <b>{trace.graph.edges.length}</b> edges on screen.</p>
        <ul className="hits">
          {seeds.slice(0, 10).map((n) => (
            <li key={n.name}><b>{n.name}</b> <span className="dim">{n.type} · {n.desc.slice(0, 90)}</span></li>
          ))}
        </ul>
      </div>
    );
  }
  if (stage === 3) {
    const max = Math.max(...trace.bm25_hits.map((h) => h.sparse), 1e-9);
    return (
      <ol className="hits">
        {trace.bm25_hits.slice(0, 12).map((h, i) => (
          <li key={h.chunk_id}><button onClick={() => onFocusChunk(h)}>
            <span className="rank">{i + 1}</span> {h.doc}
            <ScoreBar v={h.sparse} max={max} color="#59ff8c" /> <span className="dim">{h.sparse.toFixed(2)}</span>
          </button></li>
        ))}
      </ol>
    );
  }
  if (stage === 4) {
    return (
      <ol className="hits">
        {trace.fusion.map((h, i) => (
          <li key={h.chunk_id}><button onClick={() => onFocusChunk(h)}>
            <span className="rank">{i + 1}</span> {h.doc}
            <span className="dim"> vec #{h.dense_rank} · key #{h.sparse_rank} → fused {h.fused.toFixed(3)}</span>
          </button></li>
        ))}
      </ol>
    );
  }
  if (stage === 5) {
    const byId = new Map(trace.fusion.map((h) => [h.chunk_id, h]));
    const name = (id: string) => byId.get(id)?.doc ?? id.slice(0, 14);
    return (
      <div className="cols">
        <div>
          <h4>fusion order (in)</h4>
          <ol>{trace.rerank.before.slice(0, 10).map((id, i) => <li key={id} className={trace.rerank.after[i] !== id ? "moved" : ""}>{i + 1}. {name(id)}</li>)}</ol>
        </div>
        <div>
          <h4>served order (out)</h4>
          <ol>{trace.rerank.after.slice(0, 10).map((id, i) => <li key={id} className={trace.rerank.before[i] !== id ? "moved" : ""}>{i + 1}. {name(id)}</li>)}</ol>
        </div>
        {trace.rerank.applied
          ? <p className="dim">backend {trace.rerank.backend} · pool {trace.rerank.pool} · {fmtS(trace.rerank.latency_ms)} · {trace.rerank.blocked_inversions} inversions blocked (margin {trace.rerank.fusion_margin})</p>
          : <p className="dim">rerank SKIPPED — {trace.rerank.fallback_reason} (max fused {trace.rerank.max_fusion_score} ≥ threshold {trace.rerank.skip_threshold}). Lists differ only by fusion itself.</p>}
      </div>
    );
  }
  if (stage === 6) {
    return (
      <div className="ctx">
        <h4>entities ({trace.context_blocks.entities.length})</h4>
        <ul>{trace.context_blocks.entities.slice(0, 6).map((e, i) => <li key={i}><b>{e.entity}</b> <span className="dim">{(e.description ?? "").slice(0, 100)}</span></li>)}</ul>
        <h4>relations (sample)</h4>
        <ul>{trace.context_blocks.relations.slice(0, 5).map((r, i) => <li key={i}><span className="dim">{r.entity1} → {r.entity2}</span></li>)}</ul>
        <h4>sources ({trace.context_blocks.source_count})</h4>
        <ul>{trace.context_blocks.sources.slice(0, 6).map((s) => <li key={s.ref}><span className="ref">[ref {s.ref}]</span> {s.doc}</li>)}</ul>
      </div>
    );
  }
  return (
    <div className="ctx">
      <p className="dim">Extractive preview — verbatim quotes, not LLM prose. Each answer marker (A1…) flies back to its nodes.</p>
      {trace.answer_preview.map((b, i) => (
        <div key={i} className="bullet">
          <p>“{b.quote}…”</p>
          <p><span className="ref">[A{i + 1} {b.doc}]</span> <span className="dim">via {b.entities.slice(0, 3).join(", ")}</span></p>
        </div>
      ))}
    </div>
  );
}
