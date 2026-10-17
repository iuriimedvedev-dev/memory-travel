// Pure camera-pose math for fly-to flights. No three.js import so it can be
// unit-tested directly (node scripts/flyto-pose.test.mjs).
//
// A "fly to a node" is fully described by its ARRIVAL POSE:
//   target = the node            (so the node ends dead-centre and
//                                 OrbitControls then orbits the node)
//   camera = node + dir * dist   (dir = current line of sight, normalised)
// Both endpoints are solved ONCE, then position and target are interpolated
// with the same single eased 0→1 parameter. That is overshoot-free by
// construction: the eased parameter is monotonic in [0,1], so the camera path
// is a straight segment that stops exactly on the arrival pose and never
// travels past it.

export type Vec3 = [number, number, number];

export type CamEase = "out" | "inout" | "linear";

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function applyEase(t: number, ease: CamEase): number {
  const c = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return ease === "out" ? easeOutCubic(c) : ease === "inout" ? easeInOutCubic(c) : c;
}

export function lerp3(a: Vec3, b: Vec3, e: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
}

export interface ArrivalPose {
  /** camera position at t=1 */
  pos: Vec3;
  /** controls.target at t=1 — exactly the node */
  tgt: Vec3;
  /** |pos − tgt| — the honoured flight distance */
  dist: number;
}

/**
 * Solve the arrival pose for a fly-to-node.
 *
 * `dir` is the direction the camera sits relative to its target — i.e. the
 * current line of sight — so the flight is a dive along the existing view
 * rather than a cut. When the camera is (numerically) on its target, a
 * sensible up-ish default is used instead of dividing by ~0.
 */
export function solveArrival(node: Vec3, camPos: Vec3, camTarget: Vec3, dist: number): ArrivalPose {
  let dx = camPos[0] - camTarget[0];
  let dy = camPos[1] - camTarget[1];
  let dz = camPos[2] - camTarget[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4 || !Number.isFinite(len)) {
    dx = 0;
    dy = 0.35;
    dz = 1;
    const dl = Math.hypot(dx, dy, dz);
    dx /= dl;
    dy /= dl;
    dz /= dl;
  } else {
    dx /= len;
    dy /= len;
    dz /= len;
  }
  const d = dist > 0 && Number.isFinite(dist) ? dist : 9.5;
  return {
    pos: [node[0] + dx * d, node[1] + dy * d, node[2] + dz * d],
    tgt: [node[0], node[1], node[2]],
    dist: d,
  };
}
