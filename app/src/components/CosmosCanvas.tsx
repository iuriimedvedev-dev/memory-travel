import { useEffect, useRef } from "react";
import { Cosmos, type SelectedNode } from "../lib/cosmos";
import { Cosmos2D, type AnyCosmos } from "../lib/cosmos2d";

export type RenderMode = "webgpu" | "canvas2d";

interface Props {
  onCosmos: (c: AnyCosmos | null) => void;
  onSelect: (s: SelectedNode | null) => void;
  onHover: (s: SelectedNode | null) => void;
  /** Init failures surface here (rendered as a readable overlay) — never console-only. */
  onError: (e: Error) => void;
  /** Reports which backend actually initialised (WebGPU primary, 2D fallback). */
  onMode?: (m: RenderMode) => void;
  label: string;
}

/**
 * A full-bleed graph canvas with automatic graceful degradation: WebGPU
 * (GraphGPU) stays primary; when navigator.gpu is missing or init fails,
 * the same canvas falls back to the Canvas2D renderer. onError fires only
 * when NEITHER backend works (ancient browser — nearly unreachable).
 */
export default function CosmosCanvas({ onCosmos, onSelect, onHover, onError, onMode, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectRef = useRef(onSelect);
  const hoverRef = useRef(onHover);
  selectRef.current = onSelect;
  hoverRef.current = onHover;
  const cbRef = useRef(onCosmos);
  cbRef.current = onCosmos;
  const errRef = useRef(onError);
  errRef.current = onError;
  const modeRef = useRef(onMode);
  modeRef.current = onMode;

  useEffect(() => {
    let dead = false;
    let renderer: AnyCosmos | null = null;
    const wire = (r: AnyCosmos) => {
      renderer = r;
      r.onSelect = (s) => selectRef.current(s);
      r.onHover = (s) => hoverRef.current(s);
    };
    (async () => {
      const canvas = canvasRef.current!;
      // Primary: WebGPU.
      const webgpu = new Cosmos();
      try {
        wire(webgpu);
        await webgpu.init(canvas);
        if (!dead) {
          modeRef.current?.("webgpu");
          cbRef.current(webgpu);
        }
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`${label} WebGPU path failed, trying Canvas2D fallback: ${msg}`);
        try {
          webgpu.destroy();
        } catch { /* noop */ }
      }
      // Fallback: Canvas2D on the same canvas.
      const fallback = new Cosmos2D();
      try {
        wire(fallback);
        await fallback.init(canvas);
        if (!dead) {
          modeRef.current?.("canvas2d");
          cbRef.current(fallback);
        } else {
          fallback.destroy();
        }
      } catch (e2: unknown) {
        const err =
          e2 instanceof Error ? e2 : new Error(`${label} canvas init failed: ${String(e2)}`);
        console.error(`${label} canvas init failed (WebGPU + 2D)`, err);
        if (!dead) errRef.current(err);
      }
    })();
    return () => {
      dead = true;
      cbRef.current(null);
      try {
        renderer?.destroy();
      } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
