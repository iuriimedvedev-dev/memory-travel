import { useEffect, useRef } from "react";
import { Cosmos, type SelectedNode } from "../lib/cosmos";

interface Props {
  onCosmos: (c: Cosmos | null) => void;
  onSelect: (s: SelectedNode | null) => void;
  onHover: (s: SelectedNode | null) => void;
  /** Init failures surface here (rendered as a readable overlay) — never console-only. */
  onError: (e: Error) => void;
  label: string;
}

/** A full-bleed GraphGPU canvas. Parent drives it via the Cosmos instance. */
export default function CosmosCanvas({ onCosmos, onSelect, onHover, onError, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectRef = useRef(onSelect);
  const hoverRef = useRef(onHover);
  selectRef.current = onSelect;
  hoverRef.current = onHover;
  const cbRef = useRef(onCosmos);
  cbRef.current = onCosmos;
  const errRef = useRef(onError);
  errRef.current = onError;

  useEffect(() => {
    let dead = false;
    const cosmos = new Cosmos();
    cosmos.onSelect = (s) => selectRef.current(s);
    cosmos.onHover = (s) => hoverRef.current(s);
    cosmos
      .init(canvasRef.current!)
      .then(() => {
        if (!dead) cbRef.current(cosmos);
      })
      .catch((e: unknown) => {
        const err = e instanceof Error ? e : new Error(`${label} canvas init failed: ${String(e)}`);
        console.error(`${label} canvas init failed`, err);
        if (!dead) errRef.current(err);
      });
    return () => {
      dead = true;
      cbRef.current(null);
      cosmos.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
