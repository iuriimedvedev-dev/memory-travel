// Unit tests for the pure fly-to pose math (app/src/lib/camPose.ts).
// Run: node scripts/flyto-pose.test.mjs   (exit 1 on failure)
//
// Node's type-stripping loads the .ts module directly — no bundler needed.
import {
  applyEase,
  lerp3,
  solveArrival,
} from "../app/src/lib/camPose.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const vClose = (a, b, eps = 1e-9) => a.every((v, i) => close(v, b[i], eps));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---- easing
for (const ease of ["inout", "out", "linear"]) {
  ok(close(applyEase(0, ease), 0), `${ease}: e(0)=0`);
  ok(close(applyEase(1, ease), 1), `${ease}: e(1)=1`);
  let mono = true;
  let prev = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const v = applyEase(i / 100, ease);
    if (v < prev - 1e-12) mono = false;
    if (v < -1e-12 || v > 1 + 1e-12) mono = false;
    prev = v;
  }
  ok(mono, `${ease}: monotonic and within [0,1]`);
  ok(close(applyEase(-5, ease), 0), `${ease}: clamps t<0`);
  ok(close(applyEase(5, ease), 1), `${ease}: clamps t>1`);
}

// ---- solveArrival: the arrival pose is EXACT
{
  const node = [10, -20, 3];
  const camPos = [0, 0, 100];
  const camTgt = [0, 0, 0];
  const req = 28;
  const a = solveArrival(node, camPos, camTgt, req);
  ok(vClose(a.tgt, node), "arrival: target === node (node ends dead-centre)");
  ok(close(a.dist, req), `arrival: requested distance honoured (${a.dist} === ${req})`);
  ok(close(dist(a.pos, a.tgt), req), "arrival: |camera − target| === requested distance");
  // camera sits along the current line of sight
  const dir = [camPos[0] - camTgt[0], camPos[1] - camTgt[1], camPos[2] - camTgt[2]];
  const len = Math.hypot(...dir);
  const want = node.map((v, i) => v + (dir[i] / len) * req);
  ok(vClose(a.pos, want, 1e-9), "arrival: camera = node + normalised line-of-sight × dist");
}

// ---- solveArrival: degenerate camera-on-target uses a sane default, never NaN
{
  const a = solveArrival([1, 2, 3], [1, 2, 3], [1, 2, 3], 9.5);
  ok(a.pos.every(Number.isFinite) && a.tgt.every(Number.isFinite), "degenerate: finite pose");
  ok(close(dist(a.pos, a.tgt), 9.5), "degenerate: distance still honoured");
}

// ---- solveArrival: bad distance falls back (never 0 / NaN)
{
  const a = solveArrival([0, 0, 0], [0, 0, 5], [0, 0, 0], NaN);
  ok(Number.isFinite(a.dist) && a.dist > 0, "bad dist: finite positive fallback");
}

// ---- the flight cannot overshoot and lands exactly on the pose
for (const ease of ["inout", "out", "linear"]) {
  const node = [-70.8, -13.4, -5.1];
  const camPos = [39.4, 5, 17.9];
  const camTgt = [0, 0, 0];
  const req = 30;
  const A = solveArrival(node, camPos, camTgt, req);
  const fromPos = camPos;
  const fromTgt = camTgt;
  const total = dist(fromPos, A.pos);
  const axis = [
    (A.pos[0] - fromPos[0]) / total,
    (A.pos[1] - fromPos[1]) / total,
    (A.pos[2] - fromPos[2]) / total,
  ];
  let maxAhead = -Infinity;
  let prevAhead = -Infinity;
  let backwards = false;
  let finalPos = null;
  let finalTgt = null;
  for (let i = 0; i <= 200; i++) {
    const e = applyEase(i / 200, ease);
    const p = lerp3(fromPos, A.pos, e);
    const t = lerp3(fromTgt, A.tgt, e);
    const ahead = (p[0] - fromPos[0]) * axis[0] + (p[1] - fromPos[1]) * axis[1] + (p[2] - fromPos[2]) * axis[2];
    if (ahead < prevAhead - 1e-9) backwards = true;
    prevAhead = ahead;
    maxAhead = Math.max(maxAhead, ahead);
    finalPos = p;
    finalTgt = t;
  }
  ok(!backwards, `${ease}: camera never reverses along its travel axis`);
  ok(maxAhead <= total + 1e-9, `${ease}: never travels past the arrival pose (no overshoot)`);
  ok(vClose(finalPos, A.pos), `${ease}: final camera === solved arrival`);
  ok(vClose(finalTgt, node), `${ease}: final target === node`);
  ok(close(dist(finalPos, node), req), `${ease}: final camera→node === requested distance`);
  // centered: look direction from the camera is exactly toward the node
  const look = [finalTgt[0] - finalPos[0], finalTgt[1] - finalPos[1], finalTgt[2] - finalPos[2]];
  const toNode = [node[0] - finalPos[0], node[1] - finalPos[1], node[2] - finalPos[2]];
  const par = Math.abs(
    (look[0] * toNode[0] + look[1] * toNode[1] + look[2] * toNode[2]) /
      (Math.hypot(...look) * Math.hypot(...toNode) || 1),
  );
  ok(close(par, 1, 1e-9), `${ease}: camera looks exactly at the node (dead-centre)`);
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nflyto-pose: all green");
