import { useEffect, useRef } from "react";
import { Cosmos, type SelectedNode } from "../lib/cosmos";

interface Props {
  onCosmos: (c: Cosmos | null) => void;
  onSelect: (s: SelectedNode | null) => void;
  onHover: (s: SelectedNode | null) => void;
}

/** A full-bleed GraphGPU canvas. Parent drives it via the Cosmos instance. */
export default function CosmosCanvas({ onCosmos, onSelect, onHover }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectRef = useRef(onSelect);
  const hoverRef = useRef(onHover);
  selectRef.current = onSelect;
  hoverRef.current = onHover;
  const cbRef = useRef(onCosmos);
  cbRef.current = onCosmos;

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
      .catch((e) => console.error("cosmos init failed", e));
    return () => {
      dead = true;
      cbRef.current(null);
      cosmos.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
