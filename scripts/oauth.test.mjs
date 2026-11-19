// Unit tests for the OAuth 2.1 PKCE + DCR + SSO client (app/src/lib/oauth.ts).
// Run: node scripts/oauth.test.mjs   (exit 1 on failure)
import {
  OAUTH_CLIENTS_STORAGE_KEY,
  OAUTH_LOOP_GUARD_SESSION_KEY,
  OAUTH_PKCE_SESSION_KEY,
  OAUTH_TOKENS_STORAGE_KEY,
  OAuthLoopGuardError,
  computeCodeChallengeS256,
  discoverOAuthEndpoints,
  extractResourceMetadataUrl,
  generateCodeVerifier,
  initiateSsoPkceRedirect,
  processOAuthCallback,
  refreshStoredTokens,
  registerOrGetClientId,
  stripOAuthCallbackParams,
} from "../app/src/lib/oauth.ts";

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`);
  if (!cond) failures++;
};

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

function jsonResp(status, obj, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// 1. RFC 7636 Appendix B S256 test vector
{
  const rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const got = await computeCodeChallengeS256(rfcVerifier);
  ok(got === rfcChallenge, "PKCE S256 matches RFC 7636 Appendix B vector");
  const gen = generateCodeVerifier();
  ok(/^[A-Za-z0-9_-]{43}$/.test(gen), "generated code_verifier is 43-char unpadded base64url");
}

// 2. RFC 9728 resource_metadata extraction
{
  const fromHeader = extractResourceMetadataUrl(
    'Bearer resource_metadata="https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource", error="invalid_token"',
    "",
  );
  ok(
    fromHeader === "https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource",
    "extractResourceMetadataUrl parses WWW-Authenticate header",
  );
  const fromBody = extractResourceMetadataUrl(
    null,
    JSON.stringify({
      error: "unauthorized",
      error_description: "Missing Authorization: Bearer <access token>",
      resource_metadata: "https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource",
    }),
  );
  ok(
    fromBody === "https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource",
    "extractResourceMetadataUrl parses 401 JSON body",
  );
  const fromFallback = extractResourceMetadataUrl(null, "plain 401", "https://knotgate.labs.jb.gg");
  ok(
    fromFallback === "https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource",
    "extractResourceMetadataUrl falls back to origin + /memory/.well-known/oauth-protected-resource",
  );
}

// 3. Full Discovery -> DCR caching -> PKCE SSO redirect -> Loop guard -> Callback -> Refresh
{
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  let nowMs = 1_700_000_000_000;
  let loc = {
    origin: "https://knotgate.labs.jb.gg",
    pathname: "/memory",
    search: "",
    hash: "#cosmos",
  };
  let replacedUrl = null;
  const navigatedUrls = [];
  let registerCount = 0;
  let lastTokenBody = null;

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === "https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource") {
      return jsonResp(200, {
        resource: "https://knotgate.labs.jb.gg/memory/mcp/",
        authorization_servers: ["https://knotgate.labs.jb.gg/memory"],
        scopes_supported: ["memory:read", "memory:write"],
      });
    }
    if (u === "https://knotgate.labs.jb.gg/memory/.well-known/oauth-authorization-server") {
      return jsonResp(200, {
        issuer: "https://knotgate.labs.jb.gg/memory",
        authorization_endpoint: "https://knotgate.labs.jb.gg/memory/authorize",
        sso_authorization_endpoint: "https://knotgate.labs.jb.gg/memory/sso/authorize",
        token_endpoint: "https://knotgate.labs.jb.gg/memory/token",
        registration_endpoint: "https://knotgate.labs.jb.gg/memory/register",
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (u === "https://knotgate.labs.jb.gg/memory/register") {
      registerCount++;
      const payload = JSON.parse(String(init.body));
      ok(
        payload.redirect_uris[0] === "https://knotgate.labs.jb.gg/memory" && payload.scope === "memory:read",
        "DCR registers exact origin+pathname redirect_uri and memory:read scope",
      );
      return jsonResp(201, {
        client_id: "hmc_unit_test_client",
        redirect_uris: payload.redirect_uris,
        token_endpoint_auth_method: "none",
      });
    }
    if (u === "https://knotgate.labs.jb.gg/memory/token") {
      const form = new URLSearchParams(String(init.body));
      lastTokenBody = Object.fromEntries(form.entries());
      if (form.get("grant_type") === "authorization_code") {
        return jsonResp(200, {
          access_token: "test_access_v1",
          refresh_token: "test_refresh_v1",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "memory:read",
        });
      }
      if (form.get("grant_type") === "refresh_token") {
        return jsonResp(200, {
          access_token: "test_access_v2",
          refresh_token: "test_refresh_v2",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "memory:read",
        });
      }
    }
    return jsonResp(404, { error: "not_found" });
  };

  const env = {
    fetchFn: mockFetch,
    localStorage: local,
    sessionStorage: session,
    getLocation: () => loc,
    replaceUrl: (u) => {
      replacedUrl = u;
    },
    navigate: (u) => {
      navigatedUrls.push(u);
    },
    now: () => nowMs,
  };

  const server = await discoverOAuthEndpoints(
    "https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource",
    mockFetch,
  );
  ok(
    server.ssoAuthorizationEndpoint === "https://knotgate.labs.jb.gg/memory/sso/authorize",
    "discoverOAuthEndpoints resolves ssoAuthorizationEndpoint",
  );

  // DCR caching check
  const cid1 = await registerOrGetClientId(server, "https://knotgate.labs.jb.gg/memory", { env });
  const cid2 = await registerOrGetClientId(server, "https://knotgate.labs.jb.gg/memory", { env });
  ok(cid1 === "hmc_unit_test_client" && cid2 === cid1 && registerCount === 1, "DCR caches client_id in localStorage");
  ok(Boolean(local.getItem(OAUTH_CLIENTS_STORAGE_KEY)), "client cache persisted under OAUTH_CLIENTS_STORAGE_KEY");

  // Redirect 1
  const authUrl1 = await initiateSsoPkceRedirect({
    wwwAuthenticate: 'Bearer resource_metadata="https://knotgate.labs.jb.gg/memory/.well-known/oauth-protected-resource"',
    bodyText: "",
    env,
  });
  const parsedAuth1 = new URL(authUrl1);
  ok(
    `${parsedAuth1.origin}${parsedAuth1.pathname}` === "https://knotgate.labs.jb.gg/memory/sso/authorize",
    "SSO redirect targets /memory/sso/authorize",
  );
  ok(parsedAuth1.searchParams.get("code_challenge_method") === "S256", "SSO redirect includes S256 PKCE");

  // Redirect 2 (still allowed within max=2), Redirect 3 MUST trip loop guard!
  await initiateSsoPkceRedirect({ wwwAuthenticate: null, bodyText: "", env });
  let tripped = false;
  try {
    await initiateSsoPkceRedirect({ wwwAuthenticate: null, bodyText: "", env });
  } catch (e) {
    tripped = e instanceof OAuthLoopGuardError;
  }
  ok(tripped && navigatedUrls.length === 2, "redirect loop guard blocks infinite SSO redirects");

  // Simulate callback return with ?code=...&state=...&iss=...&keep=1
  const savedPkce = JSON.parse(session.getItem(OAUTH_PKCE_SESSION_KEY));
  const expectedChallenge = await computeCodeChallengeS256(savedPkce.code_verifier);
  const secondAuthParams = new URL(navigatedUrls[1]).searchParams;
  ok(expectedChallenge === secondAuthParams.get("code_challenge"), "stored code_verifier matches redirected code_challenge");

  loc = {
    origin: "https://knotgate.labs.jb.gg",
    pathname: "/memory",
    search: `?code=unit_auth_code&state=${encodeURIComponent(savedPkce.state)}&iss=${encodeURIComponent("https://knotgate.labs.jb.gg/memory")}&keep=1`,
    hash: "#cosmos",
  };
  const cb = await processOAuthCallback(env);
  ok(cb.handled && !cb.error, "processOAuthCallback exchanges authorization code cleanly");
  ok(replacedUrl === "/memory?keep=1#cosmos", "processOAuthCallback strips code/state/iss while keeping app params & hash");
  ok(
    lastTokenBody.grant_type === "authorization_code" &&
      lastTokenBody.code === "unit_auth_code" &&
      lastTokenBody.code_verifier === savedPkce.code_verifier,
    "token exchange posts PKCE code_verifier",
  );
  ok(session.getItem(OAUTH_LOOP_GUARD_SESSION_KEY) === null, "successful callback resets redirect loop guard");

  // Refresh token rotation
  const refreshed = await refreshStoredTokens(env);
  ok(
    refreshed?.access_token === "test_access_v2" && refreshed?.refresh_token === "test_refresh_v2",
    "refreshStoredTokens rotates access_token and refresh_token",
  );
  const persisted = JSON.parse(local.getItem(OAUTH_TOKENS_STORAGE_KEY));
  ok(persisted.access_token === "test_access_v2", "rotated tokens persisted to localStorage");
}

// 4. stripOAuthCallbackParams edge case (empty remaining query)
{
  ok(
    stripOAuthCallbackParams("/travel/", "?code=abc&state=def&iss=https%3A%2F%2Fx", "") === "/travel/",
    "stripOAuthCallbackParams leaves no trailing ? when all params removed",
  );
}

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("\noauth: all green");
