import { useCallback, useEffect, useState } from "react";
import CosmosCanvas from "./components/CosmosCanvas";
import CosmosView from "./components/CosmosView";
import TravelView from "./components/TravelView";
import { toWorld, type Cosmos } from "./lib/cosmos";
import { loadEntityCoords, loadGraph, loadManifest, loadNodeIndex } from "./lib/data";
import type { CosmosGraph, TraceManifestEntry } from "./lib/types";

export default function App() {
  const [tab, setTab] = useState<"cosmos" | "travel">("cosmos");
  const [cosmosFull, setCosmosFull] = useState<Cosmos | null>(null);
  const [cosmosTravel, setCosmosTravel] = useState<Cosmos | null>(null);
  const [graph, setGraph] = useState<CosmosGraph | null>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [manifest, setManifest] = useState<TraceManifestEntry[] | null>(null);
  const [progress, setProgress] = useState<string | null>("loading index…");
  const [xyByIdx, setXyByIdx] = useState<([number, number] | null)[] | null>(null);

  useEffect(() => {
    let dead = false;
    Promise.all([loadGraph(), loadNodeIndex(), loadEntityCoords(), loadManifest()])
      .then(([g, idx, coords, man]) => {
        if (dead) return;
        setGraph(g);
        setNames(idx);
        setManifest(man);
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
      .catch((e) => !dead && setProgress(`data load failed: ${String(e)}`));
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
        if (!dead) setProgress(`lighting up 47k stars… ${(done / total * 100).toFixed(0)}%`);
      })
      .then(() => !dead && setProgress(null))
      .catch((e) => !dead && setProgress(`cosmos load failed: ${String(e)}`));
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

  return (
    <div className="app">
      <div className={tab === "cosmos" ? "canvaswrap" : "canvaswrap hidden"}>
        <CosmosCanvas onCosmos={setCosmosFull} onSelect={() => {}} onHover={() => {}} />
      </div>
      <div className={tab === "travel" ? "canvaswrap" : "canvaswrap hidden"}>
        <CosmosCanvas onCosmos={setCosmosTravel} onSelect={() => {}} onHover={() => {}} />
      </div>

      <header className="topbar">
        <span className="brand">✦ MEMORY TRAVEL <span className="dim">· how machine memory remembers</span></span>
        <nav>
          <button className={tab === "cosmos" ? "on" : ""} onClick={() => setTab("cosmos")}>cosmos</button>
          <button className={tab === "travel" ? "on" : ""} onClick={() => setTab("travel")}>travel</button>
          <a className="doclink" href="https://github.com/" title="see docs/trace-api.md in the repo" onClick={(e) => e.preventDefault()}>v1 · fixtures, not live</a>
        </nav>
      </header>

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
      {tab === "travel" && <TravelView cosmos={cosmosTravel} manifest={manifest} />}
    </div>
  );
}
