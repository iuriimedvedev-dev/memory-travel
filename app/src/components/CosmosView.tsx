import { useMemo, useState } from "react";
import type { Cosmos } from "../lib/cosmos";
import type { CosmosGraph } from "../lib/types";

interface Props {
  cosmos: Cosmos | null;
  graph: CosmosGraph | null;
  names: string[] | null;
  loading: string | null;
  onTour: () => void;
  focusNode: (idx: number) => void;
}

export default function CosmosView({ cosmos, graph, names, loading, onTour, focusNode }: Props) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);

  const results = useMemo(() => {
    if (!names || q.trim().length < 2) return [];
    const needle = q.toLowerCase();
    const out: number[] = [];
    for (let i = 0; i < names.length && out.length < 8; i++) {
      if (names[i].toLowerCase().includes(needle)) out.push(i);
    }
    return out;
  }, [names, q]);

  const select = (idx: number) => {
    setSel(idx);
    focusNode(idx);
  };

  const node = sel !== null && graph ? graph.nodes[sel] : null;

  return (
    <div className="panel left">
      <h1>Memory Cosmos</h1>
      <p className="sub">
        The live HARS knowledge graph — {graph ? graph.nodes.length.toLocaleString() : "…"} entities,{" "}
        {graph ? graph.edges.length.toLocaleString() : "…"} relations, laid out by meaning (UMAP over stored
        768-dim vectors). Not a mock: this is the production index.
      </p>
      {loading && <p className="loading">{loading}</p>}
      <input
        className="search"
        placeholder="find an entity… (e.g. VEA, DROID, checkpoint)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="results">
          {results.map((i) => (
            <li key={i}>
              <button onClick={() => select(i)}>
                <b>{names![i]}</b> <span className="dim">{graph!.nodes[i].t}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {node && (
        <div className="nodecard">
          <h3>{node.id}</h3>
          <p className="dim">
            {node.t} · degree {node.deg}
          </p>
          <p>{node.d || "—"}</p>
          <button
            onClick={() => {
              setSel(null);
              cosmos?.paint(null);
              cosmos?.spotlight(null);
            }}
          >
            clear highlight
          </button>
        </div>
      )}
      {hoverName && !node && <p className="hover">⌖ {hoverName}</p>}
      <div className="row">
        <button onClick={() => cosmos?.fit()}>reset view</button>
        <button className="primary" onClick={onTour} disabled={!graph}>
          ✦ take the tour — one query’s journey
        </button>
      </div>
      <p className="hint">drag to pan · scroll to zoom · click a star for details</p>
      <SelectBridge select={select} setHover={setHoverName} cosmos={cosmos} graph={graph} />
    </div>
  );
}

import { useEffect } from "react";

/** Wires canvas click/hover events into this panel (registered once per cosmos). */
function SelectBridge({
  cosmos,
  graph,
  select,
  setHover,
}: {
  cosmos: Cosmos | null;
  graph: CosmosGraph | null;
  select: (i: number) => void;
  setHover: (n: string | null) => void;
}) {
  useEffect(() => {
    if (!cosmos || !graph) return;
    cosmos.onSelect = (s) => {
      if (!s) return;
      select(s.graphIdx);
      const paints = new Map<number, { color: [number, number, number, number]; }>([[s.graphIdx, { color: [1.0, 0.85, 0.3, 1] }]]);
      cosmos.paint(paints);
    };
    cosmos.onHover = (s) => setHover(s ? graph.nodes[s.graphIdx]?.id ?? null : null);
    return () => {
      cosmos.onSelect = null;
      cosmos.onHover = null;
    };
  }, [cosmos, graph, select, setHover]);
  return null;
}
