// Standards-compliant OAuth 2.1 public SPA client for the HARS Memory MCP bridge:
//   - Protected Resource Metadata discovery (RFC 9728)
//   - Authorization Server Metadata discovery (RFC 8414)
//   - Dynamic Client Registration (RFC 7591), cached per (issuer, redirect_uri)
//   - Authorization Code + PKCE S256 (RFC 7636) via seamless first-party SSO
//     (/memory/sso/authorize behind oauth2-proxy) with strict redirect loop guard
//   - Refresh-token rotation and proactive/reactive token renewal

export const OAUTH_CLIENTS_STORAGE_KEY = "mt.oauth.clients.v1";
export const OAUTH_TOKENS_STORAGE_KEY = "mt.oauth.tokens.v1";
export const OAUTH_PKCE_SESSION_KEY = "mt.oauth.pkce.v1";
export const OAUTH_LOOP_GUARD_SESSION_KEY = "mt.oauth.loop_guard.v1";

export const DEFAULT_OAUTH_SCOPE = "memory:read";
export const DEFAULT_PRM_PATH = "/memory/.well-known/oauth-protected-resource";
export const EXPIRY_SKEW_MS = 30_000;
export const LOOP_GUARD_WINDOW_MS = 60_000;
export const LOOP_GUARD_MAX_REDIRECTS = 2;

export interface DiscoveredOAuthServer {
  issuer: string;
  resource: string;
  registrationEndpoint: string;
  tokenEndpoint: string;
  authorizationEndpoint: string;
  ssoAuthorizationEndpoint: string;
}

export interface CachedClientEntry {
  client_id: string;
  redirect_uri: string;
  issuer: string;
  registered_at: number;
}

export interface StoredOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  client_id: string;
  token_endpoint: string;
  issuer: string;
  resource?: string;
  scope?: string;
}

export interface PendingPkceSession {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  client_id: string;
  token_endpoint: string;
  issuer: string;
  resource: string;
  created_at: number;
}

export interface LoopGuardState {
  count: number;
  window_start: number;
  blocked_error?: string;
}

export interface OAuthStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OAuthEnvironment {
  fetchFn: typeof fetch;
  localStorage: OAuthStorageLike | null;
  sessionStorage: OAuthStorageLike | null;
  getLocation: () => { origin: string; pathname: string; search: string; hash: string };
  replaceUrl: (cleanRelativeUrl: string) => void;
  navigate: (url: string) => void;
  now: () => number;
}

export class OAuthRedirectInProgressError extends Error {
  readonly authorizeUrl: string;
  constructor(authorizeUrl: string) {
    super("Redirecting to OAuth 2.1 SSO...");
    this.name = "OAuthRedirectInProgressError";
    this.authorizeUrl = authorizeUrl;
  }
}

export class OAuthLoopGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthLoopGuardError";
  }
}

function safeBrowserStorage(kind: "localStorage" | "sessionStorage"): OAuthStorageLike | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window[kind];
    return s ?? null;
  } catch {
    return null;
  }
}

function defaultEnv(): OAuthEnvironment {
  return {
    fetchFn: (...args) => fetch(...args),
    localStorage: safeBrowserStorage("localStorage"),
    sessionStorage: safeBrowserStorage("sessionStorage"),
    getLocation: () => {
      if (typeof window === "undefined") {
        return { origin: "http://localhost", pathname: "/", search: "", hash: "" };
      }
      return {
        origin: window.location.origin,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      };
    },
    replaceUrl: (cleanRelativeUrl: string) => {
      if (typeof window !== "undefined" && window.history?.replaceState) {
        window.history.replaceState(window.history.state, "", cleanRelativeUrl);
      }
    },
    navigate: (url: string) => {
      if (typeof window !== "undefined") {
        window.location.assign(url);
      }
    },
    now: () => Date.now(),
  };
}

/** Unpadded base64url encoding (RFC 7636 / RFC 4648 section 5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(randomBytes?: Uint8Array): string {
  const buf = randomBytes ?? crypto.getRandomValues(new Uint8Array(32));
  return base64UrlEncode(buf);
}

export function generateState(randomBytes?: Uint8Array): string {
  const buf = randomBytes ?? crypto.getRandomValues(new Uint8Array(24));
  return base64UrlEncode(buf);
}

export async function computeCodeChallengeS256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Extract RFC 9728 `resource_metadata` URL from WWW-Authenticate header or 401 JSON body. */
export function extractResourceMetadataUrl(
  wwwAuthenticateHeader: string | null,
  responseBodyText: string,
  fallbackOrigin?: string,
): string | null {
  if (wwwAuthenticateHeader) {
    const quoted = wwwAuthenticateHeader.match(/resource_metadata\s*=\s*"([^"]+)"/i);
    if (quoted?.[1]) return quoted[1].trim();
    const unquoted = wwwAuthenticateHeader.match(/resource_metadata\s*=\s*([^\s,]+)/i);
    if (unquoted?.[1]) return unquoted[1].trim();
  }
  const trimmed = responseBodyText.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { resource_metadata?: unknown };
      if (typeof parsed.resource_metadata === "string" && parsed.resource_metadata.trim()) {
        return parsed.resource_metadata.trim();
      }
    } catch {
      /* ignore non-JSON 401 bodies */
    }
  }
  if (fallbackOrigin && /^https?:\/\//i.test(fallbackOrigin)) {
    return `${fallbackOrigin.replace(/\/+$/, "")}${DEFAULT_PRM_PATH}`;
  }
  return null;
}

function readJson<T>(storage: OAuthStorageLike | null, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(storage: OAuthStorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage quota / private mode failures */
  }
}

function removeKey(storage: OAuthStorageLike | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Discover RFC 9728 Protected Resource Metadata + RFC 8414 Authorization Server Metadata. */
export async function discoverOAuthEndpoints(
  resourceMetadataUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoveredOAuthServer> {
  const prmResp = await fetchFn(resourceMetadataUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!prmResp.ok) {
    throw new Error(`Protected Resource Metadata HTTP ${prmResp.status} at ${resourceMetadataUrl}`);
  }
  const prm = (await prmResp.json()) as {
    resource?: unknown;
    authorization_servers?: unknown;
  };
  const servers = Array.isArray(prm.authorization_servers)
    ? prm.authorization_servers.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  if (!servers.length) {
    throw new Error(`Protected Resource Metadata at ${resourceMetadataUrl} omitted authorization_servers`);
  }

  const rawIssuer = trimTrailingSlashes(servers[0].trim());
  const parsedIssuer = new URL(rawIssuer);
  const issuerPath = parsedIssuer.pathname.replace(/\/+$/, "");
  const asCandidates = [
    `${rawIssuer}/.well-known/oauth-authorization-server`,
    `${parsedIssuer.origin}/.well-known/oauth-authorization-server${issuerPath}`,
  ];

  let asMeta: Record<string, unknown> | null = null;
  let lastErr = "";
  for (const candidate of [...new Set(asCandidates)]) {
    try {
      const r = await fetchFn(candidate, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) {
        lastErr = `${candidate}: HTTP ${r.status}`;
        continue;
      }
      const data = (await r.json()) as Record<string, unknown>;
      if (typeof data.token_endpoint === "string" || typeof data.authorization_endpoint === "string") {
        asMeta = data;
        break;
      }
      lastErr = `${candidate}: missing OAuth endpoints`;
    } catch (e) {
      lastErr = `${candidate}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (!asMeta) {
    throw new Error(`Authorization Server Metadata unreachable (${lastErr})`);
  }

  const issuer = trimTrailingSlashes(
    typeof asMeta.issuer === "string" && asMeta.issuer.trim() ? asMeta.issuer.trim() : rawIssuer,
  );
  const resource =
    typeof prm.resource === "string" && prm.resource.trim() ? prm.resource.trim() : `${issuer}/mcp/`;
  const registrationEndpoint =
    typeof asMeta.registration_endpoint === "string" && asMeta.registration_endpoint.trim()
      ? asMeta.registration_endpoint.trim()
      : `${issuer}/register`;
  const tokenEndpoint =
    typeof asMeta.token_endpoint === "string" && asMeta.token_endpoint.trim()
      ? asMeta.token_endpoint.trim()
      : `${issuer}/token`;
  const authorizationEndpoint =
    typeof asMeta.authorization_endpoint === "string" && asMeta.authorization_endpoint.trim()
      ? asMeta.authorization_endpoint.trim()
      : `${issuer}/authorize`;
  const ssoAuthorizationEndpoint =
    typeof asMeta.sso_authorization_endpoint === "string" && asMeta.sso_authorization_endpoint.trim()
      ? asMeta.sso_authorization_endpoint.trim()
      : `${issuer}/sso/authorize`;

  return {
    issuer,
    resource,
    registrationEndpoint,
    tokenEndpoint,
    authorizationEndpoint,
    ssoAuthorizationEndpoint,
  };
}

function clientCacheKey(issuer: string, redirectUri: string): string {
  return `${trimTrailingSlashes(issuer)}|${redirectUri}`;
}

export function clearCachedClient(
  issuer: string,
  redirectUri: string,
  env: OAuthEnvironment = defaultEnv(),
): void {
  const map = readJson<Record<string, CachedClientEntry>>(env.localStorage, OAUTH_CLIENTS_STORAGE_KEY) ?? {};
  const key = clientCacheKey(issuer, redirectUri);
  if (key in map) {
    delete map[key];
    writeJson(env.localStorage, OAUTH_CLIENTS_STORAGE_KEY, map);
  }
}

/** RFC 7591 Dynamic Client Registration with localStorage caching per (issuer, redirect_uri). */
export async function registerOrGetClientId(
  server: DiscoveredOAuthServer,
  redirectUri: string,
  opts: { forceRegister?: boolean; env?: OAuthEnvironment } = {},
): Promise<string> {
  const env = opts.env ?? defaultEnv();
  const key = clientCacheKey(server.issuer, redirectUri);
  const cachedMap =
    readJson<Record<string, CachedClientEntry>>(env.localStorage, OAUTH_CLIENTS_STORAGE_KEY) ?? {};
  if (!opts.forceRegister && cachedMap[key]?.client_id) {
    return cachedMap[key].client_id;
  }

  const resp = await env.fetchFn(server.registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: "Memory Travel Web UI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: DEFAULT_OAUTH_SCOPE,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`OAuth Dynamic Client Registration failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text) as { client_id?: unknown };
  if (typeof data.client_id !== "string" || !data.client_id.trim()) {
    throw new Error("OAuth registration response omitted client_id");
  }
  const clientId = data.client_id.trim();
  cachedMap[key] = {
    client_id: clientId,
    redirect_uri: redirectUri,
    issuer: server.issuer,
    registered_at: env.now(),
  };
  writeJson(env.localStorage, OAUTH_CLIENTS_STORAGE_KEY, cachedMap);
  return clientId;
}

/** Build a clean relative URL with OAuth callback parameters stripped. */
export function stripOAuthCallbackParams(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  for (const key of ["code", "state", "iss", "error", "error_description"]) {
    params.delete(key);
  }
  const qs = params.toString();
  return `${pathname}${qs ? `?${qs}` : ""}${hash || ""}`;
}

function recordLoopError(env: OAuthEnvironment, message: string): void {
  const prev = readJson<LoopGuardState>(env.sessionStorage, OAUTH_LOOP_GUARD_SESSION_KEY);
  const now = env.now();
  writeJson(env.sessionStorage, OAUTH_LOOP_GUARD_SESSION_KEY, {
    count: prev?.count ?? 1,
    window_start: prev?.window_start ?? now,
    blocked_error: message,
  } satisfies LoopGuardState);
}

/**
 * Exchange `?code=...&state=...` on page load (if present), clean URL via
 * history.replaceState, and persist OAuth tokens. Safe to call multiple times.
 */
export async function processOAuthCallback(
  env: OAuthEnvironment = defaultEnv(),
): Promise<{ handled: boolean; error?: string }> {
  const loc = env.getLocation();
  const params = new URLSearchParams(loc.search);
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");
  const oauthErrorDesc = params.get("error_description");
  const iss = params.get("iss");

  if (!code && !oauthError) {
    return { handled: false };
  }

  // Always clean callback query params immediately so a refresh or StrictMode re-run
  // never re-submits a single-use authorization code.
  env.replaceUrl(stripOAuthCallbackParams(loc.pathname, loc.search, loc.hash));

  const pkce = readJson<PendingPkceSession>(env.sessionStorage, OAUTH_PKCE_SESSION_KEY);
  removeKey(env.sessionStorage, OAUTH_PKCE_SESSION_KEY);

  if (oauthError) {
    const msg = `OAuth authorization failed (${oauthError}${oauthErrorDesc ? `: ${oauthErrorDesc}` : ""})`;
    recordLoopError(env, msg);
    return { handled: true, error: msg };
  }

  if (!pkce || !code || !state || state !== pkce.state) {
    const msg = "OAuth callback state mismatch or missing PKCE session";
    recordLoopError(env, msg);
    return { handled: true, error: msg };
  }

  if (iss && trimTrailingSlashes(iss) !== trimTrailingSlashes(pkce.issuer)) {
    const msg = `OAuth callback issuer mismatch (got ${iss}, expected ${pkce.issuer})`;
    recordLoopError(env, msg);
    return { handled: true, error: msg };
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pkce.redirect_uri,
    client_id: pkce.client_id,
    code_verifier: pkce.code_verifier,
  });

  const resp = await env.fetchFn(pkce.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });
  const bodyText = await resp.text();
  if (!resp.ok) {
    if (resp.status === 401 || bodyText.includes("invalid_client")) {
      clearCachedClient(pkce.issuer, pkce.redirect_uri, env);
    }
    const msg = `OAuth token exchange failed (HTTP ${resp.status}): ${bodyText.slice(0, 200)}`;
    recordLoopError(env, msg);
    return { handled: true, error: msg };
  }

  const tokenData = JSON.parse(bodyText) as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  if (typeof tokenData.access_token !== "string" || !tokenData.access_token) {
    const msg = "OAuth token endpoint returned no access_token";
    recordLoopError(env, msg);
    return { handled: true, error: msg };
  }

  const expiresInSec =
    typeof tokenData.expires_in === "number" && Number.isFinite(tokenData.expires_in) && tokenData.expires_in > 0
      ? tokenData.expires_in
      : 3600;

  const stored: StoredOAuthTokens = {
    access_token: tokenData.access_token,
    refresh_token: typeof tokenData.refresh_token === "string" ? tokenData.refresh_token : undefined,
    expires_at: env.now() + expiresInSec * 1000,
    client_id: pkce.client_id,
    token_endpoint: pkce.token_endpoint,
    issuer: pkce.issuer,
    resource: pkce.resource,
    scope: typeof tokenData.scope === "string" ? tokenData.scope : DEFAULT_OAUTH_SCOPE,
  };
  writeJson(env.localStorage, OAUTH_TOKENS_STORAGE_KEY, stored);
  removeKey(env.sessionStorage, OAUTH_LOOP_GUARD_SESSION_KEY);
  return { handled: true };
}

/** Exchange stored refresh_token for a fresh access_token (+ rotated refresh_token). */
export async function refreshStoredTokens(
  env: OAuthEnvironment = defaultEnv(),
): Promise<StoredOAuthTokens | null> {
  const current = readJson<StoredOAuthTokens>(env.localStorage, OAUTH_TOKENS_STORAGE_KEY);
  if (!current?.refresh_token || !current.token_endpoint || !current.client_id) {
    return null;
  }

  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
    client_id: current.client_id,
  });

  try {
    const resp = await env.fetchFn(current.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
    const text = await resp.text();
    if (!resp.ok) {
      removeKey(env.localStorage, OAUTH_TOKENS_STORAGE_KEY);
      if (resp.status === 401 || text.includes("invalid_client")) {
        const loc = env.getLocation();
        clearCachedClient(current.issuer, `${loc.origin}${loc.pathname}`, env);
      }
      return null;
    }
    const data = JSON.parse(text) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      scope?: unknown;
    };
    if (typeof data.access_token !== "string" || !data.access_token) {
      removeKey(env.localStorage, OAUTH_TOKENS_STORAGE_KEY);
      return null;
    }
    const expiresInSec =
      typeof data.expires_in === "number" && Number.isFinite(data.expires_in) && data.expires_in > 0
        ? data.expires_in
        : 3600;
    const updated: StoredOAuthTokens = {
      ...current,
      access_token: data.access_token,
      refresh_token:
        typeof data.refresh_token === "string" && data.refresh_token
          ? data.refresh_token
          : current.refresh_token,
      expires_at: env.now() + expiresInSec * 1000,
      scope: typeof data.scope === "string" ? data.scope : current.scope,
    };
    writeJson(env.localStorage, OAUTH_TOKENS_STORAGE_KEY, updated);
    return updated;
  } catch {
    return null;
  }
}

/** Check loop guard and initiate seamless PKCE S256 redirect to /memory/sso/authorize. */
export async function initiateSsoPkceRedirect(
  opts: {
    wwwAuthenticate: string | null;
    bodyText: string;
    env?: OAuthEnvironment;
  },
): Promise<string> {
  const env = opts.env ?? defaultEnv();
  const now = env.now();
  const guard = readJson<LoopGuardState>(env.sessionStorage, OAUTH_LOOP_GUARD_SESSION_KEY);

  if (guard?.blocked_error && now - guard.window_start < LOOP_GUARD_WINDOW_MS) {
    throw new OAuthLoopGuardError(guard.blocked_error);
  }
  const activeWindow = guard && now - guard.window_start < LOOP_GUARD_WINDOW_MS;
  const count = activeWindow ? guard.count : 0;
  if (count >= LOOP_GUARD_MAX_REDIRECTS) {
    throw new OAuthLoopGuardError(
      `OAuth SSO redirect loop guard tripped (${count} redirects within ${LOOP_GUARD_WINDOW_MS / 1000}s)`,
    );
  }

  const loc = env.getLocation();
  const prmUrl = extractResourceMetadataUrl(opts.wwwAuthenticate, opts.bodyText, loc.origin);
  if (!prmUrl) {
    throw new Error("Cannot discover OAuth Protected Resource Metadata URL from 401 response");
  }

  const server = await discoverOAuthEndpoints(prmUrl, env.fetchFn);
  const redirectUri = `${loc.origin}${loc.pathname}`;
  const clientId = await registerOrGetClientId(server, redirectUri, { env });

  const verifier = generateCodeVerifier();
  const challenge = await computeCodeChallengeS256(verifier);
  const state = generateState();

  const pkceSession: PendingPkceSession = {
    state,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: clientId,
    token_endpoint: server.tokenEndpoint,
    issuer: server.issuer,
    resource: server.resource,
    created_at: now,
  };
  writeJson(env.sessionStorage, OAUTH_PKCE_SESSION_KEY, pkceSession);
  writeJson(env.sessionStorage, OAUTH_LOOP_GUARD_SESSION_KEY, {
    count: count + 1,
    window_start: activeWindow ? guard.window_start : now,
  } satisfies LoopGuardState);

  const authParams = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: DEFAULT_OAUTH_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    resource: server.resource,
  });
  const authorizeUrl = `${server.ssoAuthorizationEndpoint}?${authParams.toString()}`;
  env.navigate(authorizeUrl);
  return authorizeUrl;
}

// ===========================================================================
// Singleton Browser Coordinator (StrictMode & Concurrent Request Safe)
// ===========================================================================

let bootCallbackPromise: Promise<{ handled: boolean; error?: string }> | null = null;
let inflightRefreshPromise: Promise<StoredOAuthTokens | null> | null = null;
let inflightRedirectPromise: Promise<never> | null = null;
let redirectingFlag = false;

export function isOAuthRedirectInProgress(): boolean {
  return redirectingFlag;
}

/** Run once on app startup (and awaited before any bridge request). */
export function ensureOAuthCallbackHandled(): Promise<{ handled: boolean; error?: string }> {
  if (!bootCallbackPromise) {
    bootCallbackPromise = processOAuthCallback().catch((e: unknown) => ({
      handled: true,
      error: e instanceof Error ? e.message : String(e),
    }));
  }
  return bootCallbackPromise;
}

/** Return a valid Bearer access token if stored (proactively refreshing via refresh_token). */
export async function getBridgeAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
  await ensureOAuthCallbackHandled();
  const env = defaultEnv();
  const stored = readJson<StoredOAuthTokens>(env.localStorage, OAUTH_TOKENS_STORAGE_KEY);
  if (!stored) return null;

  const needsRefresh = opts.forceRefresh || env.now() >= stored.expires_at - EXPIRY_SKEW_MS;
  if (!needsRefresh && stored.access_token) {
    return stored.access_token;
  }
  if (!stored.refresh_token) {
    if (opts.forceRefresh || env.now() >= stored.expires_at) {
      removeKey(env.localStorage, OAUTH_TOKENS_STORAGE_KEY);
      return null;
    }
    return stored.access_token;
  }

  if (!inflightRefreshPromise) {
    inflightRefreshPromise = refreshStoredTokens(env).finally(() => {
      inflightRefreshPromise = null;
    });
  }
  const refreshed = await inflightRefreshPromise;
  return refreshed?.access_token ?? null;
}

/**
 * Handle a 401 Unauthorized from `/travel/api/memory` or `/memory/api/memory`:
 *   1. Try refreshing once if we have a refresh_token.
 *   2. Otherwise run DCR + PKCE S256 and redirect to `/memory/sso/authorize`.
 */
export async function recoverFromBridge401(opts: {
  wwwAuthenticate: string | null;
  bodyText: string;
  hadBearer: boolean;
}): Promise<string> {
  if (opts.hadBearer) {
    const refreshed = await getBridgeAccessToken({ forceRefresh: true });
    if (refreshed) return refreshed;
  } else {
    const existing = await getBridgeAccessToken();
    if (existing) return existing;
  }

  if (!inflightRedirectPromise) {
    inflightRedirectPromise = (async () => {
      const url = await initiateSsoPkceRedirect({
        wwwAuthenticate: opts.wwwAuthenticate,
        bodyText: opts.bodyText,
      });
      redirectingFlag = true;
      throw new OAuthRedirectInProgressError(url);
    })().finally(() => {
      inflightRedirectPromise = null;
    });
  }
  return inflightRedirectPromise;
}

function mergeBearerHeader(initHeaders: HeadersInit | undefined, bearerToken: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (initHeaders) {
    if (initHeaders instanceof Headers) {
      initHeaders.forEach((v, k) => {
        out[k] = v;
      });
    } else if (Array.isArray(initHeaders)) {
      for (const [k, v] of initHeaders) out[k] = v;
    } else {
      Object.assign(out, initHeaders);
    }
  }
  const hasAuth = Object.keys(out).some((k) => k.toLowerCase() === "authorization");
  if (bearerToken && !hasAuth) {
    out["Authorization"] = `Bearer ${bearerToken}`;
  }
  return out;
}

/**
 * Authenticated fetch wrapper for HARS / KnotGate Memory endpoints
 * (`/memory/api/graph-stats/*`, `/memory/api/trace/*`, `/memory/api/memory`):
 *   - Attaches stored OAuth 2.1 Bearer token if present (proactively refreshed).
 *   - On HTTP 401, runs refresh-token rotation or seamless PKCE S256 SSO redirect,
 *     and retries once when a fresh token is obtained.
 */
export async function fetchWithOAuth(
  input: string,
  init: RequestInit = {},
  deps: {
    fetchFn?: typeof fetch;
    getToken?: (opts?: { forceRefresh?: boolean }) => Promise<string | null>;
    recover401?: typeof recoverFromBridge401;
  } = {},
): Promise<Response> {
  const fetchFn = deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const getToken = deps.getToken ?? getBridgeAccessToken;
  const recover401 = deps.recover401 ?? recoverFromBridge401;

  const initialToken = await getToken();
  const headers = mergeBearerHeader(init.headers, initialToken);
  let resp = await fetchFn(input, { ...init, headers });

  if (resp.status === 401) {
    const bodyText = await resp.text();
    const freshToken = await recover401({
      wwwAuthenticate: resp.headers.get("www-authenticate"),
      bodyText,
      hadBearer: Boolean(initialToken),
    });
    const retryHeaders = mergeBearerHeader(init.headers, null);
    for (const k of Object.keys(retryHeaders)) {
      if (k.toLowerCase() === "authorization") delete retryHeaders[k];
    }
    retryHeaders["Authorization"] = `Bearer ${freshToken}`;
    resp = await fetchFn(input, { ...init, headers: retryHeaders });
    if (resp.status === 401) {
      const retryText = await resp.text();
      await recover401({
        wwwAuthenticate: resp.headers.get("www-authenticate"),
        bodyText: retryText,
        hadBearer: false,
      });
    }
  }

  return resp;
}
