// Per-stage camera keyframes for the 3D journey.
// Each stage gets {pos, target} in world coords; animated playback eases
// between keyframes, scrubbing jumps. Distances tuned against the ~±95-unit
// world span (WORLD_SCALE 90, z flattened 0.55).
import type { XYZ } from "./cosmos";

export interface CamKey {
  pos: XYZ;
  target: XYZ;
}

export interface StageCamCtx {
  query: XYZ | null;
  vecCluster: XYZ | null;
  seeds: XYZ | null;
  bm25: XYZ | null;
  scene: XYZ | null; // centroid of everything visited (pullback target)
}

const offset = (t: XYZ, d: number, up = 0.42): XYZ => [t[0] + d * 0.18, t[1] + d * up, t[2] + d * 0.94];

export function stageCamera(stage: number, ctx: StageCamCtx): CamKey {
  const q = ctx.query ?? ctx.scene ?? [0, 0, 0];
  const cl = (c: XYZ | null, fallback: XYZ, d: number): CamKey => {
    const t = c ?? fallback;
    return { pos: offset(t, d), target: t };
  };
  switch (stage) {
    case 0:
      return cl(null, q, 30);
    case 1:
      return cl(ctx.vecCluster, q, 44);
    case 2:
      return cl(ctx.seeds, q, 58);
    case 3:
      return cl(ctx.bm25, q, 46);
    case 4:
      return cl(ctx.vecCluster, q, 52);
    case 5:
      return cl(ctx.vecCluster, q, 40);
    case 6:
      return cl(null, q, 34);
    default:
      // answer: pull back to frame the whole journey
      return cl(null, ctx.scene ?? q, 118);
  }
}
