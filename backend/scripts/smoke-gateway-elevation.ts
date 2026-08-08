// T-MEMORY-041 / D-MEMORY-019: step-up admin elevation, end to end against
// the real gateway (ephemeral local instance, real Postgres) -- same style
// as scripts/smoke-gateway-scopes.ts (which owns the read/write/admin tier
// model this extends) and scripts/smoke-oauth.ts (which owns minting a real
// OAuth bearer token, reused here for the "OAuth read+write credential asks
// for a step-up" scenario this task is actually about).
//
// Covers the acceptance criteria: elevation granted for a correct
// password+TOTP code, denied for a wrong code, denied on reuse of an
// already-consumed grant, denied for a member-role account, denied once a
// grant has expired, and -- as a regression check on the code path this
// task modified -- an OAuth admin-tier call with no elevation header at all
// is still denied exactly like before this task (D-MEMORY-017 decision 2
// is unchanged; elevation is an additional narrow door, not a replacement).
import { createHash, createHmac, randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword, hashToken } from "../src/gateway/auth.js";
import { base32Decode, base32Encode, encryptSecret, generateTotpSecret } from "../src/gateway/totp.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

// TOTP_ENC_KEY must be set before any TOTP-touching code runs (it's read
// lazily by src/gateway/totp.ts on each call, not at import time) -- same
// pattern as scripts/smoke-gateway-registration.ts.
if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const db = createPgKnex();
const service = new PgToolService(db);
const auth = createAuthFacade(db);

const unique = Date.now();
const staticToken = `gateway-elevation-smoke-static-${unique}`;
const publicUrl = "https://pmem-elevation-smoke.example/api";
const redirectUri = "https://claude.ai/connector/oauth/pmem-elevation-smoke";
const oauthClientId = `elevation-smoke-oauth-client-${unique}`;
const oauthClientSecret = `elevation-smoke-oauth-secret-${unique}`;
const pmemClientId = `elevation-smoke-agent-${unique}`;

// PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET are gone -- oauth.ts no longer
// reads them at all. oauthClientId/oauthClientSecret below are instead
// seeded as a real oauth_clients row (owned by the admin user seeded just
// below) once that user exists, same as scripts/smoke-oauth.ts.
const oauth = createOAuthFacadeFromEnv({
  ...process.env,
  PROJECT_MEMORY_PUBLIC_URL: publicUrl,
  PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
  PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl,
  PROJECT_MEMORY_ALLOWED_REDIRECT_URIS: redirectUri,
  PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS: "300"
}, db);
assert(oauth, "OAuth facade was not created.");

const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  oauth,
  auth
});

const adminEmail = `gateway-elevation-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-elevation-admin-password-1";
const memberEmail = `gateway-elevation-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-elevation-member-password-1";

let adminUserId: string | undefined;
let memberUserId: string | undefined;
let projectId: string | undefined;
let itemAId: string | undefined;
let itemBId: string | undefined;
let itemCId: string | undefined;
let adminTotpSecret: string;
let memberTotpSecret: string;

try {
  const now = new Date();
  adminTotpSecret = base32Encode(generateTotpSecret());
  adminUserId = randomUUID();
  await db("users").insert({
    id: adminUserId,
    email: adminEmail,
    password_hash: await hashPassword(adminPassword),
    email_verified_at: now,
    totp_secret: encryptSecret(adminTotpSecret),
    totp_enabled: true,
    role: "admin",
    status: "active",
    created_at: now,
    updated_at: now
  });

  memberTotpSecret = base32Encode(generateTotpSecret());
  memberUserId = randomUUID();
  await db("users").insert({
    id: memberUserId,
    email: memberEmail,
    password_hash: await hashPassword(memberPassword),
    email_verified_at: now,
    totp_secret: encryptSecret(memberTotpSecret),
    totp_enabled: true,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  console.log("ok - admin (2FA-enrolled) and member (2FA-enrolled) accounts seeded");

  // Per-user OAuth connector credential (replaces the old static,
  // PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair) -- owned by the admin user
  // seeded above; mintOAuthAccessToken below authorizes with it using the
  // MEMBER's session, exactly as the design intends (the app credential and
  // the logged-in identity are independent).
  await db("oauth_clients").insert({
    id: randomUUID(),
    owner_user_id: adminUserId,
    client_id: oauthClientId,
    client_secret_hash: hashToken(oauthClientSecret),
    client_secret_hint: oauthClientSecret.slice(-4),
    created_at: now,
    last_used_at: null
  });
  console.log("ok - oauth_clients row seeded for the admin user (replaces the old static client env vars)");

  // Seed a project + three memory items via the static admin-tier token --
  // one per admin-tier OAuth call below (delete is destructive, each probe
  // needs its own untouched row).
  const project = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `gateway-elevation-smoke-${unique}`, title: "Elevation Smoke" }, staticHeaders()))
  );
  projectId = project.project.id;
  itemAId = await createItem("A");
  itemBId = await createItem("B");
  itemCId = await createItem("C");

  // Real OAuth token for the MEMBER account (T-MEMORY-0xx SSO: an OAuth
  // bearer's scope tier now tracks its owning user's role, same as a
  // session -- an admin-role OAuth bearer would reach admin-tier tools
  // directly and never need this grant at all, which is exactly what
  // scripts/smoke-oauth.ts covers separately). Minting as the member
  // account keeps this script's actual subject -- the elevation
  // mechanism's step-up door for a non-admin credential -- meaningful.
  const memberSessionCookie = await loginSession(memberEmail, memberPassword, memberTotpSecret);
  const oauthAccessToken = await mintOAuthAccessToken(memberSessionCookie);
  console.log("ok - minted a read+write OAuth bearer token (member role), same as a Claude Code / ChatGPT connector would carry");

  // --- Regression: OAuth admin-tier call with no elevation header at all
  // is still denied exactly like before this task -----------------------
  const noHeaderDelete = await callTool("memory.delete", { id: itemAId }, oauthHeaders(oauthAccessToken));
  assert(
    noHeaderDelete.status === 403,
    `OAuth admin-tier call with no elevation header must still be denied. Status: ${noHeaderDelete.status}`
  );
  assertInsufficientScope(noHeaderDelete, "OAuth call with no elevation header");
  console.log("ok - OAuth bearer with no elevation header is still denied on memory.delete (D-MEMORY-017 decision 2 unchanged)");

  // --- Wrong password is rejected, nothing minted -----------------------
  const wrongPassword = await postJson(`${started.url}/auth/elevate`, {
    email: adminEmail,
    password: "not-the-real-password",
    code: currentTotpCode(adminTotpSecret)
  });
  assert(wrongPassword.status === 401, `Elevate with wrong password should be 401. Status: ${wrongPassword.status}`);
  console.log("ok - POST /auth/elevate rejects a wrong password");

  // --- Wrong TOTP code is rejected, nothing minted ------------------------
  const wrongCode = await postJson(`${started.url}/auth/elevate`, {
    email: adminEmail,
    password: adminPassword,
    code: "000000"
  });
  assert(wrongCode.status === 401, `Elevate with wrong TOTP code should be 401. Status: ${wrongCode.status}`);
  const wrongCodeBody = wrongCode.body as { error?: { message?: string } };
  assert(
    /verification code/i.test(wrongCodeBody.error?.message ?? ""),
    `Wrong-code rejection should name the code, not look like a password failure. Got: ${JSON.stringify(wrongCodeBody)}`
  );
  console.log("ok - POST /auth/elevate rejects a wrong TOTP code with a distinct message");

  // --- Member-role account cannot elevate, even with fully correct
  // password + current TOTP code ------------------------------------------
  const memberAttempt = await postJson(`${started.url}/auth/elevate`, {
    email: memberEmail,
    password: memberPassword,
    code: currentTotpCode(memberTotpSecret)
  });
  assert(
    memberAttempt.status === 401,
    `Elevate for a role=member account (correct credentials) should still be 401. Status: ${memberAttempt.status}`
  );
  const memberAttemptBody = memberAttempt.body as { error?: { message?: string } };
  assert(
    /admin/i.test(memberAttemptBody.error?.message ?? ""),
    `Member elevation denial should explain admin-only, got: ${JSON.stringify(memberAttemptBody)}`
  );
  console.log("ok - POST /auth/elevate rejects a role=member account even with fully correct password+TOTP");

  // --- Correct password + correct TOTP code mints a grant -----------------
  const grantResponse = await postJson(`${started.url}/auth/elevate`, {
    email: adminEmail,
    password: adminPassword,
    code: currentTotpCode(adminTotpSecret)
  });
  assert(grantResponse.status === 200, `Elevate with correct credentials should succeed. Status: ${grantResponse.status}, body: ${JSON.stringify(grantResponse.body)}`);
  const grantToken = readNestedString(grantResponse.body, ["data", "token"]);
  assert(grantToken.length > 0, "Elevate did not return a grant token.");
  console.log("ok - POST /auth/elevate mints a short-lived grant token for a correct admin password+TOTP code");

  // --- The grant, attached to the OAuth request, lets exactly one
  // admin-tier call through even though the bearer itself is read+write --
  const elevatedDelete = await callTool("memory.delete", { id: itemAId }, oauthHeaders(oauthAccessToken, grantToken));
  assert(
    elevatedDelete.status === 200,
    `OAuth call carrying a valid elevation grant should succeed on memory.delete. Status: ${elevatedDelete.status}, body: ${JSON.stringify(elevatedDelete.json)}`
  );
  const elevatedDeleteBody = elevatedDelete.json as ToolResponse<unknown>;
  assert(elevatedDeleteBody.ok === true, `Elevated OAuth memory.delete did not actually execute. ${JSON.stringify(elevatedDeleteBody)}`);
  const itemARow = await db("items").where({ id: itemAId }).first();
  assert(!itemARow, "Elevated OAuth memory.delete did not actually delete the row.");
  itemAId = undefined;
  console.log("ok - OAuth read+write bearer + valid elevation grant authorizes exactly the admin-tier call it was minted for");

  // --- Reuse of the same (now-consumed) grant is rejected ------------------
  const reusedGrant = await callTool("memory.delete", { id: itemBId }, oauthHeaders(oauthAccessToken, grantToken));
  assert(
    reusedGrant.status === 403,
    `Reusing an already-consumed elevation grant must be denied. Status: ${reusedGrant.status}`
  );
  assertInsufficientScope(reusedGrant, "reused elevation grant");
  const itemBRowAfterReuse = await db("items").where({ id: itemBId }).first();
  assert(itemBRowAfterReuse, "Item must survive a denied (reused-grant) delete attempt.");
  console.log("ok - a second admin-tier call reusing the same elevation grant is denied, single-use enforced");

  // --- An expired grant is rejected ---------------------------------------
  const expiredGrantResponse = await postJson(`${started.url}/auth/elevate`, {
    email: adminEmail,
    password: adminPassword,
    code: currentTotpCode(adminTotpSecret)
  });
  assert(expiredGrantResponse.status === 200, "Minting a second elevation grant (for the expiry test) failed.");
  const expiredGrantToken = readNestedString(expiredGrantResponse.body, ["data", "token"]);
  const backdated = new Date(Date.now() - 120 * 1000);
  const expiredRows = await db("admin_elevations")
    .where({ token_hash: sha256Hex(expiredGrantToken) })
    .update({ expires_at: backdated });
  assert(expiredRows === 1, "Could not backdate the elevation grant's expires_at for the expiry test.");

  const expiredCall = await callTool("memory.delete", { id: itemBId }, oauthHeaders(oauthAccessToken, expiredGrantToken));
  assert(expiredCall.status === 403, `An expired elevation grant must be denied. Status: ${expiredCall.status}`);
  assertInsufficientScope(expiredCall, "expired elevation grant");
  const itemBRowAfterExpiry = await db("items").where({ id: itemBId }).first();
  assert(itemBRowAfterExpiry, "Item must survive a denied (expired-grant) delete attempt.");
  console.log("ok - an expired elevation grant is denied even though it was never redeemed");

  // --- A garbage/unknown token in the header is denied, not a crash -------
  const garbageCall = await callTool("memory.delete", { id: itemCId }, oauthHeaders(oauthAccessToken, "not-a-real-grant-token"));
  assert(garbageCall.status === 403, `An unknown elevation token must be denied cleanly. Status: ${garbageCall.status}`);
  assertInsufficientScope(garbageCall, "unknown elevation token");
  console.log("ok - an unrecognized elevation token is denied cleanly (no 500, no bypass)");

  console.log(`Gateway elevation smoke test passed using ${started.url}`);
} finally {
  if (itemAId) {
    await db("items").where({ id: itemAId }).del();
  }
  if (itemBId) {
    await db("items").where({ id: itemBId }).del();
  }
  if (itemCId) {
    await db("items").where({ id: itemCId }).del();
  }
  if (projectId) {
    await db("events").where({ project_id: projectId }).del();
    await db("items").where({ project_id: projectId }).del();
    await db("projects").where({ id: projectId }).del();
  }
  if (adminUserId) {
    await db("oauth_clients").where({ owner_user_id: adminUserId }).del();
    await db("admin_elevations").where({ user_id: adminUserId }).del();
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  if (memberUserId) {
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  await db("gateway_clients").where({ id: pmemClientId }).del();
  await started.stop();
  await service.close();
}

async function createItem(label: string): Promise<string> {
  const created = expectData<{ item: { id: string } }>(
    unwrap(
      await callTool(
        "memory.create",
        { project: projectId, type: "note", title: `Elevation Smoke Item ${label}`, body: "seeded for step-up elevation smoke test" },
        staticHeaders()
      )
    )
  );
  return created.item.id;
}

// T-MEMORY-0xx SSO: session-cookie login (POST /auth/login, then
// /auth/login/2fa for a totp_enabled account like this script's admin/member
// seeds) instead of a magic token -- same real-login flow the frontend's
// oauth-authorize page drives.
async function loginSession(email: string, password: string, totpSecret: string): Promise<string> {
  const loginResponse = await postJson(`${started.url}/auth/login`, { email, password });
  assert(loginResponse.status === 200, `Login failed for ${email}. Status: ${loginResponse.status}`);
  const userId = readNestedString(loginResponse.body, ["data", "userId"]);

  const totpResponse = await fetch(`${started.url}/auth/login/2fa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, code: currentTotpCode(totpSecret) })
  });
  assert(totpResponse.status === 200, `TOTP login failed for ${email}. Status: ${totpResponse.status}`);
  const cookie = totpResponse.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, `TOTP login for ${email} did not set a session cookie.`);
  return cookie!;
}

async function mintOAuthAccessToken(sessionCookie: string): Promise<string> {
  const codeVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  const authorize = await fetch(`${started.url}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({
      response_type: "code",
      client_id: oauthClientId,
      redirect_uri: redirectUri,
      scope: "memory:read memory:write",
      state: "elevation-smoke-state",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      resource: publicUrl
    })
  });
  const authorizeBody = (await authorize.json()) as { data?: { redirectUri?: string } };
  assert(authorize.status === 200, `OAuth authorize (session) failed. Status: ${authorize.status}, body: ${JSON.stringify(authorizeBody)}`);
  const code = new URL(authorizeBody.data!.redirectUri!).searchParams.get("code");
  assert(code, "OAuth authorize redirect missing code.");

  const tokenResponse = await fetch(`${started.url}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      code_verifier: codeVerifier,
      resource: publicUrl
    })
  });
  assert(tokenResponse.status === 200, "OAuth token exchange failed.");
  const tokenBody = (await tokenResponse.json()) as { access_token?: string };
  assert(tokenBody.access_token, "OAuth token exchange did not return an access_token.");
  return tokenBody.access_token!;
}

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "Elevation Smoke Static"
  };
}

function oauthHeaders(bearer: string, elevationToken?: string): Record<string, string> {
  return {
    authorization: `Bearer ${bearer}`,
    "x-project-memory-client-id": pmemClientId,
    "x-project-memory-client-label": "Elevation Smoke Agent",
    ...(elevationToken ? { "x-project-memory-elevation": elevationToken } : {})
  };
}

async function callTool(
  tool: string,
  input: unknown,
  headers: Record<string, string>
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ tool, input })
  });
  return { status: response.status, json: await response.json() };
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function unwrap(result: { status: number; json: unknown }): ToolResponse<unknown> {
  assert(result.status === 200, `Expected a 200 tool response, got HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json as ToolResponse<unknown>;
}

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
}

function assertInsufficientScope(result: { status: number; json: unknown }, context: string): void {
  const body = result.json as { error?: { code?: string } };
  assert(
    body.error?.code === "INSUFFICIENT_SCOPE",
    `${context} should fail with INSUFFICIENT_SCOPE, got: ${JSON.stringify(body)}`
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Standalone RFC 6238 code generator for this script's own assertions --
 * mirrors the algorithm in src/gateway/totp.ts (HMAC-SHA1 dynamic
 * truncation, 30s step, 6 digits) without importing its private hotp()
 * helper, same approach as scripts/smoke-gateway-registration.ts.
 */
function currentTotpCode(secretBase32: string): string {
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binCode % 10 ** 6).toString().padStart(6, "0");
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    assert(isRecord(current), `Expected object while reading ${path.join(".")}.`);
    current = (current as Record<string, unknown>)[key];
  }
  assert(typeof current === "string", `Expected string at ${path.join(".")}.`);
  return current as string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
