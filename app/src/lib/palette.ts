// Entity-type colour system for Memory Travel.
//
// The index ships 44 distinct `t` strings (concept, tool, jobrun,
// wrong_episode, …). A 44-hue legend is unreadable, so types are grouped
// into 12 semantic families, each with one stable hue. Both renderers
// (WebGPU + Canvas2D fallback) and the legend consume the same two
// functions, so a colour in the legend is the colour on the canvas.

export const FAMILY_COLORS: Record<string, string> = {
  // Nord Cosmos Constellation Palette (Polar Night + Aurora Borealis):
  // Frost Ice #88C0D0, Polar Teal #8FBCBB, Glacial Blue #81A1C1, Fjord #5E81AC,
  // Aurora Sage #A3BE8C, Polar Gold #EBCB8B, Borealis Violet #B48EAD, Aurora Coral #D08770.
  docs: "#81a1c1", // Glacial Blue — documents, specs
  knowledge: "#b48ead", // Borealis Violet — concepts, findings, decisions, hypotheses
  engineering: "#88c0d0", // Frost Ice — components, tools, encoders, agents
  models: "#a988ad", // Borealis Orchid — models, backbones, adapters
  data: "#a3be8c", // Aurora Sage — datasets, artifacts, checkpoints, content
  work: "#ebcb8b", // Polar Gold — tasks, plans, pipelines, job runs
  results: "#8fbcbb", // Polar Teal — metrics, reports, analyses, tests
  experiments: "#d08770", // Aurora Coral — experiments
  config: "#7fa6b8", // Polar Mist Teal — configs, architecture, programs
  people: "#bf616a", // Aurora Crimson — people, organizations, locations
  events: "#5e81ac", // Fjord — events
  other: "#8c9ab0", // Polar Slate — everything else (incl. UNKNOWN)
};

export const FAMILY_COLORS_LIGHT: Record<string, string> = {
  // Nord Light Arctic Cosmos: deep slate/fjord/arctic stars (#2e3440, #3b4252,
  // #5e81ac, #0f6d8c, #4f7a5b, #8f5685) for crisp legibility on glacial mist.
  docs: "#5e81ac",
  knowledge: "#8f5685",
  engineering: "#0f6d8c",
  models: "#74507d",
  data: "#4f7a5b",
  work: "#9c6b1c",
  results: "#1b6e72",
  experiments: "#a6533a",
  config: "#3b4252",
  people: "#9d3d47",
  events: "#2e3440",
  other: "#4c566a",
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
