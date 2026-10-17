import { useEffect, useMemo, useRef, useState } from "react";
import type { CosmosGraph } from "../lib/types";
import type { AnyCosmos } from "../lib/cosmos2d";
import { INK } from "../lib/cosmos";
import { FAMILY_COLORS, FAMILY_LABEL, LEGEND_ORDER, colorForType, familyOf } from "../lib/palette";
import { fmt } from "../i18n/strings";
import { useI18n } from "../i18n/useI18n";
import { CompassIcon, LayersIcon, SearchIcon, SparkIcon, XIcon } from "./icons";

interface Props {
  cosmos: AnyCosmos | null;
  graph: CosmosGraph | null;
  names: string[] | null;
  loading: string | null;
  onTour: () => void;
  focusNode: (idx: number) => void;
  /** Which renderer actually came up (for the HUD chip). */
  mode: string | null;
}

interface HoverInfo {
  name: string;
  type: string;
  deg: number;
  x: number;
  y: number;
}

const SEARCH_HIGHLIGHT_CAP = 3000;

export default function CosmosView({ cosmos, graph, names, loading, onTour, focusNode, mode }: Props) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [legendOpen, setLegendOpen] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ---- family census for the legend (counts + colours stay stable)
  const census = useMemo(() => {
    const m = new Map<string, number>();
    graph?.nodes.forEach((n) => {
      const f = familyOf(n.t);
      m.set(f, (m.get(f) ?? 0) + 1);
    });
    return LEGEND_ORDER.filter((f) => m.has(f)).map((f) => ({ family: f, count: m.get(f)! }));
  }, [graph]);

  const totalVisible = useMemo(
    () => census.reduce((a, c) => a + (hidden.has(c.family) ? 0 : c.count), 0),
    [census, hidden],
  );

  // ---- search: list top hits AND spotlight every match on the map
  useEffect(() => {
    if (!cosmos || !names) return;
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) {
      cosmos.spotlight(null);
      cosmos.paint(null);
      return;
    }
    const id = window.setTimeout(() => {
      const matches = new Set<number>();
      for (let i = 0; i < names.length; i++) {
        if (names[i].toLowerCase().includes(needle)) matches.add(i);
      }
      if (matches.size === 0) {
        cosmos.spotlight(null);
        cosmos.paint(null);
        return;
      }
      cosmos.spotlight(matches);
      const paints = new Map<number, { color: typeof INK.cyan; size?: number }>();
      let k = 0;
      for (const i of matches) {
        if (++k > SEARCH_HIGHLIGHT_CAP) break;
        paints.set(i, { color: INK.cyan, size: 4.5 + Math.min(7, Math.sqrt(graph?.nodes[i].deg ?? 1) * 1.4) });
      }
      cosmos.paint(paints);
    }, 120);
    return () => window.clearTimeout(id);
  }, [cosmos, names, q, graph]);

  // ---- legend toggles -> renderer ghosts
  useEffect(() => {
    if (!cosmos) return;
    cosmos.setHiddenTypes(hidden);
  }, [cosmos, hidden]);

  // ---- zoom readout for the HUD (cheap getView poll)
  useEffect(() => {
    if (!cosmos) return;
    const id = window.setInterval(() => {
      try {
        setZoom(cosmos.currentZoom());
      } catch { /* noop */ }
    }, 600);
    return () => window.clearInterval(id);
  }, [cosmos]);

  // ---- leaving the view (tab switch) must clear highlights
  useEffect(() => {
    return () => {
      if (!cosmos) return;
      try {
        cosmos.spotlight(null);
        cosmos.paint(null);
        cosmos.setHiddenTypes(new Set());
      } catch { /* noop */ }
    };
  }, [cosmos]);

  const results = useMemo(() => {
    if (!names || q.trim().length < 2) return [];
    const needle = q.trim().toLowerCase();
    const starts: number[] = [];
    const includes: number[] = [];
    for (let i = 0; i < names.length; i++) {
      const n = names[i].toLowerCase();
      if (n.startsWith(needle)) starts.push(i);
      else if (n.includes(needle)) includes.push(i);
    }
    return [...starts, ...includes].slice(0, 8);
  }, [names, q]);

  const select = (idx: number) => {
    setSel(idx);
    setQ("");
    focusNode(idx);
  };

  const node = sel !== null && graph ? graph.nodes[sel] : null;

  const toggleFamily = (f: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  return (
    <>
      {/* HUD: counts + live zoom + actual render backend. Read-only, never blocks the canvas. */}
      <div className="hud" aria-hidden="true">
        <span className="hudnum">{graph ? graph.nodes.length.toLocaleString("en-US") : "…"}</span> nodes
        <i>·</i>
        <span className="hudnum">{graph ? graph.edges.length.toLocaleString("en-US") : "…"}</span> edges
        {zoom != null && (
          <>
            <i>·</i>
            <span className="hudnum">{zoom >= 10 ? Math.round(zoom) : zoom.toFixed(1)}×</span>
          </>
        )}
        <i>·</i>
        <span className="hudmode">{mode === "webgl2" ? "webgl2 · 3d" : "canvas2d"}</span>
      </div>

      {/* hover tooltip follows the cursor over the canvas */}
      {hover && (
        <div className="hovertip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <b>{hover.name}</b>
          <span className="tipsub">
            <i className="swatch" style={{ background: colorForType(hover.type) }} />
            {hover.type} · {hover.deg} links
          </span>
        </div>
      )}

      <div className="panel left">
        <h1>{t.cosmosTitle}</h1>
        <p className="sub">
          {fmt(t.cosmosSub, {
            n: graph ? graph.nodes.length.toLocaleString("en-US") : "…",
            m: graph ? graph.edges.length.toLocaleString("en-US") : "…",
          })}
        </p>
        {loading && <p className="loading">{loading}</p>}

        <div className="searchwrap">
          <SearchIcon size={14} />
          <input
            ref={searchRef}
            className="search bare"
            placeholder={t.searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              if (e.key === "Enter" && results.length > 0) select(results[0]);
            }}
            aria-label="Search entities"
          />
          {q && (
            <button className="ghostbtn" onClick={() => setQ("")} title={t.searchClear}>
              <XIcon size={11} />
            </button>
          )}
        </div>
        {q.trim().length >= 2 && (
          <p className="searchmeta dim">
            {results.length > 0
              ? `${countMatches(names, q)} matches — top ${results.length} below, matches lit cyan on the map`
              : "no entities match"}
          </p>
        )}
        {results.length > 0 && (
          <ul className="results">
            {results.map((i) => (
              <li key={i}>
                <button onClick={() => select(i)}>
                  <i className="swatch" style={{ background: colorForType(graph!.nodes[i].t) }} />
                  <b>{names![i]}</b> <span className="dim">{graph!.nodes[i].t}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {node && (
          <div className="nodecard">
            <div className="cardhead">
              <i className="swatch big" style={{ background: colorForType(node.t) }} />
              <h3>{node.id}</h3>
              <button className="ghostbtn" onClick={() => { setSel(null); }} title={t.inspectClose}>
                <XIcon size={11} />
              </button>
            </div>
            <p className="dim cardtype">
              {node.t} · degree {node.deg} · {node.deg === 1 ? t.degreeLinks1 : fmt(t.degreeLinksN, { n: node.deg })}
            </p>
            <p className="carddesc">{node.d ? snippet(node.d, 240) : t.noDesc}</p>
            <div className="row">
              <button onClick={() => focusNode(sel!)}>{t.flyTo}</button>
              <button
                onClick={() => {
                  setSel(null);
                  cosmos?.paint(null);
                  cosmos?.spotlight(null);
                }}
              >
                {t.clearHighlight}
              </button>
            </div>
          </div>
        )}
        {hover && !node && (
          <p className="hover">
            <CompassIcon size={12} /> {hover.name}
          </p>
        )}

        {/* type legend with visibility toggles */}
        <div className="legend">
          <button className="legendhead" onClick={() => setLegendOpen((o) => !o)}>
            <LayersIcon size={12} />
            <span>{t.legendTitle}</span>
            <span className="dim">
              {fmt(t.legendShown, { a: totalVisible.toLocaleString("en-US"), b: graph ? graph.nodes.length.toLocaleString("en-US") : "…" })}
            </span>
            <span className={`chev ${legendOpen ? "open" : ""}`} aria-hidden="true">›</span>
          </button>
          {legendOpen && (
            <div className="legendbody">
              {census.map(({ family, count }) => (
                <button
                  key={family}
                  className={hidden.has(family) ? "legrow off" : "legrow"}
                  onClick={() => toggleFamily(family)}
                  title={hidden.has(family) ? "show this family" : "hide this family"}
                >
                  <i className="swatch" style={{ background: FAMILY_COLORS[family] }} />
                  <span className="leglabel">{FAMILY_LABEL[family] ?? family}</span>
                  <span className="dim legcount">{count.toLocaleString("en-US")}</span>
                </button>
              ))}
              {hidden.size > 0 && (
                <button className="legrow reset" onClick={() => setHidden(new Set())}>{t.legendShowAll}</button>
              )}
            </div>
          )}
        </div>

        <div className="row">
          <button onClick={() => { cosmos?.fit(); setQ(""); }}>{t.resetView}</button>
          <button className="primary" onClick={onTour} disabled={!graph}>
            <SparkIcon size={12} /> {t.tourButton}
          </button>
        </div>
        <p className="hint">{t.hintOrbit}</p>
        <SelectBridge select={select} setHover={setHover} cosmos={cosmos} graph={graph} />
      </div>
    </>
  );
}

function countMatches(names: string[] | null, q: string): number {
  if (!names) return 0;
  const needle = q.trim().toLowerCase();
  let n = 0;
  for (const name of names) if (name.toLowerCase().includes(needle)) n++;
  return n;
}

function snippet(text: string, max: number): string {
  const clean = text.replace(/<SEP>/g, " · ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Wires canvas click/hover events into this panel (registered once per cosmos). */
function SelectBridge({
  cosmos,
  graph,
  select,
  setHover,
}: {
  cosmos: AnyCosmos | null;
  graph: CosmosGraph | null;
  select: (i: number) => void;
  setHover: (h: HoverInfo | null) => void;
}) {
  useEffect(() => {
    if (!cosmos || !graph) return;
    // last cursor position on the canvas — renderer hover callbacks don't carry it
    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    cosmos.onSelect = (s) => {
      if (!s) return;
      select(s.graphIdx);
      const paints = new Map<number, { color: [number, number, number, number] }>([
        [s.graphIdx, { color: [1.0, 0.85, 0.3, 1] }],
      ]);
      cosmos.paint(paints);
    };
    cosmos.onHover = (s) => {
      if (!s) {
        setHover(null);
        return;
      }
      const n = graph.nodes[s.graphIdx];
      if (!n) {
        setHover(null);
        return;
      }
      setHover({ name: n.id, type: n.t, deg: n.deg, x: mx, y: my });
    };
    return () => {
      cosmos.onSelect = null;
      cosmos.onHover = null;
      window.removeEventListener("pointermove", onMove);
      setHover(null);
    };
  }, [cosmos, graph, select, setHover]);
  return null;
}
