import { useEffect } from "react";
import { BRIDGE_DIRECT_URL } from "../lib/live";
import { SparkIcon, XIcon } from "./icons";

interface Props {
  onClose: () => void;
}

/** What-this-is card: provenance, render modes, controls. Replaces the dead
 *  external docs link — everything shown is true of this repo. */
export default function AboutModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="errwrap" role="dialog" aria-label="About Memory Travel" onClick={onClose}>
      <div className="errcard about" onClick={(e) => e.stopPropagation()}>
        <h2>
          <SparkIcon size={16} /> Memory Travel
          <button className="ghostbtn" onClick={onClose} title="close (Esc)">
            <XIcon size={13} />
          </button>
        </h2>
        <p>
          A visualiser for how machine memory remembers. Two views over ONE production index — the live HARS
          knowledge graph (47k entities, 54k relations, UMAP-projected from stored 768-dim embeddings):
        </p>
        <p>
          <b>Cosmos</b> — the whole graph as a starfield, coloured by entity family. Search spotlights matches,
          the legend toggles families, clicking a star opens its card.
        </p>
        <p>
          <b>Travel</b> — one recall, replayed stage by stage: question lands, vector hits pulse in, the graph
          walk spreads hop by hop, BM25 hits rain in, fusion merges both channels, rerank reorders, context
          assembles, and every answer fact links back to its source nodes.
        </p>
        <p className="dim">
          Data provenance: data/graph.json + coords are exported from the live index (scripts/export_graph.py,
          scripts/compute_umap.py). The five fixture traces are real memory_recall telemetry captured by
          capture_fixtures.py — nothing on screen is mocked. "ask live" runs a real recall through the memory
          bridge (context_only — the visualiser shows extractive quotes, it does not write answers).
        </p>
        <p className="dim">
          Rendering: WebGL2 starfield (Three.js) primary, automatic Canvas2D fallback on the same data pipeline.
          Keyboard: ←/→ stages, space play/pause, Esc closes cards.
        </p>
        <p className="dim">
          Live bridge: <code>{BRIDGE_DIRECT_URL}</code> — set <code>MEMORY_BRIDGE_URL</code> to point elsewhere
          (see docs/SETUP.md). The proxy exposes ONE read-only tool: <code>memory_recall</code>; nothing is written.
        </p>
        <p className="dim">Repo: ~/Project/software/memory-travel — docs/trace-api.md has the trace schema.</p>
      </div>
    </div>
  );
}
