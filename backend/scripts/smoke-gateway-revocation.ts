// SEC-9 (T-MEMORY-173): revoking things must actually revoke.
//  - deleting or regenerating an OAuth connector kills the access tokens
//    already minted from it (they are stateless 30-day JWTs);
//  - changing the password kills the user's OTHER sessions (the one making
//    the change survives).
// Same style as the other gateway smokes (ephemeral local gateway, real
// Postgres -- point POSTGRES_* at a DEDICATED test database).
import { createHash, randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword, hashToken } from "../src/gateway/auth.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const unique = Date.now();
const db = createPgKnex();
const service = new PgToolService(db);
const auth = createAuthFacade(db);
const publicUrl = "https://pmem-revocation-smoke.example/api";
const redirectUri = "https://claude.ai/connector/oauth/pmem-revocation-smoke";
const oauth = createOAuthFacadeFromEnv(
  {
    ...process.env,
    PROJECT_MEMORY_PUBLIC_URL: publicUrl,
    PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
    PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl,
    PROJECT_MEMORY_ALLOWED_REDIRECT_URIS: redirectUri,
    PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS: "300"
  },
  db
);
assert(oauth, "OAuth facade was not created.");
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: `gateway-revocation-smoke-static-${unique}`,
  oauth,
  auth
});

const email = `gateway-revocation-smoke-${unique}@example.test`;
const password = "smoke-revocation-password-1";
const newPassword = "smoke-revocation-password-2";
let userId: string | undefined;

try {
  const now = new Date();
  userId = randomUUID();
  await db("users").insert({
    id: userId, email, password_hash: await hashPassword(password), email_verified_at: now,
    totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });

  // ---- OAuth connector revocation -----------------------------------------
  const cookie = await login(email, password);
  const clientA = await seedClient("a");
  const tokenA = await mintOAuthAccessToken(cookie, clientA);
  assert((await bearerCall(tokenA)) === 200, "A freshly minted OAuth token must work.");
  console.log("ok - OAuth token works while its connector exists");

  await db("oauth_clients").where({ client_id: clientA.clientId }).del();
  assert((await bearerCall(tokenA)) === 401, "A token minted from a DELETED connector must stop working.");
  console.log("ok - deleting a connector revokes the tokens minted from it");

  const clientB = await seedClient("b");
  const tokenB = await mintOAuthAccessToken(cookie, clientB);
  assert((await bearerCall(tokenB)) === 200, "Token from connector B must work before regeneration.");
  await auth.regenerateOAuthClient(userId, clientB.rowId);
  assert((await bearerCall(tokenB)) === 401, "A token minted before REGENERATING the connector must stop working.");
  console.log("ok - regenerating a connector revokes the tokens minted before");

  const clientC = await seedClient("c");
  const tokenC = await mintOAuthAccessToken(cookie, clientC);
  const otherClient = await seedClient("other");
  await db("oauth_clients").where({ client_id: otherClient.clientId }).del();
  assert((await bearerCall(tokenC)) === 200, "Deleting an UNRELATED connector must not revoke this one.");
  console.log("ok - revocation is per connector (an unrelated deletion leaves other tokens alone)");

  // ---- Sessions ------------------------------------------------------------
  const session1 = await login(email, password);
  const session2 = await login(email, password);
  assert((await meStatus(session1)) === 200 && (await meStatus(session2)) === 200, "Both sessions must work before the change.");
  const change = await fetch(`${started.url}/auth/profile/password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: session1 },
    body: JSON.stringify({ currentPassword: password, newPassword })
  });
  assert(change.status === 200, `Password change failed: ${change.status}`);
  assert((await meStatus(session1)) === 200, "The session that changed the password must survive.");
  assert((await meStatus(session2)) === 401, "Another session must be revoked by a password change.");
  assert((await meStatus(cookie)) === 401, "The earlier login session must be revoked by a password change.");
  console.log("ok - changing the password revokes the user's other sessions, keeps the current one");
  const relogin = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: newPassword })
  });
  assert(relogin.status === 200, "Logging in with the new password must work.");
} finally {
  if (userId) {
    await db("oauth_clients").where({ owner_user_id: userId }).del();
    await db("sessions").where({ user_id: userId }).del();
    await db("users").where({ id: userId }).del();
  }
  await started.stop();
  await service.close();
}

type SeededClient = { rowId: string; clientId: string; clientSecret: string };

async function seedClient(name: string): Promise<SeededClient> {
  const rowId = randomUUID();
  const clientId = `revocation-smoke-client-${name}-${unique}`;
  const clientSecret = `revocation-smoke-secret-${name}-${unique}`;
  await db("oauth_clients").insert({
    id: rowId, owner_user_id: userId, client_id: clientId, client_secret_hash: hashToken(clientSecret),
    client_secret_hint: clientSecret.slice(-4), redirect_uri: redirectUri, created_at: new Date(), last_used_at: null
  });
  return { rowId, clientId, clientSecret };
}

async function bearerCall(bearer: string): Promise<number> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ tool: "project.list", input: {} })
  });
  return response.status;
}

async function meStatus(cookie: string): Promise<number> {
  return (await fetch(`${started.url}/auth/me`, { headers: { cookie } })).status;
}

async function login(loginEmail: string, loginPassword: string): Promise<string> {
  const response = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: loginEmail, password: loginPassword })
  });
  assert(response.status === 200, `Login failed. Status: ${response.status}`);
  const raw = response.headers.get("set-cookie");
  assert(raw, "Login did not set a session cookie.");
  return raw!.split(";")[0]!;
}

async function mintOAuthAccessToken(sessionCookie: string, client: SeededClient): Promise<string> {
  const codeVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const codeChallenge = createHash("sha256").update(codeVerifier).digest().toString("base64url");
  const authorize = await fetch(`${started.url}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({
      response_type: "code", client_id: client.clientId, redirect_uri: redirectUri, scope: "memory:read memory:write",
      state: "revocation-smoke", code_challenge: codeChallenge, code_challenge_method: "S256", resource: publicUrl
    })
  });
  const authorizeBody = (await authorize.json()) as { data?: { redirectUri?: string } };
  assert(authorize.status === 200 && authorizeBody.data?.redirectUri, `OAuth authorize failed: ${JSON.stringify(authorizeBody)}`);
  const code = new URL(authorizeBody.data!.redirectUri!).searchParams.get("code");
  assert(code, "OAuth authorize redirect missing code.");
  const tokenResponse = await fetch(`${started.url}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code: code!, redirect_uri: redirectUri, client_id: client.clientId,
      client_secret: client.clientSecret, code_verifier: codeVerifier, resource: publicUrl
    })
  });
  assert(tokenResponse.status === 200, `OAuth token exchange failed: ${tokenResponse.status}`);
  const tokenBody = (await tokenResponse.json()) as { access_token?: string };
  assert(tokenBody.access_token, "OAuth token exchange did not return an access_token.");
  return tokenBody.access_token!;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
