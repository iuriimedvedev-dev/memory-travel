import { useEffect, useMemo, useRef, useState } from "react";
import { INK, toWorld, type RGBA } from "../lib/cosmos";
import type { AnyCosmos } from "../lib/cosmos2d";
import { loadTrace } from "../lib/data";
import { makeTimeline, type Timeline } from "../lib/reveal";
import { STAGES } from "../lib/stages";
import type { ChunkHit, CosmosGraph, TraceManifestEntry, TravelTrace } from "../lib/types";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from "./icons";

interface Props {
  cosmos: AnyCosmos | null;
  manifest: TraceManifestEntry[] | null;
  liveTrace: TravelTrace | null;
}

const LIVE_ID = "__live__";

type XY = [number, number];

const SPEEDS = [0.75, 1, 1.5, 2] as const;
/** Extra hold after a stage's reveal finishes before autoplay advances. */
const HOLD_MS = 2500;

export default function TravelView({ cosmos, manifest, liveTrace }: Props) {
  const [traceId, setTraceId] = useState<string>("trace_01");
  const [trace, setTrace] = useState<TravelTrace | null>(null);
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [status, setStatus] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const markers = useRef<number[]>([]);
  const baseZoom = useRef(1);
  const timeline = useRef<Timeline | null>(null);
  /** false only when the user jumped (scrubber/dots): those skip straight to the end state */
  const animateNext = useRef(true);
  const traceRef = useRef<TravelTrace | null>(null);
  traceRef.current = trace;
  const cosmosRef = useRef<AnyCosmos | null>(null);
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
    if (liveTrace) {
      setTraceId(LIVE_ID);
      setStage(0);
      animateNext.current = true;
    }
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
          setStatus("Canvas unavailable (WebGPU + 2D fallback both failed) — telemetry text below stays readable.");
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

  /** Spawn a marker at `delay` and pulse its size from->size. Cues and tweens
   *  are both scheduled at the top level (nested scheduling would mis-time). */
  const pulseAt = (
    tl: Timeline,
    delay: number,
    label: string,
    p: XY,
    from: number,
    size: number,
    color: RGBA,
    dur = 420,
    pre?: () => void,
  ) => {
    let mid: number | null = null;
    const [x, y] = toWorld(p);
    tl.at(delay, () => {
      pre?.();
      mid = mark(label, p, from, color);
    });
    tl.tween(delay, dur, (t) => {
      if (mid === null) return;
      cosmos?.moveMarker(mid, x, y, from + (size - from) * t);
    });
  };

  const detail = () => baseZoom.current * 3.4;

  // ---- BFS ring depths over the local subgraph (for the stage-2 spread)
  const ringDepth = useMemo(() => {
    const m = new Map<number, number>();
    if (!trace) return m;
    const g2l = new Map<number, number>();
    trace.graph.nodes.forEach((n, li) => g2l.set(n.i, li));
    const adj = new Map<number, number[]>();
    trace.graph.edges.forEach(([s, t]) => {
      const a = g2l.get(s);
      const b = g2l.get(t);
      if (a === undefined || b === undefined) return;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    });
    const queue: number[] = [];
    trace.graph.nodes.forEach((n, li) => {
      if (n.seed) {
        m.set(li, 0);
        queue.push(li);
      }
    });
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      for (const nb of adj.get(cur) ?? []) {
        if (!m.has(nb)) {
          m.set(nb, (m.get(cur) ?? 0) + 1);
          queue.push(nb);
        }
      }
    }
    return m;
  }, [trace]);

  // ---- stage driver: a planned timeline per stage (or instant jump when scrubbing)
  useEffect(() => {
    if (!cosmos || !trace) return;
    timeline.current?.cancel();
    clearMarkers();
    cosmos.paint(null);
    cosmos.setEdgeOpacity(0.09);
    const animate = animateNext.current;
    const tl = makeTimeline(animate ? speed : 1, !animate);
    timeline.current = tl;
    const Q = queryPos;
    const ringPaint = (depth: number, color: RGBA, boost: number) => {
      const names: string[] = [];
      ringDepth.forEach((d, li) => {
        if (d === depth) names.push(trace.graph.nodes[li].name);
      });
      if (names.length) paintEntities(names, color, boost);
    };

    if (stage === 0) {
      if (Q) pulseAt(tl, 0, "?", Q, 1, 15, INK.query, 700);
      if (Q) {
        const [x, y] = toWorld(Q);
        cosmos.flyTo(x, y, detail(), 1600);
      }
    } else if (stage === 1) {
      if (Q) pulseAt(tl, 0, "?", Q, 12, 12, INK.query, 1);
      const max = Math.max(...trace.vector_hits.map((h) => h.dense), 1e-9);
      trace.vector_hits.slice(0, 12).forEach((h, i) => {
        const p = hitPos(h);
        if (!p) return;
        const size = 5 + 11 * (h.dense / max);
        pulseAt(tl, i * 130, String(i + 1), p, 1.5, size, INK.cyan, 460, () =>
          paintEntities(h.entities, INK.cyan, 1.8),
        );
      });
      tl.at(1500, () => cosmos.fit(0.2));
    } else if (stage === 2) {
      if (Q) pulseAt(tl, 0, "?", Q, 10, 10, INK.query, 1);
      // BFS glow: seeds first, then one hop at a time along real edges
      const seeds = trace.graph.nodes.filter((n) => n.seed && n.xy);
      seeds.forEach((n) => {
        if (n.xy) pulseAt(tl, 0, "", n.xy, 2, 10, INK.gold, 380);
      });
      tl.at(0, () => paintEntities(seeds.map((n) => n.name), INK.gold, 2.4));
      const maxRing = Math.max(...[...ringDepth.values()], 1);
      for (let d = 1; d <= maxRing; d++) {
        tl.at(150 + d * 240, () => ringPaint(d, INK.magenta, 1.0));
      }
      tl.tween(300, 700, (t) => cosmos.setEdgeOpacity(0.09 + (0.35 - 0.09) * t));
      if (seeds.length) {
        const cx = seeds.reduce((a, n) => a + n.xy![0], 0) / seeds.length;
        const cy = seeds.reduce((a, n) => a + n.xy![1], 0) / seeds.length;
        const [x, y] = toWorld([cx, cy]);
        cosmos.flyTo(x, y, detail(), 1600);
      }
    } else if (stage === 3) {
      if (Q) pulseAt(tl, 0, "?", Q, 10, 10, INK.query, 1);
      const max = Math.max(...trace.bm25_hits.map((h) => h.sparse), 1e-9);
      // BM25 hits rain in from above their final spot
      trace.bm25_hits.slice(0, 12).forEach((h, i) => {
        const p = hitPos(h);
        if (!p) return;
        const size = 5 + 11 * (h.sparse / max);
        const [fx, fy] = toWorld(p);
        const [sx, sy] = toWorld([p[0], p[1] + 22]);
        let mid: number | null = null;
        tl.at(i * 120, () => {
          paintEntities(h.entities, INK.green, 1.8);
          mid = mark(String(i + 1), [p[0], p[1] + 22], 2, INK.green);
        });
        tl.tween(i * 120, 500, (t) => {
          if (mid === null) return;
          cosmos?.moveMarker(mid, sx + (fx - sx) * t, sy + (fy - sy) * t, 2 + (size - 2) * t);
        });
      });
      tl.at(1600, () => cosmos.fit(0.2));
    } else if (stage === 4) {
      if (Q) pulseAt(tl, 0, "?", Q, 10, 10, INK.query, 1);
      trace.fusion.forEach((h, i) => {
        const p = hitPos(h);
        if (!p) return;
        pulseAt(tl, i * 110, String(i + 1), p, 2, 13 - i * 0.5, INK.orange, 380, () =>
          paintEntities(h.entities, INK.orange, 2.0),
        );
      });
      tl.at(trace.fusion.length * 110 + 300, () => cosmos.fit(0.2));
    } else if (stage === 5) {
      if (Q) pulseAt(tl, 0, "?", Q, 10, 10, INK.query, 1);
      const after = new Map(trace.rerank.after.map((id, i) => [id, i + 1]));
      // stamp the fusion order first…
      trace.fusion.forEach((h) => {
        const p = hitPos(h);
        const moved = h.dense_rank !== after.get(h.chunk_id);
        if (p) pulseAt(tl, 0, moved ? "!" : "=", p, moved ? 4 : 8, moved ? 13 : 8, moved ? INK.white : INK.orange, 260);
      });
      tl.at(600, () => paintEntities([...new Set(trace.fusion.flatMap((h) => h.entities))], INK.white, 1.6));
      // …then the moved chunks flare white
      trace.fusion.forEach((h, i) => {
        const p = hitPos(h);
        const moved = h.dense_rank !== after.get(h.chunk_id);
        if (p && moved) pulseAt(tl, 600 + i * 60, "!", p, 6, 15, INK.white, 460);
      });
      tl.at(1400, () => cosmos.fit(0.2));
    } else if (stage === 6) {
      if (Q) pulseAt(tl, 0, "?", Q, 10, 10, INK.query, 1);
      // context stack builds up: source chunks, then answer anchors
      trace.fusion.slice(0, 8).forEach((h, i) => {
        const p = hitPos(h);
        if (p) pulseAt(tl, i * 140, `S${i + 1}`, p, 4, 10, INK.orange, 340);
      });
      trace.answer_preview.forEach((b, i) => {
        const p = posOf.size ? centroidOf(b.entities, posOf) : null;
        if (p) {
          pulseAt(tl, 1300 + i * 200, `A${i + 1}`, p, 6, 14, INK.query, 420, () =>
            paintEntities(b.entities, INK.gold, 2.4),
          );
        }
      });
      tl.at(1700, () => cosmos.fit(0.2));
    } else if (stage === 7) {
      if (Q) pulseAt(tl, 0, "?", Q, 10, 10, INK.query, 1);
      const bnames = [...new Set(trace.answer_preview.flatMap((b) => b.entities))];
      tl.at(0, () => paintEntities(bnames, INK.gold, 2.4));
      trace.answer_preview.forEach((b, i) => {
        const p = posOf.size ? centroidOf(b.entities, posOf) : null;
        if (p) pulseAt(tl, 250 + i * 350, `A${i + 1}`, p, 8, 16, INK.query, 520);
      });
      tl.at(700, () => cosmos.fit(0.2));
    }
    tl.start();
    return () => tl.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, trace, cosmos, speed]);

  // ---- autoplay: per-stage pacing = reveal length + hold (speed-scaled)
  const REVEAL_MS = [900, 2100, 1900, 2100, 1900, 1700, 2300, 1700];
  const stageInterval = REVEAL_MS[stage] + HOLD_MS / speed;

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      animateNext.current = true;
      setStage((s) => (s + 1) % 8);
    }, stageInterval);
    return () => window.clearTimeout(id);
  }, [playing, stage, stageInterval]);

  const goTo = (s: number, animate: boolean) => {
    animateNext.current = animate;
    setPlaying(false);
    setStage((s + 8) % 8);
  };

  const focusPoint = (p: XY, names: string[], color: RGBA = INK.white) => {
    if (!cosmos) return;
    paintEntities(names, color, 2.6);
    const [x, y] = toWorld(p);
    cosmos.flyTo(x, y, detail(), 1400);
  };

  const focusChunk = (h: ChunkHit) => {
    const p = hitPos(h);
    if (!cosmos || !p) return;
    focusPoint(p, h.entities, INK.white);
  };

  const cycleSpeed = () => {
    setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]);
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
        <div className="stagebody" key={stage}>
          <StageBody stage={stage} trace={trace} onFocusChunk={focusChunk} onFocusPoint={focusPoint} />
        </div>
      </div>
      <div
        className="timeline"
        tabIndex={0}
        role="group"
        aria-label="Journey playback controls"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") { goTo(stage + 1, true); e.preventDefault(); }
          else if (e.key === "ArrowLeft") { goTo(stage - 1, true); e.preventDefault(); }
          else if (e.key === " ") { setPlaying((p) => !p); e.preventDefault(); }
          else if (e.key === "Home") { goTo(0, false); e.preventDefault(); }
          else if (e.key === "End") { goTo(7, false); e.preventDefault(); }
        }}
      >
        <div className="caption" key={`cap-${stage}`}>
          <b>{STAGES[stage].title}.</b> {trace ? STAGES[stage].caption(trace) : "loading trace…"}
        </div>
        {playing && (
          <div className="stageprog" key={`prog-${stage}-${speed}`} style={{ animationDuration: `${stageInterval}ms` }} />
        )}
        <div className="scrub">
          <button onClick={() => goTo(stage - 1, true)} title="previous stage (←)"><ChevronLeftIcon size={13} /></button>
          <button onClick={() => setPlaying((p) => !p)} className="primary" title={playing ? "pause (space)" : "play (space)"}>
            {playing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
          </button>
          <button onClick={() => goTo(stage + 1, true)} title="next stage (→)"><ChevronRightIcon size={13} /></button>
          <input
            type="range"
            min={0}
            max={7}
            step={1}
            value={stage}
            onChange={(e) => goTo(Number(e.target.value), false)}
            aria-label="Stage scrubber"
          />
          <div className="dots">
            {STAGES.map((s, i) => (
              <button key={s.id} className={i === stage ? "dot on" : "dot"} title={s.title} onClick={() => goTo(i, false)}>
                {i + 1}
              </button>
            ))}
          </div>
          <button className="speed" onClick={cycleSpeed} title="playback speed — applies to reveals and pacing">
            {speed}×
          </button>
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
  stage, trace, onFocusChunk, onFocusPoint,
}: {
  stage: number;
  trace: TravelTrace | null;
  onFocusChunk: (h: ChunkHit) => void;
  onFocusPoint: (p: XY, names: string[], color?: RGBA) => void;
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
          <li key={h.chunk_id} style={{ animationDelay: `${i * 70}ms` }}><button onClick={() => onFocusChunk(h)}>
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
          {seeds.slice(0, 10).map((n, i) => (
            <li key={n.name} style={{ animationDelay: `${i * 60}ms` }}>
              <button className="plainrow" onClick={() => { if (n.xy) onFocusPoint(n.xy, [n.name], INK.gold); }}>
                <b>{n.name}</b> <span className="dim">{n.type} · {n.desc.slice(0, 90)}</span>
              </button>
            </li>
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
          <li key={h.chunk_id} style={{ animationDelay: `${i * 60}ms` }}><button onClick={() => onFocusChunk(h)}>
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
          <li key={h.chunk_id} style={{ animationDelay: `${i * 70}ms` }}><button onClick={() => onFocusChunk(h)}>
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
          <ol>{trace.rerank.before.slice(0, 10).map((id, i) => <li key={id} className={trace.rerank.after[i] !== id ? "moved" : ""} style={{ animationDelay: `${i * 50}ms` }}>{i + 1}. {name(id)}</li>)}</ol>
        </div>
        <div>
          <h4>served order (out)</h4>
          <ol>{trace.rerank.after.slice(0, 10).map((id, i) => <li key={id} className={trace.rerank.before[i] !== id ? "moved" : ""} style={{ animationDelay: `${i * 50}ms` }}>{i + 1}. {name(id)}</li>)}</ol>
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
        <h4>entities ({trace.context_blocks.entities.length}) — click to fly</h4>
        <ul>
          {trace.context_blocks.entities.slice(0, 6).map((e, i) => {
            const p = trace.graph.nodes.find((n) => n.name === e.entity)?.xy ?? null;
            return (
              <li key={i} style={{ animationDelay: `${i * 80}ms` }}>
                {p ? (
                  <button className="plainrow" onClick={() => onFocusPoint(p, [e.entity], INK.gold)}>
                    <b>{e.entity}</b> <span className="dim">{(e.description ?? "").slice(0, 100)}</span>
                  </button>
                ) : (
                  <><b>{e.entity}</b> <span className="dim">{(e.description ?? "").slice(0, 100)}</span></>
                )}
              </li>
            );
          })}
        </ul>
        <h4>relations (sample)</h4>
        <ul>{trace.context_blocks.relations.slice(0, 5).map((r, i) => <li key={i} style={{ animationDelay: `${400 + i * 80}ms` }}><span className="dim">{r.entity1} → {r.entity2}</span></li>)}</ul>
        <h4>sources ({trace.context_blocks.source_count})</h4>
        <ul>{trace.context_blocks.sources.slice(0, 6).map((s, si) => <li key={`${s.ref}-${si}`} className="dim"><span className="ref">[ref {s.ref}]</span> {s.doc}</li>)}</ul>
      </div>
    );
  }
  return (
    <div className="ctx">
      <p className="dim">Extractive preview — verbatim quotes, not LLM prose. Click a fact to fly to the nodes it came from.</p>
      {trace.answer_preview.map((b, i) => {
        const p = centroidOf(b.entities, posOfLocal(trace));
        return (
          <button
            key={i}
            className="bullet factrow"
            style={{ animationDelay: `${i * 120}ms` }}
            onClick={() => { if (p) onFocusPoint(p, b.entities, INK.gold); }}
            title={p ? "fly to the source nodes" : "no positioned entities for this fact"}
            disabled={!p}
          >
            <p>“{b.quote}…”</p>
            <p><span className="ref">[A{i + 1} {b.doc}]</span> <span className="dim">via {b.entities.slice(0, 3).join(", ")}</span></p>
          </button>
        );
      })}
    </div>
  );
}

function posOfLocal(trace: TravelTrace) {
  const m = new Map<string, XY>();
  trace.graph.nodes.forEach((n) => {
    if (n.xy) m.set(n.name, n.xy);
  });
  return m;
}
