// Three.js (WebGL2) starfield renderer for Memory Travel — the PRIMARY
// cosmos engine. WebGPU/GraphGPU is gone (Chrome/Dawn refuses this machine's
// RADV Vulkan driver, and WebGPU is flaky across Linux boxes generally);
// WebGL2 works everywhere we tested, so THREE.Points + a custom glow shader
// is the right vehicle for 47k nodes.
//
// Rendering model (one draw call for all stars, one for all edges):
// - BufferGeometry with per-node position / color / size / alpha / twinkle
//   attributes; ShaderMaterial draws a round soft-glow sprite (radial
//   gradient in the fragment shader — never a square point), size-
//   attenuated by camera distance, AdditiveBlending so dense clusters glow
//   where they overlap. Depth cue comes from distance attenuation + a
//   subtle exponential fog term in the shader.
// - Edges are a single LineSegments cloud with per-vertex colour and a
//   per-edge `aRing` attribute: journey stages reveal BFS rings purely by
//   tweening one uniform (uRing) — no per-frame buffer uploads.
// - OrbitControls (damping) gives full 3D rotate/zoom/pan — the "вращать"
//   requirement. Journey mode temporarily disables them and drives the
//   camera itself (cameraFly / orbitAround).
// - Picking is precision screen-space: all node positions are projected
//   once per camera move (cached) and picks resolve to the nearest star
//   within a pixel radius. Equivalent to raycasting Points with a tight
//   threshold but zoom-independent and exact.
//
// The class implements the shared CosmosLike surface (lib/cosmos.ts) plus
// the Journey3D extension used by the Travel view (feature-detected).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  INK,
  WORLD_SCALE,
  type CosmosLike,
  type RGBA,
  type SelectedNode,
  type XYZ,
} from "./cosmos";
import { colorForType, familyOf, hexToRGBA } from "./palette";
import type { CosmosGraph } from "./types";

export type { SelectedNode } from "./cosmos";

const BG = 0x03040c;
/** Spotlight dim factor: non-matching stars drop to ~20% brightness. */
const SPOT_DIM = 0.18;

export interface Journey3D {
  addMarker3(label: string, p: XYZ, size: number, color: RGBA): number;
  moveMarker3(id: number, p: XYZ, size?: number): void;
  cameraFly(pos: XYZ, target: XYZ, ms: number, ease?: "out" | "inout" | "linear"): void;
  cameraSet(pos: XYZ, target: XYZ): void;
  cameraNow(): { pos: XYZ; target: XYZ };
  /** Eased flight TO A NODE: target tweens onto the node, camera ends at a
   *  comfortable viewing distance along the current line of sight. */
  flyToNode(p: XYZ, dist?: number, ms?: number): void;
  /** Instant camera placement on the surface of a sphere around `center`. */
  orbitAround(center: XYZ, dist: number, azimuth: number, elevation: number): void;
  setControlsEnabled(on: boolean): void;
  /** Per-edge BFS depth; null clears (all edges at base opacity). */
  setEdgeRings(depths: Float32Array | null): void;
  /** Continuous reveal frontier — edges with aRing <= v are lit. */
  setEdgeRingProgress(v: number): void;
  setEdgeOpacity(v: number): void;
  setContextLines(from: XYZ, tos: XYZ[], color: RGBA): void;
  clearContextLines(): void;
  /** Glowing journey trail through the given world points. */
  setTrail(points: XYZ[], color: RGBA): void;
  clearTrail(): void;
}

interface MarkerObj {
  id: number;
  label: string;
  obj: THREE.Points;
  mat: THREE.ShaderMaterial;
  size: number;
}

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aTwinkle;
  attribute float aSel;   // 1 on the selected star: size + brightness boost
  uniform float uScale;   // px-per-world at unit distance (set on resize)
  uniform float uTime;    // seconds, for the gentle twinkle
  uniform float uFog;     // fog density (depth cue)
  uniform float uFogRef;  // reference distance (fit distance)
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(0.1, -mv.z);
    // size attenuation: farther stars are smaller…
    float px = aSize * (1.0 + aSel * 1.1) * uScale / dist;
    // …and slightly dimmer (exponential fog) — subtle depth cue
    float fog = exp(-uFog * (dist - uFogRef) / max(1.0, uFogRef));
    float tw = 0.92 + 0.08 * sin(uTime * (0.6 + aTwinkle * 1.7) + aTwinkle * 40.0);
    vColor = aColor + vec3(1.0) * aSel * 0.35; // emissive push toward white
    vAlpha = aAlpha * tw * clamp(fog, 0.55, 1.0) * (1.0 + aSel * 0.9);
    gl_PointSize = clamp(px, 1.0, 90.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const POINT_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;          // 0 at centre, 1 at edge
    if (d > 1.0) discard;                 // round sprite, never a square
    float core = smoothstep(0.42, 0.0, d);   // hot centre
    float halo = smoothstep(1.0, 0.3, d);    // soft radial falloff
    // Small per-star contribution: with 47k stars the GLOW comes from
    // additive overlap in dense clusters — vivid cores wash to white if
    // each sprite contributes too much.
    float a = (core * 0.28 + halo * 0.10) * vAlpha;
    gl_FragColor = vec4(vColor * (0.72 + core * 0.55), a);
  }
`;

const EDGE_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aRing;
  uniform float uRing; // reveal frontier (1e9 = everything visible)
  varying vec3 vColor;
  varying float vRingA;
  void main() {
    vColor = aColor;
    vRingA = 1.0 - smoothstep(uRing - 0.6, uRing + 0.6, aRing);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EDGE_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vRingA;
  void main() {
    gl_FragColor = vec4(vColor, uOpacity * vRingA);
  }
`;

const LINE_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

const MARKER_VERT = POINT_VERT;

/** Minimum on-screen radius (CSS px) of the selection ring — see animateRing. */
const RING_MIN_PX = 12;
const MARKER_FRAG = /* glsl */ `
  uniform float uPulse; // seconds — beacons breathe
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(0.34, 0.0, d);
    float halo = smoothstep(1.0, 0.05, d);
    // pulsing ring: markers breathe so they read as beacons, not stars
    float pulse = 0.82 + 0.18 * sin(uPulse * 3.4);
    float a = (core * 1.1 + halo * 0.5) * vAlpha * pulse;
    gl_FragColor = vec4(vColor * (0.8 + core * 0.7), a);
  }
`;

export class Cosmos3D implements CosmosLike, Journey3D {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private ro: ResizeObserver | null = null;
  private dpr = 1;

  // graph data
  private n = 0;
  private geo: THREE.BufferGeometry | null = null;
  private points: THREE.Points | null = null;
  private ptsMat: THREE.ShaderMaterial | null = null;
  private pos: Float32Array = new Float32Array(0);
  private colAttr: THREE.BufferAttribute | null = null;
  private alphaAttr: THREE.BufferAttribute | null = null;
  private sizeAttr: THREE.BufferAttribute | null = null;
  private selAttr: THREE.BufferAttribute | null = null;
  private selIdx = -1;
  private selRing: THREE.Mesh | null = null;
  private baseSize: Float32Array = new Float32Array(0);
  private baseCol: Float32Array = new Float32Array(0);
  private types: string[] = [];
  private names: string[] = [];
  private hidden = new Set<string>();

  // edges
  private edgeGeo: THREE.BufferGeometry | null = null;
  private edges: THREE.LineSegments | null = null;
  private edgeMat: THREE.ShaderMaterial | null = null;
  private edgeCount = 0;

  // highlights
  private baseAlpha: Float32Array = new Float32Array(0);
  private spot: Set<number> | null = null;
  private paints = new Map<number, { color: RGBA; size?: number }>();

  // markers + journey lines
  private markers = new Map<number, MarkerObj>();
  private nextMarker = 1;
  private ctxLines: THREE.LineSegments | null = null;
  private trail: THREE.Line | null = null;
  private pulseRaf = 0;
  private pulseT0 = 0;

  // camera flight
  private camRaf = 0;
  private fitDist = 150;

  // picking (screen-space projection cache)
  private screen = new Float32Array(0);
  private screenDirty = true;
  private hoverRaf = 0;
  private downAt: { x: number; y: number } | null = null;

  onSelect: ((s: SelectedNode | null) => void) | null = null;
  onHover: ((s: SelectedNode | null) => void) | null = null;

  get ready(): boolean {
    return this.renderer !== null;
  }

  get linksLoaded(): number {
    return this.edgeCount;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!canvas) throw new Error("cosmos3d init failed at stage=canvas: no canvas element");
    // Probe WebGL2 FIRST so the caller can fall back to Canvas2D cleanly
    // (THREE.WebGLRenderer would otherwise throw deep inside its own code).
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2", { antialias: false });
    if (!gl) {
      throw new Error("cosmos3d init failed at stage=webgl2: WebGL2 unavailable in this browser");
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch (e) {
      throw new Error(`cosmos3d init failed at stage=construct: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.canvas = canvas;
    this.renderer = renderer;
    // SwiftShader-class software rasterizers choke on dpr≥2 at 47k additive
    // points; 1.5 keeps real-GPU sharpness while staying fast in software.
    this.dpr = Math.min(1.5, window.devicePixelRatio || 1);
    renderer.setPixelRatio(this.dpr);
    renderer.setClearColor(BG, 1);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
    this.camera.position.set(0, 90, this.fitDist);
    const controls = new OrbitControls(this.camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.autoRotate = true; // gentle cinematic drift in the cosmos view
    controls.autoRotateSpeed = 0.22;
    controls.minDistance = 2;
    controls.maxDistance = 900;
    controls.addEventListener("change", () => {
      this.screenDirty = true;
    });
    this.controls = controls;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.startPulseClock();
    this.renderer.setAnimationLoop(() => {
      // hidden canvases (tab switches, presentation's inactive canvas) skip
      // both the controls update and the render — keeps software rasterizers
      // from burning frames on an invisible view
      if (this.canvas && this.canvas.offsetParent === null) return;
      const t = (performance.now() - this.pulseT0) / 1000;
      this.animateRing(t);
      this.controls?.update();
      this.renderer?.render(this.scene, this.camera!);
    });
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";
  }

  /** Load the graph at 3D positions. Same role as the old Cosmos.load. */
  async load(
    graph: CosmosGraph,
    posByIdx: (XYZ | null)[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    if (!this.renderer) throw new Error("cosmos3d not initialised");
    const n = graph.nodes.length;
    this.n = n;
    this.names = graph.nodes.map((nd) => nd.id);
    this.types = graph.nodes.map((nd) => nd.t);
    this.pos = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const alphas = new Float32Array(n);
    const twinkle = new Float32Array(n);
    this.baseSize = new Float32Array(n);
    this.baseCol = new Float32Array(n * 3);
    this.baseAlpha = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nd = graph.nodes[i];
      const p = posByIdx[i];
      if (p) {
        this.pos[i * 3] = p[0];
        this.pos[i * 3 + 1] = p[1];
        this.pos[i * 3 + 2] = p[2];
      } else {
        // no coords: scatter on a sparse shell so unpositioned nodes never
        // pile into a fake clump at the origin
        const r = WORLD_SCALE * (1.15 + Math.random() * 0.3);
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        this.pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        this.pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
        this.pos[i * 3 + 2] = r * Math.cos(ph) * 0.6;
      }
      // colour IS the entity family (legend parity)
      const c = hexToRGBA(colorForType(nd.t));
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
      // hubs slightly larger: degree -> world size (tuned so regular stars
      // are ~2px at fit distance, hubs ~10px)
      const s = 0.16 + Math.min(0.7, Math.sqrt(nd.deg) * 0.075);
      sizes[i] = s;
      alphas[i] = 1;
      twinkle[i] = Math.random();
      this.baseSize[i] = s;
      this.baseCol[i * 3] = c[0];
      this.baseCol[i * 3 + 1] = c[1];
      this.baseCol[i * 3 + 2] = c[2];
      this.baseAlpha[i] = 1;
      if (onProgress && i % 8000 === 0) {
        onProgress(i, n);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(n, n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.colAttr = new THREE.BufferAttribute(colors, 3);
    this.sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this.alphaAttr = new THREE.BufferAttribute(alphas, 1);
    geo.setAttribute("aColor", this.colAttr);
    geo.setAttribute("aSize", this.sizeAttr);
    geo.setAttribute("aAlpha", this.alphaAttr);
    geo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkle, 1));
    geo.setAttribute("aSel", this.selAttr = new THREE.BufferAttribute(new Float32Array(n), 1));
    this.geo = geo;
    this.ptsMat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: {
        uScale: { value: this.pointScale() },
        uTime: { value: 0 },
        uFog: { value: 0.4 },
        uFogRef: { value: this.fitDist },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.ptsMat);
    this.points.frustumCulled = false; // all 47k visible, skip the bounds check
    this.scene.add(this.points);

    // edges: one LineSegments cloud, per-vertex dim colour, ring attribute
    // for the journey BFS reveal.
    const edges = graph.edges.filter(([s, t]) => s >= 0 && t >= 0 && s < n && t < n);
    this.edgeCount = edges.length;
    if (edges.length) {
      const ep = new Float32Array(edges.length * 6);
      const ec = new Float32Array(edges.length * 6);
      const er = new Float32Array(edges.length * 2);
      for (let k = 0; k < edges.length; k++) {
        const [s, t] = edges[k];
        for (let c = 0; c < 3; c++) {
          ep[k * 6 + c] = this.pos[s * 3 + c];
          ep[k * 6 + 3 + c] = this.pos[t * 3 + c];
          // dim desaturated blue, halfway to the node colours
          ec[k * 6 + c] = 0.24 + 0.35 * this.baseCol[s * 3 + c];
          ec[k * 6 + 3 + c] = 0.24 + 0.35 * this.baseCol[t * 3 + c];
        }
        er[k * 2] = 1e9;
        er[k * 2 + 1] = 1e9;
      }
      const eg = new THREE.BufferGeometry();
      eg.setAttribute("position", new THREE.BufferAttribute(ep, 3));
      eg.setAttribute("aColor", new THREE.BufferAttribute(ec, 3));
      eg.setAttribute("aRing", new THREE.BufferAttribute(er, 1));
      this.edgeGeo = eg;
      this.edgeMat = new THREE.ShaderMaterial({
        vertexShader: EDGE_VERT,
        fragmentShader: EDGE_FRAG,
        uniforms: { uOpacity: { value: 0.028 }, uRing: { value: 1e9 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.edges = new THREE.LineSegments(eg, this.edgeMat);
      this.edges.frustumCulled = false;
      this.scene.add(this.edges);
    }

    this.paints.clear();
    this.spot = null;
    this.screenDirty = true;
    // debug/verification handle: only a renderer with DATA loaded claims it
    // (two CosmosCanvas instances exist; the hidden one never loads)
    (window as unknown as { __cosmos3d?: Cosmos3D }).__cosmos3d = this;
    this.fit(0.12);
  }

  clear(): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.geo?.dispose();
      this.ptsMat?.dispose();
    }
    if (this.edges) {
      this.scene.remove(this.edges);
      this.edgeGeo?.dispose();
      this.edgeMat?.dispose();
    }
    this.geo = this.points = null;
    this.edges = this.edgeGeo = this.edgeMat = null;
    this.ptsMat = null;
    this.selAttr = null;
    if (this.selRing) {
      this.scene.remove(this.selRing);
      this.selRing.geometry.dispose();
      (this.selRing.material as THREE.Material).dispose();
      this.selRing = null;
    }
    this.selIdx = -1;
    this.n = 0;
    this.pos = new Float32Array(0);
    this.screen = new Float32Array(0);
    this.types = [];
    this.names = [];
    this.edgeCount = 0;
    this.paints.clear();
    this.spot = null;
    this.clearMarkers();
    this.clearContextLines();
    this.clearTrail();
  }

  setHiddenTypes(types: Set<string>): void {
    this.hidden = types;
    this.recomputeAlphas();
  }

  addMarker(label: string, x: number, y: number, size: number, color: RGBA): number {
    return this.addMarker3(label, [x, y, 0], size, color);
  }

  addMarker3(label: string, p: XYZ, size: number, color: RGBA): number {
    if (!this.renderer) throw new Error("cosmos3d not initialised");
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p), 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array([color[0], color[1], color[2]]), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array([size]), 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array([1]), 1));
    g.setAttribute("aTwinkle", new THREE.BufferAttribute(new Float32Array([0]), 1));
    g.setAttribute("aSel", new THREE.BufferAttribute(new Float32Array([0]), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: MARKER_VERT,
      fragmentShader: MARKER_FRAG,
      uniforms: {
        uScale: { value: this.pointScale() },
        uTime: { value: 0 },
        uFog: { value: 0 },
        uFogRef: { value: this.fitDist },
        uPulse: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const obj = new THREE.Points(g, mat);
    obj.frustumCulled = false;
    this.scene.add(obj);
    const id = this.nextMarker++;
    this.markers.set(id, { id, label, obj, mat, size });
    return id;
  }

  moveMarker(id: number, x: number, y: number, size?: number): void {
    this.moveMarker3(id, [x, y, 0], size);
  }

  moveMarker3(id: number, p: XYZ, size?: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    const attr = m.obj.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.setXYZ(0, p[0], p[1], p[2]);
    attr.needsUpdate = true;
    if (size !== undefined) {
      const sa = m.obj.geometry.getAttribute("aSize") as THREE.BufferAttribute;
      sa.setX(0, size);
      sa.needsUpdate = true;
      m.size = size;
    }
  }

  removeMarker(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.scene.remove(m.obj);
    m.obj.geometry.dispose();
    m.mat.dispose();
    this.markers.delete(id);
  }

  private clearMarkers(): void {
    for (const id of [...this.markers.keys()]) this.removeMarker(id);
  }

  paint(paints: Map<number, { color: RGBA; size?: number }> | null): void {
    if (!this.colAttr || !this.sizeAttr || !this.n) return;
    if (paints === null) this.paints.clear();
    else for (const [idx, p] of paints) this.paints.set(idx, p);
    this.recomputeAlphas();
    this.recomputeColorsSizes();
  }

  spotlight(keep: Set<number> | null): void {
    this.spot = keep;
    this.recomputeAlphas();
  }

  setEdgeOpacity(v: number): void {
    if (this.edgeMat) this.edgeMat.uniforms.uOpacity.value = v;
  }

  // ---- Journey3D ----

  setEdgeRings(depths: Float32Array | null): void {
    if (!this.edgeGeo) return;
    const attr = this.edgeGeo.getAttribute("aRing") as THREE.BufferAttribute;
    if (!depths) {
      (attr.array as Float32Array).fill(1e9);
    } else {
      (attr.array as Float32Array).set(depths);
    }
    attr.needsUpdate = true;
  }

  setEdgeRingProgress(v: number): void {
    if (this.edgeMat) this.edgeMat.uniforms.uRing.value = v;
  }

  setContextLines(from: XYZ, tos: XYZ[], color: RGBA): void {
    this.clearContextLines();
    if (!tos.length) return;
    const pos = new Float32Array(tos.length * 6);
    const col = new Float32Array(tos.length * 6);
    const al = new Float32Array(tos.length * 2);
    tos.forEach((t, i) => {
      pos.set([from[0], from[1], from[2], t[0], t[1], t[2]], i * 6);
      col.set([color[0], color[1], color[2], color[0], color[1], color[2]], i * 6);
      al[i * 2] = 0.85;
      al[i * 2 + 1] = 0.35;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(al, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ctxLines = new THREE.LineSegments(g, mat);
    this.ctxLines.frustumCulled = false;
    this.scene.add(this.ctxLines);
  }

  clearContextLines(): void {
    if (!this.ctxLines) return;
    this.scene.remove(this.ctxLines);
    this.ctxLines.geometry.dispose();
    (this.ctxLines.material as THREE.Material).dispose();
    this.ctxLines = null;
  }

  setTrail(points: XYZ[], color: RGBA): void {
    this.clearTrail();
    if (points.length < 2) return;
    const pos = new Float32Array(points.length * 3);
    points.forEach((p, i) => pos.set(p, i * 3));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(color[0], color[1], color[2]),
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.trail = new THREE.Line(g, mat);
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
  }

  clearTrail(): void {
    if (!this.trail) return;
    this.scene.remove(this.trail);
    this.trail.geometry.dispose();
    (this.trail.material as THREE.Material).dispose();
    this.trail = null;
  }

  setControlsEnabled(on: boolean): void {
    if (this.controls) this.controls.enabled = on;
  }

  /**
   * Star selection treatment: brightness/size boost on the star (aSel
   * attribute) + a thin animated billboard ring around it. Monochrome
   * (single accent colour), matches the icon language.
   */
  setSelection(idx: number | null): void {
    if (!this.selAttr || !this.geo) return;
    const arr = this.selAttr.array as Float32Array;
    if (this.selIdx >= 0 && this.selIdx < this.n) arr[this.selIdx] = 0;
    this.selIdx = idx ?? -1;
    if (this.selIdx >= 0 && this.selIdx < this.n) {
      arr[this.selIdx] = 1;
      this.selAttr.needsUpdate = true;
      this.ensureRing();
      const ring = this.selRing!;
      // radius is screen-space sized per frame in animateRing(); just place it
      ring.scale.setScalar(1);
      ring.position.set(this.pos[this.selIdx * 3], this.pos[this.selIdx * 3 + 1], this.pos[this.selIdx * 3 + 2]);
      ring.visible = true;
    } else {
      this.selAttr.needsUpdate = true;
      if (this.selRing) this.selRing.visible = false;
    }
  }

  /** Project a node to CSS px (for the screen-space selection tooltip). */
  projectNode(idx: number): { x: number; y: number; visible: boolean } | null {
    if (!this.camera || !this.canvas || idx < 0 || idx >= this.n) return null;
    this.projectAll();
    return {
      x: this.screen[idx * 2],
      y: this.screen[idx * 2 + 1],
      visible: this.screen[idx * 2] > -50 && this.screen[idx * 2] < (this.canvas.clientWidth || 1) + 50,
    };
  }

  private ensureRing(): void {
    if (this.selRing || !this.renderer) return;
    // thin judged-on-screen annulus: thickness is a fraction of the radius
    const g = new THREE.RingGeometry(0.8, 1.0, 64);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.49, 0.95, 1.0),
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const ring = new THREE.Mesh(g, m);
    ring.visible = false;
    ring.frustumCulled = false;
    ring.renderOrder = 4; // over the starfield, under the HTML tooltip
    this.scene.add(ring);
    this.selRing = ring;
  }

  /**
   * Animate the selection ring: billboard to camera, slow spin, subtle breathe.
   * Sized in SCREEN px (a fixed world radius is sub-pixel on a zoomed-out view —
   * the star sprite is only a few px there, so the ring would never be seen):
   * radius hugs the sprite but never drops below RING_MIN_PX.
   */
  private animateRing(t: number): void {
    if (!this.selRing || !this.selRing.visible || this.selIdx < 0 || !this.ptsMat) return;
    const r = this.selRing;
    r.quaternion.copy(this.camera!.quaternion);
    const size = (this.geo!.getAttribute("aSize") as THREE.BufferAttribute).getX(this.selIdx);
    // the vertex shader boosts the selected sprite: aSize * (1 + aSel*1.1)
    const uScale = this.ptsMat.uniforms.uScale.value as number;
    const dist = Math.max(0.1, this.camera!.position.distanceTo(r.position));
    const spritePx = (size * 2.1 * uScale) / dist;
    // hug the star sprite (the shader clamps sprites at 90 device px, so the
    // nominal size can overshoot) but never below RING_MIN_PX
    const targetPx = Math.max(RING_MIN_PX * this.dpr, Math.min(spritePx, 90) * 0.62) * (1 + 0.05 * Math.sin(t * 2.6));
    r.scale.setScalar((targetPx * dist) / uScale);
    r.rotateZ(t * 0.6);
    (r.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.2 * Math.sin(t * 2.6);
  }

  cameraNow(): { pos: XYZ; target: XYZ } {
    const c = this.camera!;
    const t = this.controls?.target ?? new THREE.Vector3();
    return {
      pos: [c.position.x, c.position.y, c.position.z],
      target: [t.x, t.y, t.z],
    };
  }

  cameraSet(pos: XYZ, target: XYZ): void {
    this.stopCamRaf();
    this.camera!.position.set(pos[0], pos[1], pos[2]);
    if (this.controls) {
      this.controls.target.set(target[0], target[1], target[2]);
      this.controls.update();
    } else {
      this.camera!.lookAt(target[0], target[1], target[2]);
    }
    this.screenDirty = true;
  }

  cameraFly(pos: XYZ, target: XYZ, ms = 1400, ease: "out" | "inout" | "linear" = "inout"): void {
    if (!this.camera) return;
    this.stopCamRaf();
    const controls = this.controls;
    const auto = controls?.autoRotate ?? false;
    if (controls) {
      controls.autoRotate = false;
      controls.enabled = false; // no damping/autoRotate fighting the tween
    }
    const from = this.camera.position.clone();
    const fromT = controls ? controls.target.clone() : new THREE.Vector3();
    const to = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const toT = new THREE.Vector3(target[0], target[1], target[2]);
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e =
        ease === "out" ? 1 - Math.pow(1 - p, 3) : ease === "linear" ? p : easeInOut(p);
      this.camera!.position.lerpVectors(from, to, e);
      if (controls) {
        controls.target.lerpVectors(fromT, toT, e);
        controls.update(); // keep OrbitControls' internal state synced each frame
      } else {
        this.camera!.lookAt(toT);
      }
      this.screenDirty = true;
      if (p < 1) {
        this.camRaf = requestAnimationFrame(step);
      } else if (controls) {
        controls.enabled = true;
        controls.autoRotate = auto;
      }
    };
    this.camRaf = requestAnimationFrame(step);
  }

  /**
   * Eased flight TO A NODE. controls.target tweens onto the node's world
   * position and the camera ends `dist` units away along the current line
   * of sight — the node lands exactly centred on screen. This is the only
   * correct way to focus a node in 3D: the 2D-style flyTo(x, y, zoom) aims
   * at (x, y, 0), dropping the node's (flattened) z, so the camera flew
   * "куда-то" and left OrbitControls orbiting the wrong point.
   */
  flyToNode(p: XYZ, dist = 9.5, ms = 850): void {
    if (!this.camera || !this.controls) return;
    this.stopCamRaf();
    const controls = this.controls;
    const auto = controls.autoRotate;
    controls.autoRotate = false;
    controls.enabled = false; // no fighting during the tween
    const fromPos = this.camera.position.clone();
    const fromTgt = controls.target.clone();
    // arrive along the current line of sight (a dive-in, not a cut)
    const dir = fromPos.clone().sub(fromTgt);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0.35, 1);
    dir.normalize().multiplyScalar(dist);
    const toTgt = new THREE.Vector3(p[0], p[1], p[2]);
    const toPos = toTgt.clone().add(dir);
    const t0 = performance.now();
    const step = (t: number) => {
      const q = Math.min(1, (t - t0) / ms);
      const e = easeInOut(q);
      this.camera!.position.lerpVectors(fromPos, toPos, e);
      controls.target.lerpVectors(fromTgt, toTgt, e);
      controls.update(); // sync OrbitControls' internal state every frame
      this.screenDirty = true;
      if (q < 1) {
        this.camRaf = requestAnimationFrame(step);
      } else {
        controls.enabled = true;
        controls.autoRotate = auto; // orbiting now circles THE NODE
      }
    };
    this.camRaf = requestAnimationFrame(step);
  }

  orbitAround(center: XYZ, dist: number, azimuth: number, elevation: number): void {
    if (!this.camera) return;
    const ce = Math.cos(elevation);
    this.camera.position.set(
      center[0] + dist * ce * Math.sin(azimuth),
      center[1] + dist * Math.sin(elevation),
      center[2] + dist * ce * Math.cos(azimuth),
    );
    if (this.controls) {
      this.controls.target.set(center[0], center[1], center[2]);
      this.controls.update();
    } else {
      this.camera.lookAt(center[0], center[1], center[2]);
    }
    this.screenDirty = true;
  }

  /** 2D-compat flight: hover the camera above (x, y, 0) at the zoom-implied distance. */
  flyTo(x: number, y: number, zoom: number, ms = 1400): void {
    const dist = this.distForZoom(zoom);
    this.cameraFly([x, y, dist], [x, y, 0], ms, "inout");
  }

  fit(padding = 0.12): void {
    if (!this.n || !this.camera) return;
    // bounding sphere over all stars
    const sphere = new THREE.Sphere();
    new THREE.Box3().setFromBufferAttribute(
      new THREE.BufferAttribute(this.pos, 3),
    ).getBoundingSphere(sphere);
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (sphere.radius / Math.sin(fov / 2)) * (1 + padding) + sphere.radius * 0.1;
    this.fitDist = Math.max(2, dist);
    if (this.ptsMat) {
      this.ptsMat.uniforms.uFogRef.value = this.fitDist;
    }
    this.cameraSet([0, this.fitDist * 0.42, this.fitDist], [0, 0, 0]);
  }

  /** Camera distance that yields `zoom` (CSS px per world unit at the target). */
  private distForZoom(zoom: number): number {
    const h = this.canvas?.clientHeight || 600;
    const tanFov = Math.tan(((this.camera?.fov ?? 55) * Math.PI) / 180 / 2);
    return Math.max(1.5, h / (2 * Math.max(1e-4, zoom) * tanFov));
  }

  currentZoom(): number {
    if (!this.camera) return 1;
    const d = this.camera.position.distanceTo(this.controls?.target ?? new THREE.Vector3());
    const h = this.canvas?.clientHeight || 600;
    const tanFov = Math.tan(((this.camera?.fov ?? 55) * Math.PI) / 180 / 2);
    return h / (2 * Math.max(0.5, d) * tanFov);
  }

  destroy(): void {
    this.stopCamRaf();
    cancelAnimationFrame(this.hoverRaf);
    cancelAnimationFrame(this.pulseRaf);
    this.renderer?.setAnimationLoop(null);
    this.ro?.disconnect();
    this.ro = null;
    if (this.canvas) {
      this.canvas.removeEventListener("pointermove", this.onMove);
      this.canvas.removeEventListener("click", this.onClick);
      this.canvas.removeEventListener("pointerdown", this.onDown);
    }
    this.clearMarkers();
    this.clearContextLines();
    this.clearTrail();
    if (this.selRing) {
      this.scene.remove(this.selRing);
      this.selRing.geometry.dispose();
      (this.selRing.material as THREE.Material).dispose();
      this.selRing = null;
    }
    this.controls?.dispose();
    this.controls = null;
    this.geo?.dispose();
    this.ptsMat?.dispose();
    this.edgeGeo?.dispose();
    this.edgeMat?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas = null;
    this.camera = null;
  }

  // ---- internals ----

  private stopCamRaf(): void {
    cancelAnimationFrame(this.camRaf);
    this.camRaf = 0;
  }

  private pointScale(): number {
    const h = (this.canvas?.clientHeight || 600) * this.dpr;
    const fov = (this.camera?.fov ?? 55) * (Math.PI / 180);
    return h / (2 * Math.tan(fov / 2));
  }

  private resize(): void {
    const c = this.canvas;
    if (!c || !this.renderer || !this.camera) return;
    const w = c.clientWidth || 1;
    const h = c.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const s = this.pointScale();
    if (this.ptsMat) this.ptsMat.uniforms.uScale.value = s;
    for (const m of this.markers.values()) m.mat.uniforms.uScale.value = s;
  }

  /** Gentle clock driving twinkle + marker pulse (one uniform write per frame). */
  private startPulseClock(): void {
    this.pulseT0 = performance.now();
    const tick = (now: number) => {
      const t = (now - this.pulseT0) / 1000;
      if (this.ptsMat) this.ptsMat.uniforms.uTime.value = t;
      for (const m of this.markers.values()) m.mat.uniforms.uPulse.value = t;
      this.pulseRaf = requestAnimationFrame(tick);
    };
    this.pulseRaf = requestAnimationFrame(tick);
  }

  /** Alpha buffer from hidden families + spotlight + explicit paints. */
  private recomputeAlphas(): void {
    if (!this.alphaAttr || !this.n) return;
    const arr = this.alphaAttr.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      let a = 1;
      if (this.hidden.has(familyOf(this.types[i]))) a = 0.07;
      if (this.spot && !this.spot.has(i)) a = Math.min(a, SPOT_DIM);
      const p = this.paints.get(i);
      if (p) a = 1; // explicit highlights win over dim/ghost
      arr[i] = a;
    }
    this.alphaAttr.needsUpdate = true;
  }

  private recomputeColorsSizes(): void {
    if (!this.colAttr || !this.sizeAttr || !this.n) return;
    const col = this.colAttr.array as Float32Array;
    const siz = this.sizeAttr.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      col[i * 3] = this.baseCol[i * 3];
      col[i * 3 + 1] = this.baseCol[i * 3 + 1];
      col[i * 3 + 2] = this.baseCol[i * 3 + 2];
      siz[i] = this.baseSize[i];
    }
    for (const [idx, p] of this.paints) {
      if (idx < 0 || idx >= this.n) continue;
      col[idx * 3] = p.color[0];
      col[idx * 3 + 1] = p.color[1];
      col[idx * 3 + 2] = p.color[2];
      siz[idx] = p.size ?? this.baseSize[idx] * 2.2;
    }
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  // ---- picking (precision screen-space) ----

  private projectAll(): void {
    if (!this.screenDirty || !this.camera || !this.canvas || this.n === 0) return;
    if (this.screen.length !== this.n * 2) this.screen = new Float32Array(this.n * 2);
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      v.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      v.project(this.camera);
      this.screen[i * 2] = (v.x * 0.5 + 0.5) * w;
      this.screen[i * 2 + 1] = (-v.y * 0.5 + 0.5) * h;
    }
    this.screenDirty = false;
  }

  private pick(clientX: number, clientY: number): number | null {
    if (this.n === 0 || !this.canvas) return null;
    this.projectAll();
    const rect = this.canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    // pick radius in screen px (positions are already projected)
    const R = 9;
    let best = -1;
    let bestD = R * R;
    for (let i = 0; i < this.n; i++) {
      if (this.hidden.has(familyOf(this.types[i]))) continue;
      const dx = this.screen[i * 2] - mx;
      const dy = this.screen[i * 2 + 1] - my;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  }

  private onMove = (e: PointerEvent) => {
    if (!this.onHover || this.hoverRaf) return;
    const cx = e.clientX;
    const cy = e.clientY;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const idx = this.pick(cx, cy);
      this.onHover?.(idx === null ? null : this.selOf(idx));
    });
  };

  private onDown = (e: PointerEvent) => {
    // Remember where the gesture started: a click that ends a drag must NOT
    // select (the 2D fallback had the same guard — without it every orbit
    // drag ended with a bogus "click" that flew the camera somewhere else).
    this.downAt = { x: e.clientX, y: e.clientY };
    // a user grab always wins over any in-flight camera tween
    if (this.camRaf) {
      this.stopCamRaf();
      if (this.controls) {
        this.controls.enabled = true;
        this.controls.update();
      }
    }
  };

  private onClick = (e: MouseEvent) => {
    if (!this.onSelect) return;
    // ignore clicks that are really the end of an orbit/zoom drag
    if (this.downAt) {
      const dx = e.clientX - this.downAt.x;
      const dy = e.clientY - this.downAt.y;
      if (dx * dx + dy * dy > 36) return;
    }
    const idx = this.pick(e.clientX, e.clientY);
    // empty space deselects; a star selects
    this.onSelect(idx === null ? null : this.selOf(idx));
  };

  private selOf(idx: number): SelectedNode {
    return { gpuId: idx, graphIdx: idx, name: this.names[idx] ?? `#${idx}` };
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Does this renderer support the 3D journey extensions? */
export function asJourney3D(c: unknown): (Journey3D & CosmosLike) | null {
  return c instanceof Cosmos3D ? (c as unknown as Journey3D & CosmosLike) : null;
}

// re-export so existing imports keep working
export { INK };
