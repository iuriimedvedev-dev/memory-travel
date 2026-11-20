// Unit tests for KnotGate Memory multi-project scopes, OAuth fetch wrapper,
// end-to-end project parameter wiring, empty scope handling, and theme sync.
// Run: node scripts/knotgate-projects-theme.test.mjs

import { fetchWithOAuth } from "../app/src/lib/oauth.ts";
import {
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_LABEL,
  buildProjectUrl,
  categoryForProject,
  fetchMemoryProjects,
  groupProjectsByCategory,
  normalizeProject,
  normalizeProjectsPayload,
  readInitialProjectFromUrl,
  readInitialQuestionFromUrl,
  resolveSafeReturnTo,
} from "../app/src/lib/projects.ts";
import { graphBases, loadLiveCosmos, probeGraphStats } from "../app/src/lib/cosmosSource.ts";
import { bridgeEndpoints, bridgeUrls, memoryRecallLive, memoryStatusLive, streamRecallTrace, traceBases } from "../app/src/lib/live.ts";
import { FAMILY_COLORS, FAMILY_COLORS_LIGHT, colorForType } from "../app/src/lib/palette.ts";
import { INK } from "../app/src/lib/cosmos.ts";
import {
  KNOTGATE_THEME_KEY,
  applyThemeToDocument,
  normalizeTheme,
  readStoredTheme,
  setTheme,
} from "../app/src/lib/theme.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

function jsonResp(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// 1. Project normalization & PIER KB default naming
{
  const defFromLower = normalizeProject({ id: "default", name: "default", kind: "kb" });
  ok(defFromLower?.name === DEFAULT_PROJECT_LABEL, 'id="default" with name="default" normalizes to PIER KB');

  const defFromCustom = normalizeProject({ id: "default", name: "Legacy Default Index" });
  ok(defFromCustom?.name === "PIER KB", 'id="default" always displays as PIER KB');

  const dialogInferred = normalizeProject({ id: "chat_987", name: "Sprint Planning Thread" });
  ok(
    dialogInferred?.kind === "dialog" && categoryForProject(dialogInferred) === "personal_dialogs",
    "chat_* scope infers dialog kind and personal_dialogs category",
  );

  const deptInferred = normalizeProject({ id: "dept_platform", name: "Platform Engineering" });
  ok(
    deptInferred?.kind === "department" && categoryForProject(deptInferred) === "departments_environments",
    "dept_* scope infers department kind and departments_environments category",
  );

  const payload = normalizeProjectsPayload({
    ok: true,
    default_project: "default",
    projects: [
      { id: "chat_42", name: "Incident Triage", kind: "dialog", nodes: 0, has_data: false },
      { id: "default", name: "default", kind: "kb", docs: 312, nodes: 4820, has_data: true },
      { id: "env_staging", name: "Staging Cluster", kind: "environment", nodes: 120 },
    ],
  });
  ok(
    payload.projects[0].id === DEFAULT_PROJECT_ID && payload.projects[0].name === "PIER KB",
    "normalizeProjectsPayload places PIER KB first",
  );

  const grouped = groupProjectsByCategory(payload.projects);
  ok(
    grouped.kb.length === 1 &&
      grouped.personal_dialogs.length === 1 &&
      grouped.departments_environments.length === 1,
    "groupProjectsByCategory partitions KB, Personal & Dialogs, and Departments & Environments",
  );
  const filtered = groupProjectsByCategory(payload.projects, "triage");
  ok(
    filtered.personal_dialogs.length === 1 && filtered.kb.length === 0,
    "groupProjectsByCategory filters by search query",
  );
}

// 2. URL sync & open-redirect-safe returnTo validation
{
  ok(readInitialProjectFromUrl("") === "default", "missing ?project defaults to 'default' (PIER KB)");
  ok(readInitialProjectFromUrl("?project=chat_abc") === "chat_abc", "reads ?project=chat_abc from URL");
  ok(
    readInitialQuestionFromUrl("?project=chat_abc&q=What+was+decided%3F") === "What was decided?",
    "reads ?q= question deep-link from URL",
  );

  const updated = buildProjectUrl(
    "/memory/",
    "?project=default&returnTo=%2Fchat&q=hello",
    "#view",
    "user_42",
  );
  ok(
    updated === "/memory/?project=user_42&returnTo=%2Fchat&q=hello#view",
    "buildProjectUrl updates ?project while preserving ?returnTo, ?q, and hash",
  );

  ok(resolveSafeReturnTo("?returnTo=%2Fchat") === "/chat", "resolveSafeReturnTo accepts same-origin /chat");
  ok(
    resolveSafeReturnTo("?returnTo=%2Fchat%2Fc_123%3Ftab%3Dmemory") === "/chat/c_123?tab=memory",
    "resolveSafeReturnTo accepts deep same-origin path with query",
  );
  ok(resolveSafeReturnTo("?returnTo=%2F%2Fevil.example") === "/", "resolveSafeReturnTo blocks // protocol-relative open redirect");
  ok(resolveSafeReturnTo("?returnTo=https%3A%2F%2Fevil.example") === "/", "resolveSafeReturnTo blocks external https:// redirect");
  ok(resolveSafeReturnTo("?returnTo=javascript%3Aalert(1)") === "/", "resolveSafeReturnTo blocks javascript: URI");
  ok(resolveSafeReturnTo("?returnTo=%2F%5Cevil.example") === "/", "resolveSafeReturnTo blocks /\\ backslash redirect");
}

// 3. fetchMemoryProjects: /projects endpoint + automatic 404 -> MCP memory_list_projects fallback
{
  const directRes = await fetchMemoryProjects({
    graphBases: ["/memory/api/graph-stats"],
    bridgeUrls: ["/memory/api/memory"],
    oauthFetch: async (url) => {
      if (url === "/memory/api/graph-stats/projects") {
        return jsonResp(200, {
          ok: true,
          default_project: "default",
          projects: [
            { id: "default", name: "default", kind: "kb", nodes: 1500 },
            { id: "chat_777", name: "Architecture Sync", kind: "dialog", nodes: 18 },
          ],
        });
      }
      return jsonResp(404, {});
    },
  });
  ok(
    directRes.via === "graph-stats" &&
      directRes.projects.length === 2 &&
      directRes.projects[0].name === "PIER KB",
    "fetchMemoryProjects loads from /memory/api/graph-stats/projects when available",
  );

  let mcpToolCalled = false;
  const fallbackRes = await fetchMemoryProjects({
    graphBases: ["/memory/api/graph-stats"],
    bridgeUrls: ["/memory/api/memory"],
    oauthFetch: async (url, init = {}) => {
      if (url === "/memory/api/graph-stats/projects") {
        return jsonResp(404, { error: "not_found" });
      }
      if (url === "/memory/api/memory") {
        const body = JSON.parse(String(init.body ?? "{}"));
        if (body.method === "initialize") {
          return jsonResp(200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "sess_1" });
        }
        if (body.method === "notifications/initialized") {
          return new Response("", { status: 202 });
        }
        if (body.method === "tools/call" && body.params?.name === "memory_list_projects") {
          mcpToolCalled = true;
          return jsonResp(200, {
            jsonrpc: "2.0",
            id: 2,
            result: {
              content: [
                {
                  text: JSON.stringify({
                    projects: [
                      { id: "default", name: "default" },
                      { id: "dept_security", name: "Security KB", kind: "department" },
                    ],
                  }),
                },
              ],
            },
          });
        }
      }
      return jsonResp(500, {});
    },
  });
  ok(
    mcpToolCalled &&
      fallbackRes.via === "mcp" &&
      fallbackRes.projects.some((p) => p.id === "dept_security") &&
      fallbackRes.projects[0].name === "PIER KB",
    "fetchMemoryProjects falls back to MCP memory_list_projects on 404",
  );
}

// 4. fetchWithOAuth: 401 token refresh + retry AND stale-token clean tokenless retry
{
  const seenAuth = [];
  let attempt = 0;
  let loopReset = false;
  const resp = await fetchWithOAuth(
    "/memory/api/graph-stats/stats?project=user_1",
    { method: "GET" },
    {
      getToken: async () => "expired_token_1",
      refreshTokens: async () => ({
        access_token: "fresh_token_2",
        expires_at: Date.now() + 3600_000,
        client_id: "hmc_1",
        token_endpoint: "https://knotgate.labs.jb.gg/memory/token",
        issuer: "https://knotgate.labs.jb.gg/memory",
      }),
      resetLoopGuard: () => {
        loopReset = true;
      },
      fetchFn: async (_url, init) => {
        attempt++;
        const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? "";
        seenAuth.push(auth);
        if (attempt === 1) {
          return jsonResp(401, { error: "invalid_token" }, { "www-authenticate": 'Bearer error="invalid_token"' });
        }
        return jsonResp(200, { ok: true });
      },
    },
  );
  ok(
    resp.status === 200 &&
      loopReset &&
      seenAuth[0] === "Bearer expired_token_1" &&
      seenAuth[1] === "Bearer fresh_token_2",
    "fetchWithOAuth retries seamlessly with refreshed OAuth 2.1 Bearer token after 401 and resets loop guard",
  );

  // Stale Bearer + failed refresh on public PIER KB -> clears stale token & succeeds via clean tokenless retry (200 OK)
  const staleSeenAuth = [];
  let cleared = false;
  let recoverCalled = false;
  const staleResp = await fetchWithOAuth(
    "/memory/api/graph-stats/stats?project=default",
    { method: "GET" },
    {
      getToken: async () => "stale_bearer_after_restart",
      refreshTokens: async () => null,
      clearTokens: () => {
        cleared = true;
      },
      recover401: async () => {
        recoverCalled = true;
        return "should_not_be_used";
      },
      fetchFn: async (_url, init) => {
        const auth = init?.headers?.Authorization ?? init?.headers?.authorization ?? "";
        staleSeenAuth.push(auth);
        if (auth) {
          return jsonResp(401, { error: "invalid_token" });
        }
        return jsonResp(200, { ok: true, index_id: "default" });
      },
    },
  );
  ok(
    staleResp.status === 200 &&
      cleared &&
      !recoverCalled &&
      staleSeenAuth.length === 2 &&
      staleSeenAuth[0] === "Bearer stale_bearer_after_restart" &&
      staleSeenAuth[1] === "",
    "fetchWithOAuth clears stale token and succeeds via tokenless retry (200 OK) without SSO redirect loop",
  );
}

// 4b. Endpoint probing on /memory/ never falls through to /travel/ or root /api/graph-stats
{
  const prevWindow = globalThis.window;
  try {
    globalThis.window = { location: { pathname: "/memory/" } };
    const gBases = graphBases();
    ok(
      gBases.includes("/memory/api/graph-stats") &&
        !gBases.some((b) => b.includes("/travel/")) &&
        !gBases.includes("/api/graph-stats"),
      "graphBases() on /memory/ probes only /memory/api/graph-stats (never /travel/ or root /api/graph-stats)",
    );
    const gBasesExact = graphBases("/memory");
    ok(
      gBasesExact.length === 1 && gBasesExact[0] === "/memory/api/graph-stats",
      "graphBases('/memory') returns ['/memory/api/graph-stats'] cleanly",
    );
    const bUrls = bridgeUrls();
    const tBases = traceBases();
    ok(
      bUrls.includes("/memory/api/memory") &&
        bridgeEndpoints().includes("/memory/api/memory") &&
        !bUrls.some((b) => b.includes("/travel/")) &&
        tBases.includes("/memory/api/trace") &&
        !tBases.some((b) => b.includes("/travel/")) &&
        !tBases.includes("/api/trace"),
      "bridgeUrls() and traceBases() on /memory/ avoid /travel/ and root /api/ spam",
    );
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
}

// 5. End-to-End Project Wiring & Empty Scope Handling
{
  const calledUrls = [];
  const mockGraphFetch = async (url) => {
    calledUrls.push(String(url));
    if (String(url).includes("/stats?project=chat_empty")) {
      return jsonResp(200, {
        index_id: "chat_empty",
        empty: true,
        docs: 0,
        chunks: 0,
        entities: 0,
        relations: 0,
        nodes: 0,
        edges: 0,
        last_ingest: null,
      });
    }
    if (String(url).includes("/graph?project=chat_empty")) {
      return jsonResp(200, { ok: true, empty: true, nodes: [], edges: [] });
    }
    if (String(url).includes("/coords?dim=3&project=chat_empty")) {
      // Simulate 404 on coords for a brand-new empty dialog scope
      return jsonResp(404, { error: "no_coords_yet" });
    }
    return jsonResp(404, {});
  };

  const stats = await probeGraphStats("chat_empty", 5000, {
    bases: ["/memory/api/graph-stats"],
    oauthFetch: mockGraphFetch,
  });
  const cosmos = await loadLiveCosmos(stats, "chat_empty", 5000, {
    bases: ["/memory/api/graph-stats"],
    oauthFetch: mockGraphFetch,
  });
  ok(
    calledUrls.includes("/memory/api/graph-stats/stats?project=chat_empty") &&
      calledUrls.includes("/memory/api/graph-stats/graph?project=chat_empty") &&
      calledUrls.includes("/memory/api/graph-stats/coords?dim=3&project=chat_empty"),
    "probeGraphStats and loadLiveCosmos pass ?project=chat_empty to /stats, /graph, and /coords",
  );
  ok(
    cosmos.empty === true && cosmos.graph.nodes.length === 0 && cosmos.projectId === "chat_empty",
    "loadLiveCosmos returns empty:true cleanly when a dialog scope has 0 nodes",
  );

  // MCP memoryStatusLive(projectId) & memoryRecallLive(question, projectId)
  let capturedStatusArgs = null;
  let capturedRecallArgs = null;
  const mockMcpFetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body ?? "{}"));
    if (body.method === "initialize") {
      return jsonResp(200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "sess_proj" });
    }
    if (body.method === "notifications/initialized") {
      return new Response("", { status: 202 });
    }
    if (body.method === "tools/call" && body.params?.name === "memory_status") {
      capturedStatusArgs = body.params.arguments;
      return jsonResp(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ text: JSON.stringify({ working_dir: "/data/dept_eng", node_count: 42, edge_count: 80 }) }] },
      });
    }
    if (body.method === "tools/call" && body.params?.name === "memory_recall") {
      capturedRecallArgs = body.params.arguments;
      return jsonResp(200, {
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ text: JSON.stringify({ mode: "hybrid", context: "", hybrid: { fused_chunks: [] } }) }] },
      });
    }
    return jsonResp(404, {});
  };

  await memoryStatusLive("dept_eng", { urls: ["/memory/api/memory"], oauthFetch: mockMcpFetch });
  ok(capturedStatusArgs?.project === "dept_eng", "memoryStatusLive forwards arguments.project");

  await memoryRecallLive("How does deployment work?", "dept_eng", {
    urls: ["/memory/api/memory"],
    oauthFetch: mockMcpFetch,
  });
  ok(
    capturedRecallArgs?.project === "dept_eng" &&
      capturedRecallArgs?.mode === "hybrid" &&
      capturedRecallArgs?.top_k === 10 &&
      capturedRecallArgs?.context_only === false,
    "memoryRecallLive forwards { question, mode: 'hybrid', top_k: 10, context_only: false, project }",
  );

  // SSE streamRecallTrace(question, onEvent, opts, projectId)
  let streamedUrl = "";
  const ssePayload =
    'event: trace_start\ndata: {"mode":"hybrid","index_id":"dept_eng"}\n\n' +
    'event: result\ndata: {"context":"ok","hybrid":{"fused_chunks":[]}}\n\n' +
    'event: done\ndata: {"total_ms":120}\n\n';
  const traceRes = await streamRecallTrace(
    "How does deployment work?",
    () => {},
    {
      bases: ["/memory/api/trace"],
      oauthFetch: async (url) => {
        streamedUrl = String(url);
        return new Response(ssePayload, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
    },
    "dept_eng",
  );
  ok(
    streamedUrl.startsWith("/memory/api/trace/trace?project=dept_eng&question=") && traceRes?.context === "ok",
    "streamRecallTrace passes ?project=dept_eng&question=... over OAuth fetch",
  );
}

// 6. KnotGate Shared Theme Sync (knotgate:theme)
{
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  ok(readStoredTheme(storage) === "dark", "knotgate:theme defaults to 'dark' when unset");
  storage.setItem(KNOTGATE_THEME_KEY, "light");
  ok(readStoredTheme(storage) === "light", "readStoredTheme reads 'light' from knotgate:theme");
  ok(normalizeTheme("unexpected") === "dark", "normalizeTheme falls back to 'dark' on invalid values");

  const classes = new Set();
  const mockDoc = {
    documentElement: {
      dataset: {},
      style: {},
      classList: {
        toggle: (cls, force) => {
          if (force) classes.add(cls);
          else classes.delete(cls);
        },
      },
    },
  };
  applyThemeToDocument("light", mockDoc);
  ok(
    mockDoc.documentElement.dataset.theme === "light" &&
      classes.has("light") &&
      !classes.has("dark") &&
      mockDoc.documentElement.style.colorScheme === "light",
    "applyThemeToDocument sets data-theme='light', classList, and colorScheme",
  );
  applyThemeToDocument("dark", mockDoc);
  ok(
    mockDoc.documentElement.dataset.theme === "dark" &&
      classes.has("dark") &&
      !classes.has("light"),
    "applyThemeToDocument sets data-theme='dark' and .dark class",
  );
  setTheme("light", { storage });
  ok(storage.getItem(KNOTGATE_THEME_KEY) === "light", "setTheme persists to knotgate:theme");

  // Nord Cosmos constellation & Arctic light palette invariants
  const darkHexes = new Set(Object.values(FAMILY_COLORS).map((c) => c.toUpperCase()));
  for (const want of ["#88C0D0", "#8FBCBB", "#81A1C1", "#5E81AC", "#A3BE8C", "#EBCB8B", "#B48EAD", "#D08770"]) {
    ok(darkHexes.has(want), `Nord Dark Cosmos FAMILY_COLORS includes ${want}`);
  }
  const lightHexes = new Set(Object.values(FAMILY_COLORS_LIGHT).map((c) => c.toLowerCase()));
  for (const want of ["#2e3440", "#3b4252", "#5e81ac", "#0f6d8c", "#4f7a5b", "#8f5685"]) {
    ok(lightHexes.has(want), `Nord Light Arctic Cosmos FAMILY_COLORS_LIGHT includes ${want}`);
  }
  ok(
    colorForType("component", "dark") !== colorForType("component", "light"),
    "colorForType differentiates Nord Dark vs Nord Light Arctic star colors",
  );
  ok(
    Math.abs(INK.vector[0] - 0.533) < 0.01 &&
      Math.abs(INK.bm25[1] - 0.745) < 0.01 &&
      Math.abs(INK.gold[0] - 0.922) < 0.01 &&
      Math.abs(INK.violet[0] - 0.706) < 0.01,
    "INK stage highlights map Vector->Frost Cyan, BM25->Aurora Sage, Walk->Polar Gold + Borealis Violet",
  );
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\nknotgate-projects-theme: all green");
