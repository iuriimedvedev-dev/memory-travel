// Entity-type colour system for Memory Travel.
//
// The index ships 44 distinct `t` strings (concept, tool, jobrun,
// wrong_episode, …). A 44-hue legend is unreadable, so types are grouped
// into 12 semantic families, each with one stable hue. Both renderers
// (WebGPU + Canvas2D fallback) and the legend consume the same two
// functions, so a colour in the legend is the colour on the canvas.

export const FAMILY_COLORS: Record<string, string> = {
  docs: "#4f8ef7", // documents, specs
  knowledge: "#8a7bef", // concepts, findings, decisions, hypotheses
  engineering: "#38c8d8", // components, tools, encoders, agents
  models: "#d95fa8", // models, backbones, adapters
  data: "#2fbf9f", // datasets, artifacts, checkpoints, content
  work: "#d9a441", // tasks, plans, pipelines, job runs
  results: "#58c470", // metrics, reports, analyses, tests
  experiments: "#e08a4a", // experiments
  config: "#a8c85f", // configs, architecture, programs
  people: "#e06a6a", // people, organizations, locations
  events: "#6a7fe0", // events
  other: "#7d8fb3", // everything else (incl. UNKNOWN)
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
  naturalsobject: "other",
};

export function familyOf(type: string): string {
  return TYPE_FAMILY[type.toLowerCase()] ?? "other";
}

export function colorForType(type: string): string {
  return FAMILY_COLORS[familyOf(type)] ?? FAMILY_COLORS.other;
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
