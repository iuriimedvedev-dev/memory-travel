// Live memory_recall client (browser-safe).
// Talks to the HARS memory bridge (Streamable HTTP MCP, no auth):
//   POST initialize -> POST notifications/initialized -> POST tools/call
//   { name: "memory_recall", arguments: { question, context_only: true } }
// Bodies may be plain JSON or SSE (`data:` lines) — both are accepted.
//
// Cross-origin: the page (127.0.0.1:5174) and the bridge (10.66.66.99:8099)
// differ, so dev goes through the Vite proxy (/api/memory -> bridge, see
// vite.config.ts). If the proxy is absent (static preview) we fall back to
// the direct URL, which needs the bridge to allow CORS. If every endpoint
// is unreachable the caller gets one readable Error and fixtures keep working.

// Bridge target: set at build/dev time via MEMORY_BRIDGE_URL (vite.config
// injects __MEMORY_BRIDGE_URL__). Same default as the dev proxy.
declare const __MEMORY_BRIDGE_URL__: string;
export const BRIDGE_DIRECT_URL =
  typeof __MEMORY_BRIDGE_URL__ === "string" ? __MEMORY_BRIDGE_URL__ : "http://10.66.66.99:8099/mcp";
export const BRIDGE_PROXY_PATH = "/api/memory";

export const LIVE_TIMEOUT_MS = 120_000;
export const MAX_QUESTION_CHARS = 500;

const STOP = new Set(
  "what,whats,which,who,whom,whose,when,where,why,how,does,do,did,is,are,was,were,be,been,being,have,has,had,the,a,an,and,or,but,of,for,with,from,into,that,this,these,those,then,than,they,them,their,there,here,it,its,as,at,by,on,in,to,not,no,yes,if,else,while,about,across,after,before,between,through,during,under,over,again,once,any,all,each,other,some,such,only,own,same,so,too,very,can,will,just,should,now,use,used,using,get,like,also,across".split(","),
);

/**
 * Naive keyword extraction for the live path. The bridge runs graph-aware
 * retrieval only when ll_keywords are supplied (without them it reports
 * `mode_fallback: no keywords supplied — used naive mode` and returns no
 * entities/relations). Fixtures were captured with hand-picked keywords; a
 * typed question has none, so we derive them: UPPER/digit tokens
 * (VEA, M-LDP, DemoVisionModel, STALL…), then longest non-stopwords, capped at 8.
 */
export function keywordsFor(question: string): string[] {
  const toks = question.match(/[A-Za-z0-9][A-Za-z0-9._/-]*/g) ?? [];
  const seen = new Set<string>();
  const strong: string[] = [];
  const weak: [string, number][] = [];
  for (const raw of toks) {
    const t = raw.replace(/^[._/-]+|[._/-]+$/g, "");
    const low = t.toLowerCase();
    if (t.length < 2 || STOP.has(low) || seen.has(low)) continue;
    seen.add(low);
    if (/[A-Z]/.test(t.slice(1)) || /[0-9]/.test(t) || /^[A-Z]{2,}$/.test(t)) strong.push(t);
    else if (t.length >= 4) weak.push([t, t.length]);
  }
  weak.sort((a, b) => b[1] - a[1]);
  return [...strong, ...weak.map(([t]) => t)].slice(0, 8);
}

export interface LiveRecall {
  /** Parsed memory_recall result payload (same shape as fixtures' response text). */
  result: Record<string, unknown>;
  clientLatencyS: number;
  endpoint: string;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

/** Unwrap a bridge body: plain JSON, or SSE lines starting with `data:`. */
export function unwrapBody(body: string): unknown {
  const t = body.trim();
  if (!t) throw new Error("empty response body from memory bridge");
  if (t.startsWith("{") || t.startsWith("[")) return JSON.parse(t);
  const chunks: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("data:")) {
      const d = line.slice(5).trim();
      if (d && d !== "[DONE]") chunks.push(d);
    }
  }
  if (!chunks.length) throw new Error(`unrecognised bridge response (first 120 chars): ${t.slice(0, 120)}`);
  return JSON.parse(chunks.join("\n"));
}

async function postJSON(url: string, payload: unknown, headers: Record<string, string>, signal: AbortSignal) {
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });
  const sid = r.headers.get("mcp-session-id");
  const text = await r.text();
  if (!r.ok && r.status !== 202) {
    throw new Error(`bridge HTTP ${r.status} at ${url}: ${text.slice(0, 200)}`);
  }
  return { sid, text };
}

async function recallVia(question: string, url: string, signal: AbortSignal): Promise<LiveRecall> {
  const t0 = performance.now();
  // 1. initialize
  const init = await postJSON(
    url,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "memory-travel", version: "1.0" } },
    },
    { ...JSON_HEADERS },
    signal,
  );
  const session = init.sid;
  if (!session) throw new Error(`bridge at ${url} omitted the mcp-session-id header on initialize`);
  const h = { ...JSON_HEADERS, "mcp-session-id": session };
  // 2. notifications/initialized (a notification: 202/empty is fine)
  try {
    await postJSON(url, { jsonrpc: "2.0", method: "notifications/initialized" }, h, signal);
  } catch (e) {
    // Some transports 4xx notifications while sessions still work; keep going
    // only on HTTP errors, not on aborts / network death.
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof TypeError) throw e;
  }
  // 3. tools/call memory_recall (context_only: the service returns context,
  //    the app renders an extractive preview like the fixtures do).
  //    Keywords are required for graph-aware retrieval (see keywordsFor).
  const kws = keywordsFor(question);
  const args = {
    question,
    ll_keywords: kws,
    hl_keywords: kws.slice(0, 3),
    mode: "hybrid",
    context_only: true,
    top_k: 10,
  };
  const call = await postJSON(
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "memory_recall", arguments: args } },
    h,
    signal,
  );
  const rpc = unwrapBody(call.text) as {
    result?: { content?: { text?: string }[] };
    error?: { message?: string };
  };
  if (rpc.error) throw new Error(`memory_recall error: ${rpc.error.message ?? JSON.stringify(rpc.error)}`);
  const text = rpc.result?.content?.[0]?.text;
  if (!text) throw new Error("memory_recall returned no content text");
  return { result: JSON.parse(text) as Record<string, unknown>, clientLatencyS: (performance.now() - t0) / 1000, endpoint: url };
}

/**
 * Ask the live bridge. Tries the dev proxy first, then the direct URL.
 * Aborts (timeout or caller signal) reject with a DOMException AbortError.
 */
export async function memoryRecallLive(
  question: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<LiveRecall> {
  const q = question.trim();
  if (!q) throw new Error("empty question");
  if (q.length > MAX_QUESTION_CHARS) throw new Error(`question too long (${q.length} > ${MAX_QUESTION_CHARS} chars)`);
  const timeoutMs = opts.timeoutMs ?? LIVE_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException(`memory bridge timed out after ${timeoutMs / 1000}s`, "AbortError")), timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      throw opts.signal.reason ?? new DOMException("cancelled", "AbortError");
    }
    opts.signal.addEventListener("abort", () => ctrl.abort(opts.signal!.reason), { once: true });
  }
  try {
    const failures: string[] = [];
    for (const url of [BRIDGE_PROXY_PATH, BRIDGE_DIRECT_URL]) {
      try {
        return await recallVia(q, url, ctrl.signal);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        failures.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error(
      `memory bridge unreachable. Tried ${BRIDGE_PROXY_PATH} (Vite dev proxy) and ${BRIDGE_DIRECT_URL} (direct). ` +
        failures.join(" | ") +
        " The 5 fixture traces still play below.",
    );
  } finally {
    clearTimeout(timer);
  }
}
