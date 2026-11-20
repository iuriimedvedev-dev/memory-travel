// Entity-type colour system for Memory Travel.
//
// The index ships 44 distinct `t` strings (concept, tool, jobrun,
// wrong_episode, …). A 44-hue legend is unreadable, so types are grouped
// into 12 semantic families, each with one stable hue. Both renderers
// (WebGPU + Canvas2D fallback) and the legend consume the same two
// functions, so a colour in the legend is the colour on the canvas.

export const FAMILY_COLORS: Record<string, string> = {
  // Nord Frost & Aurora semantic family hues (Polar Night dark starfield):
  // balanced saturation so AdditiveBlending glows cleanly without washing out.
  docs: "#81a1c1", // Nord Frost blue — documents, specs
  knowledge: "#b48ead", // Nord Aurora violet — concepts, findings, decisions, hypotheses
  engineering: "#88c0d0", // Nord Frost cyan — components, tools, encoders, agents
  models: "#c989ad", // Nord rose-violet — models, backbones, adapters
  data: "#a3be8c", // Nord Aurora green — datasets, artifacts, checkpoints, content
  work: "#ebcb8b", // Nord Aurora gold — tasks, plans, pipelines, job runs
  results: "#8fbcbb", // Nord Frost teal — metrics, reports, analyses, tests
  experiments: "#d08770", // Nord Aurora orange — experiments
  config: "#9db88a", // Nord sage — configs, architecture, programs
  people: "#bf616a", // Nord Aurora red — people, organizations, locations
  events: "#5e81ac", // Nord Frost deep blue — events
  other: "#9aa7b8", // Nord slate — everything else (incl. UNKNOWN)
};

export const FAMILY_COLORS_LIGHT: Record<string, string> = {
  // Engineered deeper Nord tones for Snow Storm (#E8EDF4) light mode legibility
  docs: "#3b6ea5",
  knowledge: "#825096",
  engineering: "#0f6d8c",
  models: "#984b78",
  data: "#3a7d44",
  work: "#b07612",
  results: "#2a7b78",
  experiments: "#b85638",
  config: "#52733b",
  people: "#b43e48",
  events: "#43628d",
  other: "#5b677a",
};

/** type string -> family key. Explicit for all 44 types seen in the index. */
const TYPE_FAMILY: Record<string, string> = {
  document: "docs",
  concept: "knowledge",
  hypothesis: "knowledge",
  finding: "knowledge",
  decision: "knowledge",
  component: "engineering",
  tool: "engineering",
  encoder: "engineering",
  adapter: "engineering",
  agent: "engineering",
  process: "engineering",
  model: "models",
  backbone: "models",
  data: "data",
  dataset: "data",
  artifact: "data",
  content: "data",
  checkpoint: "data",
  parameter: "data",
  task: "work",
  plan: "work",
  phase: "work",
  pipeline: "work",
  jobrun: "work",
  processrun: "work",
  monitor: "work",
  metric: "results",
  report: "results",
  analysis: "results",
  test: "results",
  risk: "results",
  experiment: "experiments",
  config: "config",
  architecture: "config",
  program: "config",
  person: "people",
  organization: "people",
  location: "people",
  event: "events",
  method: "engineering",
  other: "other",
  unknown: "other",
  wrong_episode: "other",
  naturalobject: "data",
};

export function familyOf(type: string): string {
  // "" guard: draw can run while a load() is still filling the types array
  return TYPE_FAMILY[(type ?? "").toLowerCase()] ?? "other";
}

export function colorForType(type: string, theme: "dark" | "light" = "dark"): string {
  const f = familyOf(type);
  if (theme === "light") {
    return FAMILY_COLORS_LIGHT[f] ?? FAMILY_COLORS_LIGHT.other;
  }
  return FAMILY_COLORS[f] ?? FAMILY_COLORS.other;
}

/** "#rrggbb" -> [r,g,b,a] floats 0..1 (WebGPU path). */
export function hexToRGBA(hex: string, a = 1): [number, number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

export const LEGEND_ORDER = Object.keys(FAMILY_COLORS);

/** Legend label per family (short, human). */
export const FAMILY_LABEL: Record<string, string> = {
  docs: "documents",
  knowledge: "knowledge",
  engineering: "engineering",
  models: "models",
  data: "data",
  work: "work & runs",
  results: "results & tests",
  experiments: "experiments",
  config: "config",
  people: "people & orgs",
  events: "events",
  other: "other",
};
