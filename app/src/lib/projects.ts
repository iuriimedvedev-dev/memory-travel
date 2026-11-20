// Multi-project & dialog memory scope management for KnotGate Memory.
//
// Default project ID is `"default"`, which ALWAYS displays as `"PIER KB"`.
// Supports Knowledge Bases, Personal & Dialog scopes (`user_*`, `chat_*`), and
// Department & Environment scopes (`dept_*`, `env_*`).
//
// Discovery order:
//   1. GET `${graphBase}/projects` via `fetchWithOAuth`
//   2. Automatic fallback to MCP `tools/call` `memory_list_projects` over
//      `/memory/api/memory` if `/projects` returns 404 on an older backend
//   3. Resilient fallback to `[{ id: "default", name: "PIER KB", kind: "kb" }]`

import {
  OAuthLoopGuardError,
  OAuthRedirectInProgressError,
  fetchWithOAuth,
  isOAuthRedirectInProgress,
} from "./oauth.ts";

export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_PROJECT_LABEL = "PIER KB";

export type ProjectKind = "kb" | "personal" | "dialog" | "department" | "environment";

export type ProjectCategory = "kb" | "personal_dialogs" | "departments_environments";

export interface MemoryProject {
  id: string;
  name: string;
  kind: ProjectKind;
  description?: string;
  docs?: number | null;
  nodes?: number | null;
  has_data?: boolean;
}

export interface ProjectsLoadResult {
  defaultProject: string;
  projects: MemoryProject[];
  via: "graph-stats" | "mcp" | "fallback";
}

const VALID_KINDS = new Set<ProjectKind>(["kb", "personal", "dialog", "department", "environment"]);

export function inferProjectKind(id: string, rawKind?: unknown): ProjectKind {
  if (typeof rawKind === "string" && VALID_KINDS.has(rawKind as ProjectKind)) {
    return rawKind as ProjectKind;
  }
  const clean = id.trim();
  if (clean === DEFAULT_PROJECT_ID || /^(kb[_:-]|pier)/i.test(clean)) return "kb";
  if (/^(chat[_:-]|dialog[_:-]|conv[_:-]|thread[_:-]|session[_:-])/i.test(clean)) return "dialog";
  if (/^(user[_:-]|personal[_:-]|me[_:-])/i.test(clean)) return "personal";
  if (/^(dept[_:-]|department[_:-]|team[_:-]|org[_:-]|group[_:-])/i.test(clean)) return "department";
  if (/^(env[_:-]|prod[_:-]|stag[_:-]|dev[_:-])/i.test(clean)) return "environment";
  return "kb";
}

export function normalizeProjectLabel(id: string, rawName?: unknown): string {
  const cleanId = id.trim();
  if (cleanId === DEFAULT_PROJECT_ID) {
    return DEFAULT_PROJECT_LABEL;
  }
  if (typeof rawName === "string" && rawName.trim().length > 0) {
    const trimmed = rawName.trim();
    if (trimmed.toLowerCase() !== "default") return trimmed;
  }
  return cleanId;
}

export function sanitizeProjectId(raw: string): string {
  const trimmed = raw.trim().slice(0, 128);
  return trimmed.replace(/[^\w.:@/-]/g, "");
}

function optNum(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

export function normalizeProject(raw: unknown): MemoryProject | null {
  if (typeof raw === "string") {
    const id = sanitizeProjectId(raw);
    if (!id) return null;
    return {
      id,
      name: normalizeProjectLabel(id),
      kind: inferProjectKind(id),
    };
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const rawId =
    typeof r["id"] === "string"
      ? r["id"]
      : typeof r["project"] === "string"
        ? r["project"]
        : typeof r["project_id"] === "string"
          ? r["project_id"]
          : "";
  const id = sanitizeProjectId(rawId);
  if (!id) return null;

  const docs = optNum(r["docs"] ?? r["doc_count"]);
  const nodes = optNum(r["nodes"] ?? r["node_count"] ?? r["entities"]);
  const hasData =
    typeof r["has_data"] === "boolean"
      ? r["has_data"]
      : typeof nodes === "number"
        ? nodes > 0
        : typeof docs === "number"
          ? docs > 0
          : undefined;

  return {
    id,
    name: normalizeProjectLabel(id, r["name"] ?? r["label"] ?? r["title"]),
    kind: inferProjectKind(id, r["kind"] ?? r["type"] ?? r["category"]),
    description: typeof r["description"] === "string" && r["description"].trim() ? r["description"].trim() : undefined,
    docs,
    nodes,
    has_data: hasData,
  };
}

export function defaultProjectEntry(): MemoryProject {
  return {
    id: DEFAULT_PROJECT_ID,
    name: DEFAULT_PROJECT_LABEL,
    kind: "kb",
  };
}

export function normalizeProjectsPayload(payload: unknown): {
  defaultProject: string;
  projects: MemoryProject[];
} {
  let rawList: unknown[] = [];
  let defaultProj = DEFAULT_PROJECT_ID;

  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (typeof obj["default_project"] === "string" && sanitizeProjectId(obj["default_project"])) {
      defaultProj = sanitizeProjectId(obj["default_project"]);
    }
    if (Array.isArray(obj["projects"])) {
      rawList = obj["projects"];
    } else if (Array.isArray(obj["items"])) {
      rawList = obj["items"];
    } else if (Array.isArray(obj["scopes"])) {
      rawList = obj["scopes"];
    }
  }

  const byId = new Map<string, MemoryProject>();
  for (const item of rawList) {
    const norm = normalizeProject(item);
    if (norm && !byId.has(norm.id)) {
      byId.set(norm.id, norm);
    }
  }

  if (!byId.has(DEFAULT_PROJECT_ID)) {
    const list = [defaultProjectEntry(), ...byId.values()];
    return { defaultProject: defaultProj, projects: list };
  }

  // Keep PIER KB (`default`) first among Knowledge Bases for fast 1-click access
  const def = byId.get(DEFAULT_PROJECT_ID)!;
  byId.delete(DEFAULT_PROJECT_ID);
  return {
    defaultProject: defaultProj,
    projects: [def, ...byId.values()],
  };
}

export function categoryForProject(project: Pick<MemoryProject, "id" | "kind">): ProjectCategory {
  if (project.kind === "personal" || project.kind === "dialog") {
    return "personal_dialogs";
  }
  if (project.kind === "department" || project.kind === "environment") {
    return "departments_environments";
  }
  return "kb";
}

export function groupProjectsByCategory(
  projects: MemoryProject[],
  query = "",
): Record<ProjectCategory, MemoryProject[]> {
  const q = query.trim().toLowerCase();
  const groups: Record<ProjectCategory, MemoryProject[]> = {
    kb: [],
    personal_dialogs: [],
    departments_environments: [],
  };

  for (const p of projects) {
    if (q) {
      const hay = `${p.name} ${p.id} ${p.description ?? ""} ${p.kind}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    groups[categoryForProject(p)].push(p);
  }
  return groups;
}

export function resolveActiveProject(projects: MemoryProject[], activeId: string): MemoryProject {
  const clean = sanitizeProjectId(activeId) || DEFAULT_PROJECT_ID;
  const found = projects.find((p) => p.id === clean);
  if (found) return found;
  return {
    id: clean,
    name: normalizeProjectLabel(clean),
    kind: inferProjectKind(clean),
  };
}

// ===========================================================================
// URL Sync & Same-Origin Navigation Helpers
// ===========================================================================

export function readInitialProjectFromUrl(search?: string): string {
  const rawSearch = search !== undefined ? search : typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(rawSearch);
  const rawProj = params.get("project");
  if (!rawProj) return DEFAULT_PROJECT_ID;
  const clean = sanitizeProjectId(rawProj);
  return clean || DEFAULT_PROJECT_ID;
}

export function readInitialQuestionFromUrl(search?: string): string | null {
  const rawSearch = search !== undefined ? search : typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(rawSearch);
  const q = params.get("q")?.trim() ?? "";
  return q ? q.slice(0, 500) : null;
}

/**
 * Validate `?returnTo=` strictly as a same-origin relative path (e.g. `/chat`, `/home`).
 * Rejects protocol-relative URLs (`//evil.example`), backslashes (`/\`), absolute URLs,
 * and control characters to prevent open redirects.
 */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

export function resolveSafeReturnTo(search?: string): string {
  const rawSearch = search !== undefined ? search : typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(rawSearch);
  const candidate = params.get("returnTo")?.trim() ?? "";
  if (!candidate) return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  if (hasControlChars(candidate)) return "/";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) return "/";
  return candidate;
}

export function buildProjectUrl(
  pathname: string,
  search: string,
  hash: string,
  projectId: string,
): string {
  const cleanId = sanitizeProjectId(projectId) || DEFAULT_PROJECT_ID;
  const params = new URLSearchParams(search);
  params.set("project", cleanId);
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash || ""}`;
}

export function syncProjectInUrl(projectId: string): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const nextUrl = buildProjectUrl(
    window.location.pathname,
    window.location.search,
    window.location.hash,
    projectId,
  );
  window.history.replaceState(window.history.state, "", nextUrl);
}

// ===========================================================================
// Backend Discovery: /projects -> MCP memory_list_projects fallback
// ===========================================================================

const API_BASE = (import.meta.env?.BASE_URL ?? "").replace(/\/+$/, "");

function defaultGraphBases(): string[] {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const onMemoryMount = pathname === "/memory" || pathname.startsWith("/memory/");
  const candidates = onMemoryMount
    ? ["/memory/api/graph-stats", `${API_BASE}/api/graph-stats`, "/travel/api/graph-stats", "/api/graph-stats"]
    : [`${API_BASE}/api/graph-stats`, "/memory/api/graph-stats", "/travel/api/graph-stats", "/api/graph-stats"];
  return [...new Set(candidates.filter(Boolean))];
}

function defaultBridgeUrls(): string[] {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "";
  const onMemoryMount = pathname === "/memory" || pathname.startsWith("/memory/");
  const candidates = onMemoryMount
    ? ["/memory/api/memory", `${API_BASE}/api/memory`, "/travel/api/memory", "/api/memory"]
    : [`${API_BASE}/api/memory`, "/memory/api/memory", "/travel/api/memory", "/api/memory"];
  return [...new Set(candidates.filter(Boolean))];
}

function unwrapMcpBody(body: string): unknown {
  const t = body.trim();
  if (!t) throw new Error("empty MCP body");
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  const chunks: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("data:")) {
      const d = line.slice(5).trim();
      if (d && d !== "[DONE]") chunks.push(d);
    }
  }
  if (!chunks.length) throw new Error("unrecognised MCP stream body");
  return JSON.parse(chunks.join("\n"));
}

async function fetchProjectsViaMcp(
  bridgeUrls: string[],
  oauthFetch: (input: string, init?: RequestInit) => Promise<Response>,
  signal: AbortSignal,
): Promise<{ defaultProject: string; projects: MemoryProject[] } | null> {
  const jsonHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  for (const url of bridgeUrls) {
    try {
      const initResp = await oauthFetch(url, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "knotgate-memory", version: "1.0" },
          },
        }),
        signal,
      });
      if (!initResp.ok) continue;
      const sid = initResp.headers.get("mcp-session-id");
      if (!sid) continue;
      const sessionHeaders = { ...jsonHeaders, "mcp-session-id": sid };
      try {
        await oauthFetch(url, {
          method: "POST",
          headers: sessionHeaders,
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          signal,
        });
      } catch (e) {
        if (e instanceof OAuthRedirectInProgressError || e instanceof OAuthLoopGuardError) throw e;
      }
      const callResp = await oauthFetch(url, {
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "memory_list_projects", arguments: {} },
        }),
        signal,
      });
      if (!callResp.ok) continue;
      const rpc = unwrapMcpBody(await callResp.text()) as {
        result?: { content?: { text?: string }[]; isError?: boolean };
        error?: unknown;
      };
      if (rpc.error || rpc.result?.isError) continue;
      const text = rpc.result?.content?.[0]?.text;
      if (!text) continue;
      const parsed = JSON.parse(text) as unknown;
      return normalizeProjectsPayload(parsed);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      if (
        e instanceof OAuthRedirectInProgressError ||
        e instanceof OAuthLoopGuardError ||
        isOAuthRedirectInProgress()
      ) {
        throw e;
      }
    }
  }
  return null;
}

export interface FetchProjectsOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  graphBases?: string[];
  bridgeUrls?: string[];
  oauthFetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export async function fetchMemoryProjects(opts: FetchProjectsOptions = {}): Promise<ProjectsLoadResult> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const oauthFetch = opts.oauthFetch ?? ((input: string, init?: RequestInit) => fetchWithOAuth(input, init));
  const graphBases = opts.graphBases ?? defaultGraphBases();
  const bridgeUrls = opts.bridgeUrls ?? defaultBridgeUrls();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("projects timeout", "AbortError")), timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw opts.signal.reason ?? new DOMException("cancelled", "AbortError");
    }
    opts.signal.addEventListener("abort", () => ctrl.abort(opts.signal!.reason), { once: true });
  }

  try {
    for (const base of graphBases) {
      const cleanBase = base.replace(/\/+$/, "");
      const url = `${cleanBase}/projects`;
      try {
        const resp = await oauthFetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: ctrl.signal,
        });
        if (resp.status === 404) {
          continue;
        }
        if (!resp.ok) {
          continue;
        }
        const ct = resp.headers.get("content-type") ?? "";
        if (ct.includes("text/html")) {
          continue;
        }
        const json = (await resp.json()) as unknown;
        const norm = normalizeProjectsPayload(json);
        return { ...norm, via: "graph-stats" };
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (
          e instanceof OAuthRedirectInProgressError ||
          e instanceof OAuthLoopGuardError ||
          isOAuthRedirectInProgress()
        ) {
          throw e;
        }
      }
    }

    // Automatic fallback when `/projects` returns 404 on an older trace server:
    // invoke MCP tool `memory_list_projects` over `/memory/api/memory`.
    const fromMcp = await fetchProjectsViaMcp(bridgeUrls, oauthFetch, ctrl.signal);
    if (fromMcp) {
      return { ...fromMcp, via: "mcp" };
    }

    return {
      defaultProject: DEFAULT_PROJECT_ID,
      projects: [defaultProjectEntry()],
      via: "fallback",
    };
  } finally {
    clearTimeout(timer);
  }
}
