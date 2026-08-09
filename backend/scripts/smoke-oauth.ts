// T-MEMORY-0xx SSO: OAuth connectors (Claude Code, ChatGPT) now authenticate
// through Marrow's own login (email+password, reusing existing session
// primitives) instead of a shared PROJECT_MEMORY_MAGIC_TOKEN -- an
// OAuth-issued access token is a real Marrow user's identity (JWT `sub` is
// that user's id, with a real 30-day `exp` claim), and the scope tier a call
// gets is resolved fresh from that user's CURRENT role on every request,
// exactly like a session or personal token. Covers: the new
// session-cookie-backed /oauth/authorize (GET redirects to the frontend
// origin, POST mints a code from a pmem_session), the JWT's real sub/exp
// claims, an admin-role user's OAuth token reaching an admin-tier tool
// (memory.delete) directly with no elevation header, a member-role user's
// OAuth token still getting INSUFFICIENT_SCOPE on the same tool, a stale/
// tampered/expired bearer being rejected outright (401, not silently
// downgraded), and gateway_clients.owner_user_id being attributed to the
// real OAuth-connected user -- plus the still-relevant protocol-level
// coverage from before this task (metadata endpoints, PKCE, one-time-use
// code, client auth methods, redirect_uri/resource handling). Also covers
// project.delete's own per-project owner gating (a member-role OAuth token
// is denied UNAUTHORIZED on a project it doesn't own; an admin-role OAuth
// token succeeds regardless of ownership, same as any other admin action).
import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { createAuthFacade, hashPassword, hashToken } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const db = createPgKnex();
const service = new PgToolService(db);
const auth = createAuthFacade(db);
const unique = Date.now();
const staticToken = `oauth-smoke-static-${unique}`;
const publicUrl = "https://pmem-smoke.example/api";
const mcpResourceUrl = `${publicUrl}/mcp`;
const redirectUri = "https://chatgpt.com/connector/oauth/pmem-smoke";
const clientId = `chatgpt-smoke-${unique}`;
const clientSecret = `chatgpt-smoke-secret-${unique}`;
const pmemClientId = `oauth-smoke-client-${unique}`;

// A second, independent oauth_clients row for the SAME admin user --
// exercises the per-connector credential rewrite (T-MEMORY-0xx follow-up):
// owner_user_id is no longer UNIQUE, so a user can hold many credentials,
// each with its own redirect_uri, and regenerating/deleting one must never
// touch another. redirectUriB is deliberately NOT on the static
// PROJECT_MEMORY_ALLOWED_REDIRECT_URIS allowlist (redirectUri, above) --
// only credential B's own stored redirect_uri column authorizes it.
const redirectUriB = "https://chatgpt.com/connector/oauth/pmem-smoke-b";
const clientIdB = `chatgpt-smoke-b-${unique}`;
const clientSecretB = `chatgpt-smoke-secret-b-${unique}`;
const credentialBId = randomUUID();

// A known keypair (not the facade's own internally-generated one) so this
// script can mint its own custom-signed JWTs -- needed to test "expired
// token rejected" without waiting 30 real days, and to know the exact `kid`
// to reuse. Only ever used by THIS script's own forged-token tests below;
// the facade's real issueJwt()/verifyJwt() are exercised normally
// everywhere else via the real HTTP endpoints.
const smokeKeyId = `oauth-smoke-key-${unique}`;
const { privateKey: smokePrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const smokePrivateKeyPem = smokePrivateKey.export({ type: "pkcs8", format: "pem" }).toString();

// PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET are gone -- oauth.ts no longer
// reads them at all. clientId/clientSecret below are instead seeded as a
// real oauth_clients row (owned by the admin user seeded just below),
// exactly the way a real user would self-generate one from their profile.
const oauth = createOAuthFacadeFromEnv({
  ...process.env,
  PROJECT_MEMORY_PUBLIC_URL: publicUrl,
  PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
  PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl,
  PROJECT_MEMORY_ALLOWED_REDIRECT_URIS: redirectUri,
  PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS: "300",
  PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM: smokePrivateKeyPem,
  PROJECT_MEMORY_OAUTH_KEY_ID: smokeKeyId
}, db);

assert(oauth, "OAuth facade was not created.");

const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  oauth,
  auth
});

const adminEmail = `oauth-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-oauth-admin-password-1";
const memberEmail = `oauth-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-oauth-member-password-1";

let adminUserId: string | undefined;
let memberUserId: string | undefined;
let projectIdForMemberDenial: string | undefined;
let projectIdForAdminDelete: string | undefined;

try {
  const now = new Date();
  adminUserId = randomUUID();
  await db("users").insert({
    id: adminUserId,
    email: adminEmail,
    password_hash: await hashPassword(adminPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "admin",
    status: "active",
    created_at: now,
    updated_at: now
  });
  memberUserId = randomUUID();
  await db("users").insert({
    id: memberUserId,
    email: memberEmail,
    password_hash: await hashPassword(memberPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  console.log("ok - admin and member accounts seeded");

  // Per-user OAuth connector credential (replaces the old static,
  // PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair) -- owned by the admin user
  // seeded above, same as any real user would self-generate one from their
  // own profile page. Ownership of the credential is independent of WHO
  // logs in through it: both the admin and member sessions below complete
  // /oauth/authorize using this same client_id/secret pair, exactly as the
  // design intends (the app credential and the logged-in identity are two
  // separate things -- see oauth.ts's authenticateOAuthClient).
  await db("oauth_clients").insert({
    id: randomUUID(),
    owner_user_id: adminUserId,
    client_id: clientId,
    client_secret_hash: hashToken(clientSecret),
    client_secret_hint: clientSecret.slice(-4),
    created_at: now,
    last_used_at: null
  });
  console.log("ok - oauth_clients row seeded for the admin user (replaces the old static client env vars)");

  // A second, independent credential (own label + redirect_uri) for the
  // same admin user -- proves the "one row per connector" model: this row
  // is unrelated to the one seeded just above, and neither regenerating nor
  // deleting it should ever touch the other (asserted further down).
  await db("oauth_clients").insert({
    id: credentialBId,
    owner_user_id: adminUserId,
    client_id: clientIdB,
    client_secret_hash: hashToken(clientSecretB),
    client_secret_hint: clientSecretB.slice(-4),
    label: "ChatGPT (smoke)",
    redirect_uri: redirectUriB,
    created_at: now,
    last_used_at: null
  });
  console.log("ok - a second, independent oauth_clients row seeded for the same admin user (per-connector credentials)");

  // --- Metadata endpoints (unaffected by the SSO change) -----------------
  const protectedResource = await getJson(`${started.url}/.well-known/oauth-protected-resource`);
  assert(readNestedString(protectedResource, ["resource"]) === publicUrl, "Protected resource metadata returned the wrong resource.");
  assert(
    readNestedArray(protectedResource, ["authorization_servers"]).includes(publicUrl),
    "Protected resource metadata did not list the issuer."
  );
  const mcpProtectedResource = await getJson(`${started.url}/.well-known/oauth-protected-resource/api/mcp`);
  assert(
    readNestedString(mcpProtectedResource, ["resource"]) === mcpResourceUrl,
    "MCP protected resource metadata returned the wrong resource."
  );
  console.log("ok - oauth protected resource metadata");

  const authorizationServer = await getJson(`${started.url}/.well-known/oauth-authorization-server`);
  assert(
    readNestedString(authorizationServer, ["authorization_endpoint"]) === `${publicUrl}/oauth/authorize`,
    "Authorization metadata returned the wrong authorize endpoint."
  );
  assert(
    readNestedArray(authorizationServer, ["token_endpoint_auth_methods_supported"]).includes("client_secret_post"),
    "Authorization metadata did not advertise client_secret_post."
  );
  assert(
    readNestedArray(authorizationServer, ["token_endpoint_auth_methods_supported"]).includes("client_secret_basic"),
    "Authorization metadata did not advertise client_secret_basic."
  );
  console.log("ok - oauth authorization server metadata");

  const jwks = await getJson(`${started.url}/.well-known/jwks.json`);
  assert(readNestedArray(jwks, ["keys"]).length === 1, "JWKS did not return exactly one key.");
  console.log("ok - oauth jwks");

  const unauthorized = await postJson(`${started.url}/call?client_id=${pmemClientId}`, { tool: "gateway.status", input: {} });
  assert(unauthorized.status === 401, "Missing auth did not return HTTP 401.");
  assert(
    unauthorized.headers.get("www-authenticate")?.includes("/.well-known/oauth-protected-resource"),
    "Missing auth did not return OAuth resource metadata challenge."
  );
  console.log("ok - oauth auth challenge");

  // --- GET /oauth/authorize: validates params, then 302s to the FRONTEND
  // origin (not a backend HTML form anymore) -----------------------------
  const codeVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const authorizeUrl = new URL(`${started.url}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "memory:read memory:write");
  authorizeUrl.searchParams.set("state", "oauth-smoke-state");
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("resource", publicUrl);

  const getRedirect = await fetch(authorizeUrl, { redirect: "manual" });
  assert(getRedirect.status === 302, `GET /oauth/authorize should redirect. Status: ${getRedirect.status}`);
  const getRedirectLocation = getRedirect.headers.get("location");
  assert(getRedirectLocation, "GET /oauth/authorize redirect missing Location.");
  const frontendRedirect = new URL(getRedirectLocation!);
  assert(
    frontendRedirect.origin === new URL(publicUrl).origin && frontendRedirect.pathname === "/oauth/authorize",
    `GET /oauth/authorize should redirect to the frontend's own /oauth/authorize (same origin, root path). Got: ${frontendRedirect.toString()}`
  );
  assert(
    frontendRedirect.searchParams.get("client_id") === clientId && frontendRedirect.searchParams.get("state") === "oauth-smoke-state",
    "GET /oauth/authorize redirect did not preserve the original query params."
  );
  console.log("ok - GET /oauth/authorize 302s to the frontend origin with the original query string, no HTML form");

  const wrongClientAuthorizeUrl = new URL(authorizeUrl);
  wrongClientAuthorizeUrl.searchParams.set("client_id", "wrong-client");
  const wrongClientAuthorizeGet = await fetch(wrongClientAuthorizeUrl, { redirect: "manual" });
  assert(wrongClientAuthorizeGet.status === 400, "Unexpected client_id did not return HTTP 400.");
  console.log("ok - oauth client_id allowlist enforced on GET /oauth/authorize");

  // --- POST /oauth/authorize: session-cookie-backed now, no magic token --
  const noSessionAuthorize = await postAuthorize(authorizeUrl, undefined);
  assert(noSessionAuthorize.status === 401, `POST /oauth/authorize without a session should be 401. Status: ${noSessionAuthorize.status}`);
  console.log("ok - POST /oauth/authorize without a pmem_session is rejected (401), no magic token accepted anywhere");

  const adminCookie = await loginSession(adminEmail, adminPassword);
  const memberCookie = await loginSession(memberEmail, memberPassword);
  console.log("ok - real Marrow sessions established for the admin and member accounts");

  const adminCode = await requestAuthorizationCode(authorizeUrl, adminCookie, "oauth-smoke-admin-state");
  console.log("ok - oauth authorization code minted from a real admin session (no magic token)");

  const missingSecret = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: adminCode,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(missingSecret.status === 401, "Missing OAuth client_secret did not fail.");
  console.log("ok - oauth client_secret required");

  const adminCode2 = await requestAuthorizationCode(authorizeUrl, adminCookie, "oauth-smoke-admin-state-2");
  const adminToken = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: adminCode2,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(adminToken.status === 200, `Token endpoint failed: ${JSON.stringify(adminToken.body)}`);
  const adminAccessToken = readNestedString(adminToken.body, ["access_token"]);
  assert(readNestedString(adminToken.body, ["token_type"]) === "Bearer", "Token endpoint did not return Bearer token.");
  const adminPayload = jwtPayload(adminAccessToken);
  assert(adminPayload.sub === adminUserId, `OAuth JWT sub should be the real admin userId. Got: ${JSON.stringify(adminPayload.sub)}`);
  const nowSeconds = Math.floor(Date.now() / 1000);
  assert(typeof adminPayload.exp === "number" && (adminPayload.exp as number) > nowSeconds, "OAuth access token is missing a real, future exp claim.");
  assert(
    (adminPayload.exp as number) - nowSeconds > 29 * 24 * 60 * 60,
    "OAuth access token's exp should reflect a ~30-day TTL."
  );
  console.log("ok - oauth token exchange: JWT sub is the real logged-in admin's userId, with a real ~30-day exp claim");

  const mcpResourceCode = await requestAuthorizationCode(
    (() => {
      const url = new URL(authorizeUrl);
      url.searchParams.set("resource", mcpResourceUrl);
      return url;
    })(),
    adminCookie,
    "oauth-smoke-mcp-resource-state"
  );
  const mcpResourceToken = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: mcpResourceCode,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: mcpResourceUrl
  });
  assert(mcpResourceToken.status === 200, `MCP resource token endpoint failed: ${JSON.stringify(mcpResourceToken.body)}`);
  const mcpResourceAccessToken = readNestedString(mcpResourceToken.body, ["access_token"]);
  assert(jwtPayload(mcpResourceAccessToken).aud === mcpResourceUrl, "MCP resource token used the wrong audience.");
  console.log("ok - oauth MCP resource token exchange");

  // --- Member's own OAuth token (real per-user identity) ------------------
  const memberCode = await requestAuthorizationCode(authorizeUrl, memberCookie, "oauth-smoke-member-state");
  const memberToken = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: memberCode,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(memberToken.status === 200, `Member token endpoint failed: ${JSON.stringify(memberToken.body)}`);
  const memberAccessToken = readNestedString(memberToken.body, ["access_token"]);
  assert(jwtPayload(memberAccessToken).sub === memberUserId, "OAuth JWT sub should be the real member userId.");
  console.log("ok - oauth token exchange: JWT sub is the real logged-in member's userId");

  // --- Reused code rejected -------------------------------------------------
  const reusedCode = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: adminCode2,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(reusedCode.status === 400, "Reused authorization code did not fail.");
  console.log("ok - oauth authorization code one-time use");

  const basicCode = await requestAuthorizationCode(authorizeUrl, adminCookie, "oauth-smoke-basic-state");
  const basicToken = await postFormJsonWithHeaders(
    `${started.url}/oauth/token`,
    { grant_type: "authorization_code", code: basicCode, redirect_uri: redirectUri, code_verifier: codeVerifier, resource: publicUrl },
    { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` }
  );
  assert(basicToken.status === 200, `Basic client auth token exchange failed: ${JSON.stringify(basicToken.body)}`);
  console.log("ok - oauth client_secret_basic token exchange");

  // --- Per-connector credential independence (multi-credential rewrite) ---
  // Credential B completes the full authorize+token flow on its own,
  // redirect_uri, using ONLY its own stored redirect_uri column (not on the
  // static allowlist) -- proves per-credential redirect_uri storage works,
  // not just the deployment-wide PROJECT_MEMORY_ALLOWED_REDIRECT_URIS
  // fallback.
  const bAuthorizeUrl = new URL(`${started.url}/oauth/authorize`);
  bAuthorizeUrl.searchParams.set("response_type", "code");
  bAuthorizeUrl.searchParams.set("client_id", clientIdB);
  bAuthorizeUrl.searchParams.set("redirect_uri", redirectUriB);
  bAuthorizeUrl.searchParams.set("scope", "memory:read memory:write");
  bAuthorizeUrl.searchParams.set("code_challenge", codeChallenge);
  bAuthorizeUrl.searchParams.set("code_challenge_method", "S256");
  bAuthorizeUrl.searchParams.set("resource", publicUrl);

  const bCode1 = await requestAuthorizationCode(bAuthorizeUrl, adminCookie, "oauth-smoke-b-state-1");
  const bToken1 = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: bCode1,
    redirect_uri: redirectUriB,
    client_id: clientIdB,
    client_secret: clientSecretB,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(bToken1.status === 200, `Credential B's own token exchange failed: ${JSON.stringify(bToken1.body)}`);
  console.log(
    "ok - a second, independent oauth_clients credential (its own redirect_uri, not on the static allowlist) completes /oauth/authorize + /oauth/token on its own"
  );

  // Credential A's client_id with credential B's redirect_uri is rejected --
  // redirect_uri is scoped to the specific credential row it's stored on,
  // not to any client_id that happens to ask.
  const crossClientAuthorizeUrl = new URL(authorizeUrl);
  crossClientAuthorizeUrl.searchParams.set("client_id", clientId);
  crossClientAuthorizeUrl.searchParams.set("redirect_uri", redirectUriB);
  crossClientAuthorizeUrl.searchParams.set("state", "oauth-smoke-cross-state");
  const crossClientGet = await fetch(crossClientAuthorizeUrl, { redirect: "manual" });
  assert(
    crossClientGet.status === 400,
    `Credential A's client_id with credential B's redirect_uri should be rejected. Status: ${crossClientGet.status}`
  );
  console.log("ok - a redirect_uri that only matches credential B's stored value is rejected for credential A's client_id");

  // --- Per-connector CRUD surface (session-cookie REST routes) ------------
  // GET lists every credential this user owns.
  const listResult = await cookieRequest("GET", "/auth/profile/oauth-clients", adminCookie);
  assert(listResult.status === 200, `GET oauth-clients failed: ${JSON.stringify(listResult.body)}`);
  const listedClientIds = (readNestedArray(listResult.body, ["data"]) as Array<Record<string, unknown>>).map((row) => row.clientId);
  assert(listedClientIds.includes(clientId), "GET oauth-clients did not include credential A.");
  assert(listedClientIds.includes(clientIdB), "GET oauth-clients did not include credential B.");
  console.log("ok - GET /auth/profile/oauth-clients lists every credential this user owns");

  // POST create requires both label and redirectUri.
  const missingFieldsCreate = await cookieRequest("POST", "/auth/profile/oauth-clients", adminCookie, { label: "Incomplete" });
  assert(missingFieldsCreate.status === 400, "POST oauth-clients without redirectUri should be rejected (400).");
  console.log("ok - POST /auth/profile/oauth-clients requires both label and redirectUri");

  // POST create makes a brand-new, independently-usable credential (credential C).
  const redirectUriC = "https://claude.ai/api/mcp/auth_callback";
  const createResult = await cookieRequest("POST", "/auth/profile/oauth-clients", adminCookie, {
    label: "Claude.ai (smoke)",
    redirectUri: redirectUriC
  });
  assert(createResult.status === 200, `POST oauth-clients failed: ${JSON.stringify(createResult.body)}`);
  const credentialCId = readNestedString(createResult.body, ["data", "id"]);
  const clientIdC = readNestedString(createResult.body, ["data", "clientId"]);
  const clientSecretC = readNestedString(createResult.body, ["data", "clientSecret"]);
  assert(readNestedString(createResult.body, ["data", "redirectUri"]) === redirectUriC, "Created credential did not echo back its redirectUri.");
  const cAuthorizeUrl = new URL(`${started.url}/oauth/authorize`);
  cAuthorizeUrl.searchParams.set("response_type", "code");
  cAuthorizeUrl.searchParams.set("client_id", clientIdC);
  cAuthorizeUrl.searchParams.set("redirect_uri", redirectUriC);
  cAuthorizeUrl.searchParams.set("scope", "memory:read memory:write");
  cAuthorizeUrl.searchParams.set("code_challenge", codeChallenge);
  cAuthorizeUrl.searchParams.set("code_challenge_method", "S256");
  cAuthorizeUrl.searchParams.set("resource", publicUrl);
  const cCode = await requestAuthorizationCode(cAuthorizeUrl, adminCookie, "oauth-smoke-c-state");
  const cToken = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: cCode,
    redirect_uri: redirectUriC,
    client_id: clientIdC,
    client_secret: clientSecretC,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(cToken.status === 200, `Freshly-created credential C's token exchange failed: ${JSON.stringify(cToken.body)}`);
  console.log("ok - POST /auth/profile/oauth-clients creates a new, independently-usable credential");

  // Regenerating credential B rotates only B's client_id/secret -- credential
  // A (and the just-created credential C) keep working entirely unchanged.
  const regenerateBResult = await cookieRequest("POST", `/auth/profile/oauth-clients/${credentialBId}/regenerate`, adminCookie);
  assert(regenerateBResult.status === 200, `Regenerate credential B failed: ${JSON.stringify(regenerateBResult.body)}`);
  const clientIdB2 = readNestedString(regenerateBResult.body, ["data", "clientId"]);
  const clientSecretB2 = readNestedString(regenerateBResult.body, ["data", "clientSecret"]);
  assert(clientIdB2 !== clientIdB, "Regenerate did not issue a new client_id for credential B.");

  // B's OLD client_id/secret no longer authorize.
  const bOldAuthorizeUrl = new URL(bAuthorizeUrl);
  bOldAuthorizeUrl.searchParams.set("state", "oauth-smoke-b-old-state");
  const bOldAuthorizeGet = await fetch(bOldAuthorizeUrl, { redirect: "manual" });
  assert(bOldAuthorizeGet.status === 400, "Credential B's old (pre-regenerate) client_id should no longer be allowed.");

  // B's NEW client_id/secret work, still against B's own stored redirect_uri.
  const bNewAuthorizeUrl = new URL(`${started.url}/oauth/authorize`);
  bNewAuthorizeUrl.searchParams.set("response_type", "code");
  bNewAuthorizeUrl.searchParams.set("client_id", clientIdB2);
  bNewAuthorizeUrl.searchParams.set("redirect_uri", redirectUriB);
  bNewAuthorizeUrl.searchParams.set("scope", "memory:read memory:write");
  bNewAuthorizeUrl.searchParams.set("code_challenge", codeChallenge);
  bNewAuthorizeUrl.searchParams.set("code_challenge_method", "S256");
  bNewAuthorizeUrl.searchParams.set("resource", publicUrl);
  const bCode2 = await requestAuthorizationCode(bNewAuthorizeUrl, adminCookie, "oauth-smoke-b-state-2");
  const bToken2 = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: bCode2,
    redirect_uri: redirectUriB,
    client_id: clientIdB2,
    client_secret: clientSecretB2,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(bToken2.status === 200, `Credential B's regenerated token exchange failed: ${JSON.stringify(bToken2.body)}`);

  // Credential A's original client_id/secret (seeded before B even existed)
  // still work, completely unaffected by B's regenerate.
  const aCode3 = await requestAuthorizationCode(authorizeUrl, adminCookie, "oauth-smoke-a-after-b-regen-state");
  const aToken3 = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: aCode3,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(aToken3.status === 200, `Credential A's token exchange after regenerating B failed: ${JSON.stringify(aToken3.body)}`);
  console.log("ok - regenerating credential B rotates only B's client_id/secret; credential A keeps working unchanged");

  // Deleting credential B leaves credential A (and C) intact.
  const deleteBResult = await cookieRequest("DELETE", `/auth/profile/oauth-clients/${credentialBId}`, adminCookie);
  assert(deleteBResult.status === 200, `Delete credential B failed: ${JSON.stringify(deleteBResult.body)}`);
  const bGoneRow = await db("oauth_clients").where({ id: credentialBId }).first();
  assert(!bGoneRow, "Credential B row still exists after delete.");

  const bDeletedAuthorizeUrl = new URL(bNewAuthorizeUrl);
  bDeletedAuthorizeUrl.searchParams.set("state", "oauth-smoke-b-deleted-state");
  const bDeletedAuthorizeGet = await fetch(bDeletedAuthorizeUrl, { redirect: "manual" });
  assert(bDeletedAuthorizeGet.status === 400, "Deleted credential B's client_id should no longer be allowed.");

  const aCode4 = await requestAuthorizationCode(authorizeUrl, adminCookie, "oauth-smoke-a-after-b-delete-state");
  const aToken4 = await postFormJson(`${started.url}/oauth/token`, {
    grant_type: "authorization_code",
    code: aCode4,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
    resource: publicUrl
  });
  assert(aToken4.status === 200, `Credential A's token exchange after deleting B failed: ${JSON.stringify(aToken4.body)}`);
  console.log("ok - deleting credential B leaves credential A intact and working");

  // Delete is ownership-scoped: the member can't delete the admin's credential C.
  const foreignDelete = await cookieRequest("DELETE", `/auth/profile/oauth-clients/${credentialCId}`, memberCookie);
  assert(foreignDelete.status === 404, `A non-owner deleting another user's credential should get NOT_FOUND (404). Status: ${foreignDelete.status}`);
  const cStillThere = await db("oauth_clients").where({ id: credentialCId }).first();
  assert(cStillThere, "Credential C was deleted by a non-owner request -- ownership check did not hold.");
  console.log("ok - regenerate/delete are ownership-scoped -- another user's session can't touch this credential (NOT_FOUND, existence not leaked)");

  // Clean up credential C explicitly (owner delete) so it doesn't linger for the rest of this run.
  const ownerDeleteC = await cookieRequest("DELETE", `/auth/profile/oauth-clients/${credentialCId}`, adminCookie);
  assert(ownerDeleteC.status === 200, `Owner delete of credential C failed: ${JSON.stringify(ownerDeleteC.body)}`);

  // --- Identity-driven scope resolution: the actual point of this task ----
  const projectA = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `oauth-smoke-member-${unique}`, title: "OAuth Smoke Member Denial" }, staticHeaders()))
  );
  projectIdForMemberDenial = projectA.project.id;
  const projectB = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `oauth-smoke-admin-${unique}`, title: "OAuth Smoke Admin Delete" }, staticHeaders()))
  );
  projectIdForAdminDelete = projectB.project.id;

  // project.delete moved from access:"admin" to access:"write" (the
  // per-project owner concept: ownership, not a blanket admin-tier gate,
  // now decides who may delete -- see assertProjectOwnerOrAdmin in
  // projects-core.mixin.ts), so it's no longer a generic admin-tier probe.
  // memory.delete stays access:"admin" unconditionally, so it's used here
  // instead to prove the actual point of this section: a member-role OAuth
  // token is still denied on a genuinely admin-tier tool, no elevation
  // involved. Common-scope (project: null) so this is unaffected by any
  // project-membership/ownership logic either.
  const memoryForMemberDenial = expectData<{ item: { id: string } }>(
    unwrap(await callTool("memory.create", { common: true, type: "note", title: "OAuth Smoke Member Denial", body: "probe" }, staticHeaders()))
  );
  const memberDelete = await callTool("memory.delete", { id: memoryForMemberDenial.item.id }, oauthHeaders(memberAccessToken));
  assert(
    memberDelete.status === 403,
    `A member-role user's OAuth token must still be denied on an admin-tier tool. Status: ${memberDelete.status}`
  );
  assert(
    readNestedString(memberDelete.json, ["error", "code"]) === "INSUFFICIENT_SCOPE",
    `Member OAuth admin-tier denial should be INSUFFICIENT_SCOPE. Body: ${JSON.stringify(memberDelete.json)}`
  );
  const memoryStillThere = await db("items").where({ id: memoryForMemberDenial.item.id }).first();
  assert(memoryStillThere, "Memory item must survive a denied member-OAuth memory.delete attempt.");
  await callTool("memory.delete", { id: memoryForMemberDenial.item.id }, staticHeaders());
  console.log("ok - a member-role user's OAuth token gets INSUFFICIENT_SCOPE on an admin-tier tool (memory.delete), no elevation involved");

  // --- T-MEMORY-052: project-membership filtering must treat an OAuth
  // connector's real identity the same as that user's session/personal
  // token, not bypass it -- regression case for the gap where sessionRole
  // was never populated for OAuth, so a role=member caller's project.list
  // saw every project system-wide instead of just their own memberships.
  await db("project_members").insert({ project_id: projectIdForMemberDenial, user_id: memberUserId, created_at: new Date() });

  // project.delete itself, now owner-or-admin gated rather than a blanket
  // admin-tier tool: a member-role OAuth token, even as an actual member of
  // the project (just added above), still can't delete it since it isn't
  // the owner (owner_user_id is NULL here -- created via the static token,
  // no session identity -- so only a real system admin can).
  const memberProjectDelete = await callTool("project.delete", { id: projectIdForMemberDenial }, oauthHeaders(memberAccessToken));
  assert(memberProjectDelete.status === 200, `project.delete by a non-owner member should be a normal 200 tool response. Status: ${memberProjectDelete.status}`);
  assert(
    readNestedString(memberProjectDelete.json, ["error", "code"]) === "UNAUTHORIZED",
    `project.delete by a non-owner, non-admin OAuth token should fail with UNAUTHORIZED. Body: ${JSON.stringify(memberProjectDelete.json)}`
  );
  const projectAStillThere = await db("projects").where({ id: projectIdForMemberDenial }).first();
  assert(projectAStillThere, "Project must survive a denied member-OAuth project.delete attempt.");
  console.log("ok - a member-role user's OAuth token gets UNAUTHORIZED on project.delete for a project it doesn't own");

  const memberProjectList = await callTool("project.list", {}, oauthHeaders(memberAccessToken));
  const memberVisibleIds = (readNestedArray(memberProjectList.json, ["data", "projects"]) as Array<Record<string, unknown>>).map(
    (project) => project.id
  );
  assert(
    memberVisibleIds.includes(projectIdForMemberDenial),
    "Member OAuth token's project.list should include the project they're a member of."
  );
  assert(
    !memberVisibleIds.includes(projectIdForAdminDelete),
    "Member OAuth token's project.list must NOT include a project they were never added to -- T-MEMORY-052 regression."
  );
  console.log("ok - a member-role user's OAuth token is project-membership-filtered on project.list, exactly like their session/personal token (T-MEMORY-052)");

  // cascade:true -- project.create itself records a project.created event,
  // so a freshly created project already has one dependent row.
  const adminDelete = await callTool("project.delete", { id: projectIdForAdminDelete, cascade: true }, oauthHeaders(adminAccessToken));
  assert(
    adminDelete.status === 200 && readNestedBoolean(adminDelete.json, ["ok"]) === true,
    `An admin-role user's OAuth token should succeed on an admin-tier tool directly (no elevation header). Status: ${adminDelete.status}, body: ${JSON.stringify(adminDelete.json)}`
  );
  const projectBGone = await db("projects").where({ id: projectIdForAdminDelete }).first();
  assert(!projectBGone, "Admin OAuth project.delete did not actually delete the row.");
  projectIdForAdminDelete = undefined;
  console.log("ok - an admin-role user's OAuth token reaches an admin-tier tool (project.delete) directly -- role-derived scope, no elevation header needed");

  // --- Both still get read+write for ordinary tools -----------------------
  const memberWriteCall = await callTool("event.record", { project: null, type: "oauth-smoke.member-write-probe" }, oauthHeaders(memberAccessToken));
  assert(memberWriteCall.status === 200 && readNestedBoolean(memberWriteCall.json, ["ok"]) === true, "Member OAuth token should still get write-tier access.");
  const adminReadCall = await callTool("gateway.status", {}, oauthHeaders(adminAccessToken));
  assert(adminReadCall.status === 200 && readNestedBoolean(adminReadCall.json, ["ok"]) === true, "Admin OAuth token should still get read-tier access.");
  console.log("ok - both admin and member OAuth tokens still get ordinary read+write access to non-admin tools");

  await assertMcpWriteCall(`${pmemClientId}-mcp-write`, mcpResourceAccessToken);
  console.log("ok - oauth MCP write tools work over the real-identity access token");

  // --- gateway_clients.owner_user_id attribution ---------------------------
  const attributedClientId = `${pmemClientId}-attribution`;
  await callTool("gateway.status", {}, oauthHeaders(adminAccessToken, attributedClientId));
  const clientRow = await db("gateway_clients").where({ id: attributedClientId }).first();
  assert(clientRow, "gateway_clients row for the OAuth-driven client was not created.");
  assert(
    clientRow!.owner_user_id === adminUserId,
    `gateway_clients.owner_user_id should be the real admin userId behind the OAuth bearer. Got: ${JSON.stringify(clientRow!.owner_user_id)}`
  );
  console.log("ok - gateway_clients.owner_user_id is attributed to the real Marrow user behind an OAuth-sourced request");

  // --- Real web-connector shape: NO explicit client_id at all --------------
  // Claude.ai/ChatGPT never send x-project-memory-client-id or ?client_id=
  // (the login step itself identifies the caller -- see urlFor()'s comment
  // in front/src/pages/profile/index.tsx). Every OTHER call in this smoke
  // script goes through oauthHeaders(), which always sets that header, so
  // none of them exercised this path -- the actual bug (reported live: an
  // AI agent's own generated observation, I-MEMORY-053) shipped unnoticed.
  // A bare bearer with no client_id header must still resolve to a stable,
  // real-identity clientId (user:<id>), not a fresh anonymous:<requestId>
  // on every call.
  const bareOAuthHeaders = (bearer: string): Record<string, string> => ({ authorization: `Bearer ${bearer}` });
  await callTool("event.record", { project: null, type: "oauth-smoke.bare-probe-1" }, bareOAuthHeaders(adminAccessToken));
  const eventsAfterFirstBareCall = await db("events").where({ type: "oauth-smoke.bare-probe-1" }).orderBy("created_at", "desc").first();
  assert(eventsAfterFirstBareCall, "event.record over a bare OAuth bearer (no client_id) did not record an event.");
  assert(
    typeof eventsAfterFirstBareCall!.created_by === "string" && eventsAfterFirstBareCall!.created_by.startsWith("user:"),
    `A bare OAuth request's event should attribute to a real user:<id>, not anonymous. Got created_by: ${JSON.stringify(eventsAfterFirstBareCall!.created_by)}`
  );
  const bareClientId = eventsAfterFirstBareCall!.created_by as string;
  assert(bareClientId === `user:${adminUserId}`, `Expected bare OAuth clientId to be user:${adminUserId}. Got: ${bareClientId}`);
  console.log("ok - a bare OAuth request (no explicit client_id, matching a real Claude.ai/ChatGPT connector) attributes events to user:<id>, not anonymous");

  await callTool("event.record", { project: null, type: "oauth-smoke.bare-probe-2" }, bareOAuthHeaders(adminAccessToken));
  const bareClientRows = await db("gateway_clients").where({ id: bareClientId });
  assert(
    bareClientRows.length === 1,
    `A second bare OAuth call from the same user should reuse the same gateway_clients row (upsert), not create another. Rows for ${bareClientId}: ${bareClientRows.length}`
  );
  console.log("ok - a second bare OAuth request from the same user reuses the same gateway_clients row instead of creating a new anonymous one");

  // --- Fail closed on ambiguous/invalid identity ---------------------------
  const staleSubjectToken = signSmokeJwt({
    sub: "project-memory-user", // the old hardcoded literal -- never a real users.id
    scope: "memory:read memory:write",
    resource: publicUrl,
    expiresInSeconds: 3600
  });
  const staleSubjectCall = await callTool("gateway.status", {}, oauthHeaders(staleSubjectToken));
  assert(
    staleSubjectCall.status === 401,
    `An OAuth bearer whose sub doesn't resolve to a real active user must fail closed (401), not downgrade to write. Status: ${staleSubjectCall.status}`
  );
  console.log("ok - an OAuth bearer whose sub doesn't resolve to an active user is rejected (401), never silently downgraded to write");

  const disabledUserToken = signSmokeJwt({
    sub: memberUserId!,
    scope: "memory:read memory:write",
    resource: publicUrl,
    expiresInSeconds: 3600
  });
  await db("users").where({ id: memberUserId }).update({ status: "disabled" });
  const disabledUserCall = await callTool("gateway.status", {}, oauthHeaders(disabledUserToken));
  assert(disabledUserCall.status === 401, `A disabled user's OAuth token must be rejected (401). Status: ${disabledUserCall.status}`);
  await db("users").where({ id: memberUserId }).update({ status: "active" });
  console.log("ok - an OAuth bearer for a since-disabled account is rejected (401) immediately, no caching of the old role");

  const expiredToken = signSmokeJwt({
    sub: adminUserId!,
    scope: "memory:read memory:write",
    resource: publicUrl,
    expiresInSeconds: -3600
  });
  const expiredCall = await callTool("gateway.status", {}, oauthHeaders(expiredToken));
  assert(expiredCall.status === 401, `An expired OAuth JWT must be rejected (401). Status: ${expiredCall.status}`);
  console.log("ok - an expired OAuth JWT (real exp claim in the past) is rejected");

  const tamperedToken = `${adminAccessToken.slice(0, -4)}${adminAccessToken.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
  const tamperedCall = await callTool("gateway.status", {}, oauthHeaders(tamperedToken));
  assert(tamperedCall.status === 401, `A tampered OAuth JWT signature must be rejected (401). Status: ${tamperedCall.status}`);
  console.log("ok - a tampered OAuth JWT (corrupted signature) is rejected");

  const staticCall = await callTool("gateway.status", {}, staticHeaders());
  assert(staticCall.status === 200, "Static bearer token no longer authorizes gateway calls.");
  console.log("ok - static bearer still works");

  console.log(`OAuth smoke test passed using ${started.url}`);
} finally {
  await db("events").where("type", "like", "oauth-smoke.%").del();
  if (projectIdForMemberDenial) {
    await db("events").where({ project_id: projectIdForMemberDenial }).del();
    await db("projects").where({ id: projectIdForMemberDenial }).del();
  }
  if (projectIdForAdminDelete) {
    await db("events").where({ project_id: projectIdForAdminDelete }).del();
    await db("projects").where({ id: projectIdForAdminDelete }).del();
  }
  if (adminUserId) {
    await db("oauth_clients").where({ owner_user_id: adminUserId }).del();
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  if (memberUserId) {
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  await db("gateway_clients").where("id", "like", `${pmemClientId}%`).del();
  await started.stop();
  await service.close();
}

async function loginSession(email: string, password: string): Promise<string> {
  const response = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert(response.status === 200, `Login for ${email} failed. Status: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, `Login for ${email} did not set a session cookie.`);
  return cookie!;
}

async function postAuthorize(authorizeUrl: URL, cookie: string | undefined): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${started.url}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(Object.fromEntries(authorizeUrl.searchParams.entries()))
  });
  return { status: response.status, body: await response.json() };
}

async function requestAuthorizationCode(authorizeUrl: URL, cookie: string, state: string): Promise<string> {
  const url = new URL(authorizeUrl);
  url.searchParams.set("state", state);
  const result = await postAuthorize(url, cookie);
  assert(result.status === 200, `POST /oauth/authorize with a valid session should succeed. Status: ${result.status}, body: ${JSON.stringify(result.body)}`);
  const redirectUriWithCode = readNestedString(result.body, ["data", "redirectUri"]);
  const redirect = new URL(redirectUriWithCode);
  const code = redirect.searchParams.get("code");
  assert(code, "Authorize response's redirectUri did not include a code.");
  assert(redirect.searchParams.get("state") === state, "Authorize response's redirectUri did not preserve state.");
  return code!;
}

// A raw RS256 JWT signed with this script's OWN known key (see
// PROJECT_MEMORY_OAUTH_PRIVATE_KEY_PEM above), matching the exact shape
// issueJwt() in oauth.ts produces -- used only to construct forged/expired
// bearers that could never come from the real /oauth/token endpoint, to
// test that verifyJwt()/the resolveOAuthOwner fail-closed paths reject them.
function signSmokeJwt(options: { sub: string; scope: string; resource: string; expiresInSeconds: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: "RS256", typ: "JWT", kid: smokeKeyId });
  const payload = base64urlJson({
    iss: publicUrl,
    aud: options.resource,
    sub: options.sub,
    client_id: clientId,
    scope: options.scope,
    iat: now,
    exp: now + options.expiresInSeconds,
    jti: randomUUID()
  });
  const signingInput = `${header}.${payload}`;
  const key = createPrivateKey(smokePrivateKeyPem);
  const signature = base64url(sign("RSA-SHA256", Buffer.from(signingInput), key));
  return `${signingInput}.${signature}`;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert(response.ok, `GET ${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function postJson(url: string, body: unknown, bearer?: string): Promise<{ status: number; headers: Headers; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

// Session-cookie request helper for the /auth/profile/oauth-clients* REST
// CRUD surface (list/create/regenerate/delete) -- these routes are gated on
// sessionAuth (a real Marrow login), never a bearer token, same convention
// as loginSession/postAuthorize above.
async function cookieRequest(
  method: string,
  path: string,
  cookie: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${started.url}${path}`, {
    method,
    headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

async function postFormJson(url: string, body: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  return { status: response.status, body: await response.json() };
}

async function postFormJsonWithHeaders(
  url: string,
  body: Record<string, string>,
  headers: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body)
  });
  return { status: response.status, body: await response.json() };
}

function staticHeaders(): Record<string, string> {
  return { authorization: `Bearer ${staticToken}`, "x-project-memory-client-label": "OAuth Smoke Static" };
}

function oauthHeaders(bearer: string, explicitClientId?: string): Record<string, string> {
  return {
    authorization: `Bearer ${bearer}`,
    "x-project-memory-client-id": explicitClientId ?? pmemClientId,
    "x-project-memory-client-label": "OAuth Smoke Agent"
  };
}

async function callTool(tool: string, input: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ tool, input })
  });
  return { status: response.status, json: await response.json() };
}

async function assertMcpWriteCall(mcpClientId: string, bearerToken: string): Promise<void> {
  const endpoint = new URL(`${started.url}/mcp`);
  endpoint.searchParams.set("client_id", mcpClientId);
  endpoint.searchParams.set("client_label", "OAuth Smoke MCP Client");
  endpoint.searchParams.set("client_kind", "oauth-smoke");
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${bearerToken}` } }
  });
  const client = new Client({ name: "project-memory-oauth-smoke", version: "0.1.0" });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "event.record",
      arguments: { project: null, type: "oauth-smoke.mcp-write-probe" }
    });
    assert(readNestedBoolean(result.structuredContent, ["ok"]) === true, "MCP write tool did not execute.");
  } finally {
    await client.close();
  }
}

function unwrap(result: { status: number; json: unknown }): { ok: true; data: unknown } | { ok: false; error: { message: string } } {
  assert(result.status === 200, `Expected a 200 tool response, got HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json as { ok: true; data: unknown } | { ok: false; error: { message: string } };
}

function expectData<T>(response: { ok: true; data: unknown } | { ok: false; error: { message: string } }): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlJson(value: Record<string, unknown>): string {
  return base64url(Buffer.from(JSON.stringify(value)));
}

function jwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  assert(payload, "JWT did not include a payload.");
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<string, unknown>;
}

function readNestedString(value: unknown, path: string[]): string {
  const current = readNested(value, path);
  assert(typeof current === "string", `Expected string at ${path.join(".")}.`);
  return current;
}

function readNestedBoolean(value: unknown, path: string[]): boolean {
  const current = readNested(value, path);
  assert(typeof current === "boolean", `Expected boolean at ${path.join(".")}.`);
  return current;
}

function readNestedArray(value: unknown, path: string[]): unknown[] {
  const current = readNested(value, path);
  assert(Array.isArray(current), `Expected array at ${path.join(".")}.`);
  return current;
}

function readNested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    assert(isRecord(current), `Expected object while reading ${path.join(".")}.`);
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
