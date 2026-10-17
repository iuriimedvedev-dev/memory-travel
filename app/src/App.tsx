import { useCallback, useEffect, useRef, useState } from "react";
import CosmosCanvas, { type RenderMode } from "./components/CosmosCanvas";
import CosmosView from "./components/CosmosView";
import AboutModal from "./components/AboutModal";
import ErrorOverlay from "./components/ErrorOverlay";
import PresentationView from "./components/PresentationView";
import QueryBar, { type HistoryEntry } from "./components/QueryBar";
import TravelView from "./components/TravelView";
import { SparkIcon, XIcon } from "./components/icons";
import { INK, toWorld3, type RGBA, type XYZ } from "./lib/cosmos";
import type { AnyCosmos } from "./lib/cosmos2d";
import { asJourney3D } from "./lib/cosmos3d";
import { compileLiveTrace } from "./lib/compileLive";
import { loadChunkCoords, loadEntityCoords, loadGraph, loadManifest, loadNodeIndex } from "./lib/data";
import { memoryRecallLive } from "./lib/live";
import type { CosmosGraph, TraceManifestEntry, TravelTrace } from "./lib/types";
import { useI18n } from "./i18n/useI18n";

const HISTORY_KEY = "mt.history.v1";
const HISTORY_MAX = 8;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(h: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX)));
  } catch { /* private mode etc — history just won't persist */ }
}

export default function App() {
  const { t, lang, setLangL10n } = useI18n();
  const [tab, setTab] = useState<"cosmos" | "travel">("cosmos");
  const [presenting, setPresenting] = useState(false);
  const [cosmosFull, setCosmosFull] = useState<AnyCosmos | null>(null);
  const [cosmosTravel, setCosmosTravel] = useState<AnyCosmos | null>(null);
  const [graph, setGraph] = useState<CosmosGraph | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<TraceManifestEntry[] | null>(null);
  const [progress, setProgress] = useState<string | null>("loading index…");
  const [dataError, setDataError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [renderMode, setRenderMode] = useState<string | null>(null);
  const [modeDismissed, setModeDismissed] = useState(false);
  const [posByIdx, setPosByIdx] = useState<(XYZ | null)[] | null>(null);
  const [chunkXyz, setChunkXyz] = useState<Record<string, [number, number, number]>>({});

  // Live Q&A state (one box above both views).
  const [liveTrace, setLiveTrace] = useState<TravelTrace | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [elapsedS, setElapsedS] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [about, setAbout] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);

  // elapsed-seconds ticker for the honest phase hints while a recall runs
  useEffect(() => {
    if (!asking) return;
    setElapsedS(0);
    const id = window.setInterval(() => {
      setElapsedS((performance.now() - startedAtRef.current) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [asking]);

  useEffect(() => {
    let dead = false;
    Promise.all([loadGraph(), loadNodeIndex(), loadEntityCoords(), loadChunkCoords(), loadManifest()])
      .then(([g, idx, coords, cxyz, man]) => {
        if (dead) return;
        setGraph(g);
        setNames(idx);
        setManifest(man);
        setChunkXyz(cxyz);
        // xyz preferred; old coord files (xy only) flatten to z=0
        const m = new Map<string, XYZ>();
        coords.ids.forEach((id, i) => {
          const v = coords.xyz?.[i];
          if (v) m.set(id, v);
          else {
            const xy = coords.xy[i];
            if (xy) m.set(id, [xy[0], xy[1], 0]);
          }
        });
        let hit = 0;
        const aligned = g.nodes.map((n) => {
          const v = m.get(n.id) ?? null;
          if (v) hit++;
          // raw UMAP [-1,1] -> world units (shared mapping with markers)
          return v ? toWorld3(v) : null;
        });
        setPosByIdx(aligned);
        setProgress((p) => (g ? `${p} coord coverage ${(100 * hit / g.nodes.length).toFixed(1)}%` : p));
      })
      .catch((e: unknown) => {
        if (dead) return;
        // getJSON() names the file in its message: `fetch <path>: <status>`.
        const msg = e instanceof Error ? e.message : String(e);
        setDataError(msg);
        setProgress(`data load failed: ${msg}`);
      });
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    if (!cosmosFull || !graph || !posByIdx) return;
    let dead = false;
    setProgress("lighting up 47k stars…");
    cosmosFull
      .load(graph, posByIdx, (done, total) => {
        if (!dead) setProgress(`lighting up 47k stars… ${((done / total) * 100).toFixed(0)}%`);
      })
      .then(() => !dead && setProgress(null))
      .catch((e: unknown) => {
        if (dead) return;
        const msg = e instanceof Error ? e.message : String(e);
        setCanvasError(`cosmos subgraph load failed: ${msg}`);
        setProgress(`cosmos load failed: ${msg}`);
      });
    return () => {
      dead = true;
    };
  }, [cosmosFull, graph, posByIdx]);

  const focusNode = useCallback(
    (idx: number) => {
      if (!cosmosFull || !posByIdx) return;
      const p = posByIdx[idx];
      if (!p) return;
      const j = asJourney3D(cosmosFull);
      if (j) {
        // posByIdx already holds WORLD coords (toWorld3 applied at load);
        // focus = target tweens onto the node, camera ends 28 units away.
        j.flyToNode(p, 28, 850);
      } else {
        // 2D fallback: z doesn't exist there, plain eased zoom.
        cosmosFull.flyTo(p[0], p[1], cosmosFull.currentZoom() * 3.2, 1400);
      }
    },
    [cosmosFull, posByIdx],
  );

  const onCanvasError = useCallback((e: Error) => {
    setCanvasError(e.message);
  }, []);

  const onMode = useCallback((m: RenderMode) => {
    setRenderMode(m);
  }, []);

  // ---- live question: recall -> compile (same path as fixtures) -> play + highlight
  const liveReady = graph !== null && names !== null && posByIdx !== null;

  const askLive = useCallback(
    async (question: string) => {
      if (!graph || !names || !posByIdx) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      startedAtRef.current = performance.now();
      setAsking(true);
      setAskError(null);
      setAskNote(null);
      try {
        const t0 = performance.now();
        const { result, clientLatencyS, endpoint } = await memoryRecallLive(question, { signal: ctrl.signal });
        const idxOf = new Map(names.map((n, i) => [n, i] as const));
        const entityXy = new Map<string, [number, number]>();
        const entityXyz = new Map<string, XYZ>();
        graph.nodes.forEach((n, i) => {
          const v = posByIdx[i];
          if (v) {
            entityXyz.set(n.id, v);
            entityXy.set(n.id, [v[0], v[1]]);
          }
        });
        const trace = compileLiveTrace(question, result, clientLatencyS, {
          graph,
          idxOf,
          entityXy,
          entityXyz,
          chunkXyz,
        });
        setLiveTrace(trace);
        setTab("travel");
        const hits = trace.graph.nodes.filter((n) => n.seed).map((n) => n.i);
        const tookS = (performance.now() - t0) / 1000;
        setHistory((prev) => {
          const next = [{ q: question, ts: Date.now(), ms: tookS }, ...prev.filter((h) => h.q !== question)];
          saveHistory(next);
          return next.slice(0, HISTORY_MAX);
        });
        if (cosmosFull && hits.length) {
          const keep = new Set(hits);
          cosmosFull.spotlight(keep);
          const paints = new Map<number, { color: RGBA }>(
            hits.map((i): [number, { color: RGBA }] => [i, { color: INK.gold }]),
          );
          cosmosFull.paint(paints);
          focusNode(hits[0]);
          setAskNote(
            `live answer in Travel (${tookS.toFixed(1)}s via ${endpoint === "/api/memory" ? "dev proxy" : "direct"}); ${hits.length} hit nodes lit in Cosmos`,
          );
        } else if (!cosmosFull) {
          setAskNote(`live answer in Travel (${tookS.toFixed(1)}s); Cosmos canvas unavailable (no renderer), so no highlight`);
        } else {
          setAskNote(`live answer in Travel (${tookS.toFixed(1)}s); no graph hits to highlight`);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setAskError("live recall cancelled — fixtures still playable below.");
        } else {
          setAskError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        abortRef.current = null;
        setAsking(false);
      }
    },
    [graph, names, posByIdx, chunkXyz, cosmosFull, focusNode],
  );

  const cancelAsk = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="app">
      {presenting ? (
        <PresentationView onExit={() => setPresenting(false)} />
      ) : (
        <>
          <div className={tab === "cosmos" ? "canvaswrap" : "canvaswrap hidden"}>
            <CosmosCanvas label="cosmos" onCosmos={setCosmosFull} onSelect={() => {}} onHover={() => {}} onError={onCanvasError} onMode={onMode} />
          </div>
          <div className={tab === "travel" ? "canvaswrap" : "canvaswrap hidden"}>
            <CosmosCanvas label="travel" onCosmos={setCosmosTravel} onSelect={() => {}} onHover={() => {}} onError={onCanvasError} onMode={onMode} />
          </div>

          <header className="topbar">
            <span className="brand">
              <SparkIcon size={13} /> MEMORY TRAVEL <span className="dim">{t.brandSub}</span>
            </span>
            <nav>
              <button className={tab === "cosmos" ? "on" : ""} onClick={() => setTab("cosmos")}>{t.tabCosmos}</button>
              <button className={tab === "travel" ? "on" : ""} onClick={() => setTab("travel")}>{t.tabTravel}</button>
              <button className="langtoggle" onClick={() => setLangL10n(lang === "ru" ? "en" : "ru")} title={lang === "ru" ? "Switch to English" : "Переключить на русский"}>
                {lang.toUpperCase()}
              </button>
              <button className="doclink" onClick={() => setAbout(true)}>
                {t.aboutLink}
              </button>
            </nav>
          </header>

          <QueryBar
            asking={asking}
            error={askError}
            note={askNote}
            ready={liveReady}
            elapsedS={elapsedS}
            history={history}
            onAsk={askLive}
            onCancel={cancelAsk}
            onPickHistory={askLive}
            onClearHistory={() => {
              setHistory([]);
              saveHistory([]);
            }}
          />

          {tab === "cosmos" && (
            <CosmosView
              cosmos={cosmosFull}
              graph={graph}
              names={names}
              loading={progress}
              onTour={() => setPresenting(true)}
              focusNode={focusNode}
              mode={renderMode}
            />
          )}
          {tab === "travel" && <TravelView cosmos={cosmosTravel} manifest={manifest} liveTrace={liveTrace} />}
        </>
      )}

      {about && <AboutModal onClose={() => setAbout(false)} />}
      {dataError && (
        <ErrorOverlay
          title="Index data failed to load"
          body="The app fetches its data files with relative paths (data/graph.json, coords, traces/manifest.json). One of them failed — check the file named below exists in app/public/data/ and the dev server is serving it."
          detail={dataError}
        />
      )}
      {!dataError && canvasError && (
        <ErrorOverlay
          title="Canvas initialisation failed"
          body="Neither the WebGL2 renderer nor the Canvas2D fallback could start — this browser cannot provide any GPU canvas at all. The text panels stay readable. (On any browser from the last decade this path should be unreachable.)"
          detail={canvasError}
        />
      )}
      {!dataError && !canvasError && renderMode === "canvas2d" && !modeDismissed && (
        <div className={`modebadge ${tab === "travel" ? "raised" : ""}`} role="status">
          <span>
            <b>canvas2d fallback</b> — no WebGL2 in this browser, so the 3D starfield can't run;
            same data, same journey, flat projection.
          </span>
          <button className="ghostbtn" onClick={() => setModeDismissed(true)} title="dismiss">
            <XIcon size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

// re-transform nudge
