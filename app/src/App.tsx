import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CosmosCanvas from "./components/CosmosCanvas";
import CosmosView from "./components/CosmosView";
import ErrorOverlay from "./components/ErrorOverlay";
import QueryBar from "./components/QueryBar";
import TravelView from "./components/TravelView";
import { SparkIcon } from "./components/icons";
import { INK, toWorld, type Cosmos, type RGBA } from "./lib/cosmos";
import { compileLiveTrace } from "./lib/compileLive";
import { loadChunkCoords, loadEntityCoords, loadGraph, loadManifest, loadNodeIndex } from "./lib/data";
import { memoryRecallLive } from "./lib/live";
import type { CosmosGraph, TraceManifestEntry, TravelTrace } from "./lib/types";
import { WEBGPU_BROWSERS, hasWebGPU } from "./lib/webgpu";

export default function App() {
  const [tab, setTab] = useState<"cosmos" | "travel">("cosmos");
  const [cosmosFull, setCosmosFull] = useState<Cosmos | null>(null);
  const [cosmosTravel, setCosmosTravel] = useState<Cosmos | null>(null);
  const [graph, setGraph] = useState<CosmosGraph | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<TraceManifestEntry[] | null>(null);
  const [progress, setProgress] = useState<string | null>("loading index…");
  const [dataError, setDataError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [dismissedGate, setDismissedGate] = useState(false);
  const [xyByIdx, setXyByIdx] = useState<([number, number] | null)[] | null>(null);
  const [chunkXy, setChunkXy] = useState<Record<string, [number, number]>>({});

  // Live Q&A state (one box above both views).
  const [liveTrace, setLiveTrace] = useState<TravelTrace | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const noWebGPU = useMemo(() => !hasWebGPU(), []);

  useEffect(() => {
    let dead = false;
    Promise.all([loadGraph(), loadNodeIndex(), loadEntityCoords(), loadChunkCoords(), loadManifest()])
      .then(([g, idx, coords, cxy, man]) => {
        if (dead) return;
        setGraph(g);
        setNames(idx);
        setManifest(man);
        setChunkXy(cxy);
        const m = new Map<string, [number, number]>();
        coords.ids.forEach((id, i) => m.set(id, coords.xy[i]));
        let hit = 0;
        const aligned = g.nodes.map((n) => {
          const xy = m.get(n.id) ?? null;
          if (xy) hit++;
          return xy;
        });
        setXyByIdx(aligned);
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
    if (!cosmosFull || !graph || !xyByIdx) return;
    let dead = false;
    setProgress("lighting up 47k stars…");
    cosmosFull
      .load(graph, xyByIdx, (done, total) => {
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
  }, [cosmosFull, graph, xyByIdx]);

  const focusNode = useCallback(
    (idx: number) => {
      if (!cosmosFull || !xyByIdx) return;
      const xy = xyByIdx[idx];
      if (!xy) return;
      const [x, y] = toWorld(xy);
      cosmosFull.flyTo(x, y, cosmosFull.currentZoom() * 3.2, 1400);
    },
    [cosmosFull, xyByIdx],
  );

  const onCanvasError = useCallback((e: Error) => {
    setCanvasError(e.message);
  }, []);

  // ---- live question: recall -> compile (same path as fixtures) -> play + highlight
  const liveReady = graph !== null && names !== null && xyByIdx !== null;

  const askLive = useCallback(
    async (question: string) => {
      if (!graph || !names || !xyByIdx) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setAsking(true);
      setAskError(null);
      setAskNote(null);
      try {
        const t0 = performance.now();
        const { result, clientLatencyS, endpoint } = await memoryRecallLive(question, { signal: ctrl.signal });
        const idxOf = new Map(names.map((n, i) => [n, i] as const));
        const entityXy = new Map<string, [number, number]>();
        graph.nodes.forEach((n, i) => {
          const xy = xyByIdx[i];
          if (xy) entityXy.set(n.id, xy);
        });
        const trace = compileLiveTrace(question, result, clientLatencyS, {
          graph,
          idxOf,
          entityXy,
          chunkXy,
        });
        setLiveTrace(trace);
        setTab("travel");
        const hits = trace.graph.nodes.filter((n) => n.seed).map((n) => n.i);
        if (cosmosFull && hits.length) {
          const keep = new Set(hits);
          cosmosFull.spotlight(keep);
          const paints = new Map<number, { color: RGBA }>(
            hits.map((i): [number, { color: RGBA }] => [i, { color: INK.gold }]),
          );
          cosmosFull.paint(paints);
          focusNode(hits[0]);
          setAskNote(
            `live answer in Travel (${((performance.now() - t0) / 1000).toFixed(1)}s via ${endpoint === "/api/memory" ? "dev proxy" : "direct"}); ${hits.length} hit nodes lit in Cosmos`,
          );
        } else if (!cosmosFull) {
          setAskNote("live answer in Travel; Cosmos canvas unavailable (WebGPU), so no highlight");
        } else {
          setAskNote("live answer in Travel; no graph hits to highlight");
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
    [graph, names, xyByIdx, chunkXy, cosmosFull, focusNode],
  );

  const cancelAsk = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div className="app">
      <div className={tab === "cosmos" ? "canvaswrap" : "canvaswrap hidden"}>
        <CosmosCanvas label="cosmos" onCosmos={setCosmosFull} onSelect={() => {}} onHover={() => {}} onError={onCanvasError} />
      </div>
      <div className={tab === "travel" ? "canvaswrap" : "canvaswrap hidden"}>
        <CosmosCanvas label="travel" onCosmos={setCosmosTravel} onSelect={() => {}} onHover={() => {}} onError={onCanvasError} />
      </div>

      <header className="topbar">
        <span className="brand">
          <SparkIcon size={13} /> MEMORY TRAVEL <span className="dim">· how machine memory remembers</span>
        </span>
        <nav>
          <button className={tab === "cosmos" ? "on" : ""} onClick={() => setTab("cosmos")}>cosmos</button>
          <button className={tab === "travel" ? "on" : ""} onClick={() => setTab("travel")}>travel</button>
          <a className="doclink" href="https://github.com/" title="see docs/trace-api.md in the repo" onClick={(e) => e.preventDefault()}>
            v1 · fixtures + live ask
          </a>
        </nav>
      </header>

      <QueryBar asking={asking} error={askError} note={askNote} ready={liveReady} onAsk={askLive} onCancel={cancelAsk} />

      {tab === "cosmos" && (
        <CosmosView
          cosmos={cosmosFull}
          graph={graph}
          names={names}
          loading={progress}
          onTour={() => setTab("travel")}
          focusNode={focusNode}
        />
      )}
      {tab === "travel" && <TravelView cosmos={cosmosTravel} manifest={manifest} liveTrace={liveTrace} />}

      {dataError && (
        <ErrorOverlay
          title="Index data failed to load"
          body="The app fetches its data files with relative paths (data/graph.json, coords, traces/manifest.json). One of them failed — check the file named below exists in app/public/data/ and the dev server is serving it."
          detail={dataError}
        />
      )}
      {!dataError && canvasError && (
        <ErrorOverlay
          title="3D initialisation failed"
          body="The canvas could not start. On a WebGPU-less browser this is expected — the text panels stay readable. Otherwise check GPU drivers / hardware acceleration."
          detail={canvasError}
        />
      )}
      {!dataError && !canvasError && noWebGPU && !dismissedGate && (
        <ErrorOverlay
          title="WebGPU unavailable — 3D views cannot render"
          body={`This browser exposes no WebGPU (navigator.gpu is missing), and the graph renderer is WebGPU-only. ${WEBGPU_BROWSERS}`}
          onDismiss={() => setDismissedGate(true)}
        />
      )}
    </div>
  );
}
