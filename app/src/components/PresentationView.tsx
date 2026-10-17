// Presentation mode — guided 9-chapter walkthrough of how the memory works.
// Dark fullscreen stage; narration card (RU/EN) over the LIVE 3D starfield
// driven by real data (full graph + the enriched trace). Chapters 1-2 + 9 use
// the full cosmos; 3-8 replay the journey choreography on the trace subgraph.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CosmosCanvas from "./CosmosCanvas";
import { INK, toWorld3, type XYZ } from "../lib/cosmos";
import type { AnyCosmos } from "../lib/cosmos2d";
import { asJourney3D } from "../lib/cosmos3d";
import { loadChunkCoords, loadEntityCoords, loadGraph, loadIngestFixture, loadManifest, loadNodeIndex, loadTrace } from "../lib/data";
import { stageCamera } from "../lib/journeyCam";
import { makeTimeline, type Timeline } from "../lib/reveal";
import { CHAPTERS, type PresCtx } from "../lib/presentation";
import type { CosmosGraph, IngestFixture, TravelTrace } from "../lib/types";
import { pick } from "../i18n/strings";
import { useI18n } from "../i18n/useI18n";
import { AnimatedCard } from "./AnimatedCard";
import { IngestPanel } from "./IngestPanel";
import { PresStageCards } from "./PresStageCards";
import { ChevronLeftIcon, ChevronRightIcon, GearIcon, PauseIcon, PlayIcon, XIcon } from "./icons";
import { Inspector, type Inspection } from "./Inspector";

/** Chapters whose data is owed a docked card row (3–8 = the transformation). */
const CARD_CHAPTERS = new Set(["embed", "channels", "fusion", "rerank", "context", "answer"]);

export default function PresentationView({ onExit }: { onExit: () => void }) {
  const { t, lang, setLangL10n } = useI18n();
  const [chapter, setChapter] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [progress, setProgress] = useState<string | null>(t.presLoading);
  const [fixture, setFixture] = useState<IngestFixture | null>(null);

  // two canvases: full cosmos (ch 1-2, 9) + trace subgraph (ch 3-8)
  const [cosmosFull, setCosmosFull] = useState<AnyCosmos | null>(null);
  const [cosmosTrace, setCosmosTrace] = useState<AnyCosmos | null>(null);
  const [graph, setGraph] = useState<CosmosGraph | null>(null);
  const [posByIdx, setPosByIdx] = useState<(XYZ | null)[] | null>(null);
  const [trace, setTrace] = useState<TravelTrace | null>(null);
  const timeline = useRef<Timeline | null>(null);
  const animateRef = useRef(true);
  const jFull = cosmosFull ? asJourney3D(cosmosFull) : null;
  const jTrace = cosmosTrace ? asJourney3D(cosmosTrace) : null;

  const ch = CHAPTERS[chapter];
  const ctx: PresCtx = useMemo(
    () => ({ trace, nodes: graph?.nodes.length ?? 47355, edges: graph?.edges.length ?? 54502 }),
    [trace, graph],
  );

  // ---- data: full graph + coords + trace (same loaders as the main views)
  useEffect(() => {
    let dead = false;
    Promise.all([loadGraph(), loadNodeIndex(), loadEntityCoords(), loadChunkCoords(), loadManifest(), loadIngestFixture()])
      .then(([g, idx, coords, , man, fx]) => {
        if (dead) return;
        setGraph(g);
        setFixture(fx as IngestFixture);
        const m = new Map<string, XYZ>();
        coords.ids.forEach((id, i) => {
          const v = coords.xyz?.[i];
          if (v) m.set(id, v);
          else {
            const xy = coords.xy[i];
            if (xy) m.set(id, [xy[0], xy[1], 0]);
          }
        });
        setPosByIdx(
          g.nodes.map((n) => {
            const v = m.get(n.id);
            return v ? toWorld3(v) : null;
          }),
        );
        void idx;
        void man;
      })
      .catch((e) => !dead && setProgress(`data: ${String(e)}`));
    loadTrace("traces/trace_01.json").then((tr) => !dead && setTrace(tr)).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, []);

  // ---- load canvases when they first become visible
  const chViz = ch.viz;
  useEffect(() => {
    if (chViz !== "cosmos" || !cosmosFull || !graph || !posByIdx) return;
    let dead = false;
    setProgress(t.loadingStars);
    cosmosFull
      .load(graph, posByIdx, (done, total) => !dead && setProgress(`${t.loadingStars} ${Math.round((done / total) * 100)}%`))
      .then(() => !dead && setProgress(null))
      .catch((e) => !dead && setProgress(String(e)));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmosFull, graph, posByIdx, chViz]);

  const [traceLoaded, setTraceLoaded] = useState(0);
  useEffect(() => {
    if (chViz !== "trace" || !cosmosTrace || !trace) return;
    let dead = false;
    const g2g = new Map<number, number>();
    trace.graph.nodes.forEach((n, li) => g2g.set(n.i, li));
    const cg: CosmosGraph = {
      nodes: trace.graph.nodes.map((n) => ({ id: n.name, t: n.type, d: n.desc, deg: n.deg })),
      edges: trace.graph.edges
        .map(([s, e]) => [g2g.get(s), g2g.get(e)] as [number, number])
        .filter(([s, e]) => s !== undefined && e !== undefined),
    };
    cosmosTrace.clear();
    cosmosTrace
      .load(
        cg,
        trace.graph.nodes.map((n) => {
          const p = n.xyz ?? (n.xy ? [n.xy[0], n.xy[1], 0] : null);
          return p ? toWorld3(p) : null;
        }),
      )
      .then(() => {
        if (dead) return;
        setProgress(null);
        // load() ends with fit(): re-run the chapter choreography so the
        // chapter camera keyframe wins over the fit position
        setTraceLoaded((v) => v + 1);
      })
      .catch((e) => !dead && setProgress(String(e)));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cosmosTrace, chViz]);

  const traceCanvasActive = chViz === "trace";

  // ---- chapter choreography (compact replay of the journey primitives)
  const posOf = useMemo(() => {
    const m = new Map<string, XYZ>();
    trace?.graph.nodes.forEach((n) => {
      const p = n.xyz ?? (n.xy ? [n.xy[0], n.xy[1], 0] : null);
      if (p) m.set(n.name, p);
    });
    return m;
  }, [trace]);

  const centroid = (ps: XYZ[]): XYZ | null =>
    ps.length ? ps.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]] as XYZ, [0, 0, 0]).map((v) => v / ps.length) as XYZ : null;

  const playChapter = useCallback(() => {
    const cosmos = traceCanvasActive ? cosmosTrace : cosmosFull;
    const j3d = traceCanvasActive ? jTrace : jFull;
    timeline.current?.cancel();
    if (!cosmos) return;
    cosmos.paint(null);
    if (j3d) {
      j3d.clearContextLines();
      j3d.clearTrail();
      j3d.setEdgeRingProgress(1e9);
      j3d.setEdgeOpacity(0.028);
      j3d.setControlsEnabled(false);
    }
    const tl = makeTimeline(1, false);
    timeline.current = tl;
    const markers: number[] = [];
    const mark = (p: XYZ, size: number, color: typeof INK.cyan) => {
      const w = toWorld3(p);
      const id = j3d ? j3d.addMarker3("", w, size, color) : cosmos.addMarker("", w[0], w[1], size, color);
      markers.push(id);
    };

    if (!traceCanvasActive) {
      // full-cosmos chapters: gentle orbit + a couple of gold sparks
      if (j3d) {
        j3d.cameraSet([0, 60, 145], [0, 0, 0]);
        tl.tween(400, 12000, (tt) => j3d.orbitAround([0, 0, 0], 148, tt * 0.9, 0.36));
      }
    } else if (trace) {
      const stage = ch.stage ?? 0;
      const qpos = trace.query.xyz ?? null;
      const W = (p: XYZ | null): XYZ | null => (p ? toWorld3(p) : null);
      const key = stageCamera(stage, {
        query: W(qpos),
        vecCluster: W(centroid(trace.vector_hits.slice(0, 12).map((h) => h.xyz).filter((p): p is XYZ => !!p))),
        seeds: W(centroid(trace.graph.nodes.filter((n) => n.seed).map((n) => n.xyz).filter((p): p is XYZ => !!p))),
        bm25: W(centroid(trace.bm25_hits.slice(0, 12).map((h) => h.xyz).filter((p): p is XYZ => !!p))),
        scene: W(qpos),
      });
      if (j3d) j3d.cameraFly(key.pos, key.target, 1400, "inout");
      const paint = (names: string[], color: typeof INK.cyan) => {
        const paints = new Map<number, { color: typeof INK.cyan }>();
        trace.graph.nodes.forEach((n, li) => {
          if (names.includes(n.name)) paints.set(li, { color });
        });
        cosmos.paint(paints as never);
      };
      if (stage === 0 && qpos) {
        tl.at(300, () => mark(qpos, 16, INK.query));
      } else if (stage === 1) {
        if (qpos) tl.at(0, () => mark(qpos, 12, INK.query));
        trace.vector_hits.slice(0, 10).forEach((h, i) => {
          tl.at(600 + i * 180, () => {
            if (h.xyz) mark(h.xyz, 4 + 9 * (h.dense / Math.max(...trace.vector_hits.map((x) => x.dense))), INK.cyan);
            paint(h.entities, INK.cyan);
          });
        });
      } else if (stage === 4) {
        trace.fusion.forEach((h, i) => {
          tl.at(i * 220, () => {
            if (h.xyz) mark(h.xyz, 12 - i * 0.5, INK.orange);
            paint(h.entities, INK.orange);
          });
        });
      } else if (stage === 5) {
        const after = new Map(trace.rerank.after.map((id, i) => [id, i + 1]));
        const moved = trace.fusion.filter((h) => h.dense_rank !== after.get(h.chunk_id));
        tl.at(300, () => paint([...new Set(trace.fusion.flatMap((h) => h.entities))], INK.orange));
        tl.at(1200, () => paint([...new Set(moved.flatMap((h) => h.entities))], INK.white));
        tl.at(2400, () => paint([...new Set(moved.flatMap((h) => h.entities))], INK.orange));
      } else if (stage === 6) {
        if (qpos) {
          const ents = trace.context_blocks.entities.map((e) => posOf.get(e.entity)).filter((p): p is XYZ => !!p);
          tl.at(400, () => {
            if (j3d) j3d.setContextLines(toWorld3(qpos), ents.map((p) => toWorld3(p)), [1.0, 0.78, 0.25, 1]);
          });
          ents.forEach((p, i) => tl.at(500 + i * 200, () => mark(p, 9, INK.gold)));
        }
      } else if (stage === 7) {
        const trail: XYZ[] = [];
        if (qpos) trail.push(qpos);
        trace.fusion.slice(0, 8).forEach((h) => h.xyz && trail.push(h.xyz));
        trace.answer_preview.forEach((b) => {
          const ps = b.entities.map((e) => posOf.get(e)).filter((p): p is XYZ => !!p);
          const c = centroid(ps);
          if (c) {
            trail.push(c);
            tl.at(800 + trail.length * 150, () => mark(c, 14, INK.query));
          }
        });
        tl.at(500, () => paint([...new Set(trace.answer_preview.flatMap((b) => b.entities))], INK.gold));
        tl.at(600, () => {
          if (j3d) j3d.setTrail(trail.map((p) => toWorld3(p)), [1.0, 0.3, 0.5, 1]);
        });
        if (j3d) tl.at(0, () => j3d.cameraFly([0, 70, 150], [0, 0, 0], 2600, "inout"));
      }
    }
    tl.start();
    return () => {
      tl.cancel();
      markers.forEach((id) => {
        try {
          cosmos.removeMarker(id);
        } catch { /* noop */ }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, trace, cosmosFull, cosmosTrace, chViz, posOf, traceLoaded]);

  useEffect(() => {
    if (progress) return; // wait for data
    if (playing) playChapter();
    else timeline.current?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, progress, playChapter]);

  // ---- presenter controls
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { animateRef.current = true; setChapter((c) => Math.min(CHAPTERS.length - 1, c + 1)); }
      else if (e.key === "ArrowLeft") { setChapter((c) => Math.max(0, c - 1)); }
      else if (e.key === " ") { setPlaying((p) => !p); e.preventDefault(); }
      else if (e.key.toLowerCase() === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
      } else if (e.key === "Escape") {
        if (menuOpen) setMenuOpen(false);
        else onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, onExit]);

  const goto = (i: number) => {
    setMenuOpen(false);
    setInsp(null);
    setPlaying(true);
    setChapter((c) => {
      void c;
      animateRef.current = true;
      return i;
    });
  };

  return (
    <div className="pres">
      <div className={traceCanvasActive ? "canvaswrap" : "canvaswrap hidden"}>
        <CosmosCanvas label="pres-trace" onCosmos={setCosmosTrace} onSelect={() => {}} onHover={() => {}} onError={(e) => setProgress(String(e))} />
      </div>
      <div className={traceCanvasActive ? "canvaswrap hidden" : "canvaswrap"}>
        <CosmosCanvas label="pres-full" onCosmos={setCosmosFull} onSelect={() => {}} onHover={() => {}} onError={(e) => setProgress(String(e))} />
      </div>

      <div className="pres-top">
        <span className="pres-brand">MEMORY TRAVEL · {t.presLaunch}</span>
        <button className="langtoggle" onClick={() => setLangL10n(lang === "ru" ? "en" : "ru")} title={t.presLang}>
          {lang.toUpperCase()}
        </button>
        <button onClick={() => setMenuOpen((o) => !o)}>{t.presMenu}</button>
        <button onClick={onExit} title={t.presExit}>
          <XIcon size={11} /> {t.presExit}
        </button>
      </div>

      {menuOpen && (
        <div className="pres-menu">
          {CHAPTERS.map((c, i) => (
            <button key={c.id} className={i === chapter ? "on" : ""} onClick={() => goto(i)}>
              <span className="n">{i + 1}</span> {pick(c.title, lang)}
            </button>
          ))}
        </div>
      )}

      {/* chapter 2: two-panel ingest (records | parameterised split preview) */}
      {ch.id === "ingest" && fixture && <IngestPanel fixture={fixture} lang={lang} t={t} />}

      {/* chapters 3-8: the chapter's real data docked at the top of the cosmos */}
      {CARD_CHAPTERS.has(ch.id) && (
        <PresStageCards chapterId={ch.id} trace={trace} t={t} lang={lang} />
      )}

      <div className="pres-bottom">
        <div className="pres-progress" aria-hidden="true">
          {CHAPTERS.map((c, i) => (
            <span key={c.id} className={i <= chapter ? "on" : ""} />
          ))}
        </div>
        <div className="pres-chapternum">
          {fmtT(t.presChapter, { n: chapter + 1, total: CHAPTERS.length })} · {ch.viz === "trace" ? "trace" : "cosmos"}
        </div>
        {/* narration + fact render through AnimatedCard (remount per chapter = replay) */}
        <AnimatedCard
          key={ch.id}
          open
          variant="plain"
          size="lg"
          className="pres-narrcard"
          title={pick(ch.title, lang)}
        >
          <p className="pres-narr">{pick(ch.narration(ctx), lang)}</p>
        </AnimatedCard>
        <AnimatedCard key={`${ch.id}-fact`} open variant="accent" size="md" className="pres-factcard" delayMs={120}>
          <p className="pres-fact">{pick(ch.fact(ctx), lang)}</p>
        </AnimatedCard>
        <div className="pres-controls">
          <button onClick={() => goto(chapter - 1)} disabled={chapter === 0} title={t.presPrev}>
            <ChevronLeftIcon size={12} />
          </button>
          <button className="primary" onClick={() => setPlaying((p) => !p)} title={playing ? t.stagePause : t.stagePlay}>
            {playing ? <PauseIcon size={12} /> : <PlayIcon size={12} />}
          </button>
          <button onClick={() => goto(chapter + 1)} disabled={chapter === CHAPTERS.length - 1} title={t.presNext}>
            <ChevronRightIcon size={12} />
          </button>
          <span className="spacer" />
          {traceCanvasActive && trace && (
            <button onClick={() => setInsp({ kind: "stage", stage: ch.stage ?? 0 })}>
              {t.inspectOpen} <GearIcon size={13} />
            </button>
          )}
          <span className="dim" style={{ fontSize: 11 }}>
            ←/→ · space · F · Esc
          </span>
        </div>
        {progress && <p className="loading">{progress}</p>}
      </div>

      {insp && (
        <Inspector
          insp={insp}
          trace={trace}
          onClose={() => setInsp(null)}
          onOpenChunk={(id) => setInsp({ kind: "chunk", chunkId: id })}
          onFocusPoint={() => undefined}
          t={t}
        />
      )}
    </div>
  );
}

function fmtT(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

