// T-MEMORY-047: personal Marrow API tokens -- a third bearer-auth source,
// scoped to exactly one user, end to end against the real gateway
// (ephemeral local instance, real Postgres) -- same style as
// scripts/smoke-gateway-scopes.ts (session-derived scope tiers) and
// scripts/smoke-gateway-git-credentials.ts (session-only management,
// admin-fallback for reads).
//
// Covers: /auth/profile/personal-token requires a session (401 without one);
// a freshly-approved-shaped active user has no token until the frontend's
// lazy "Generate" path runs (this task's resolved "lazy on first visit"
// design, not auto-generation at approve time -- see the task note for why:
// with shown-once semantics and no SMTP configured, generating server-side
// at approve time has no channel to ever deliver the plaintext to the user,
// so it would just be an immediately-orphaned row); regenerate returns the
// raw token exactly once and the row only ever stores its sha256 hash plus
// a last-4-chars hint; the token authenticates over `Authorization: Bearer`
// on /call with a role-derived scope tier identical to a session's (member
// -> write, admin -> admin) -- INSUFFICIENT_SCOPE on memory.delete for a
// member's token, success for an admin's; project-membership filtering
// applies to a personal-token bearer exactly like a session (not bypassed
// the way OAuth/static-token/anonymous callers are); regenerating
// invalidates the old token immediately (401 on next use); and git-credential
// *management* (create/delete) stays deliberately browser-session-only even
// over a valid personal-token bearer for the same user, while git-credential
// *reads* (list) resolve directly to that bearer's own owner (not the
// admin-fallback OAuth/static-token callers get), because a personal token
// IS that specific user connecting programmatically.
import { createHash, randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { decryptGitToken } from "../src/gateway/git-credentials.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

// GIT_CREDENTIAL_ENC_KEY is only touched by this script's git-credential
// boundary checks (session-only create, personal-token-owner read) -- same
// throwaway-key pattern as scripts/smoke-gateway-git-credentials.ts.
if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}
if (!process.env.GIT_CREDENTIAL_ENC_KEY) {
  process.env.GIT_CREDENTIAL_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const db = createPgKnex();
const service = new PgToolService(db);
const staticToken = `gateway-personal-tokens-smoke-static-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  auth
});

const unique = Date.now();
const memberEmail = `personal-tokens-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-personal-token-member-pw-1";
const adminEmail = `personal-tokens-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-personal-token-admin-pw-1";

let memberUserId: string | undefined;
let adminUserId: string | undefined;
let projectAId: string | undefined;
let projectBId: string | undefined;
let memberMemoryId: string | undefined;

try {
  const now = new Date();
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
  console.log("ok - one role=member and one role=admin account seeded (both status=active, same shape as a freshly admin-approved user)");

  const memberCookie = await login(memberEmail, memberPassword);
  const adminCookie = await login(adminEmail, adminPassword);
  console.log("ok - sessions established for both accounts");

  // --- GET /auth/profile/personal-token requires a session ----------------
  const statusNoSession = await fetch(`${started.url}/auth/profile/personal-token`);
  assert(statusNoSession.status === 401, `GET personal-token status with no session should 401, got ${statusNoSession.status}`);
  console.log("ok - GET /auth/profile/personal-token without a session is rejected (401)");

  // --- No token yet for a freshly-active user (lazy generation, not
  // auto-generated at approve time -- see this script's header comment) ---
  const initialStatus = await personalTokenStatus(memberCookie);
  assert(initialStatus.exists === false, "A freshly-active user should have no personal token until the first Generate/regenerate call.");
  assert(initialStatus.tokenHint === null && initialStatus.createdAt === null && initialStatus.lastUsedAt === null, "An absent token's status fields should all be null.");
  console.log("ok - a freshly-active user has no personal token yet (exists:false) -- confirms the lazy-on-first-visit design, not approve-time auto-generation");

  // --- POST regenerate requires a session ----------------------------------
  const regenerateNoSession = await fetch(`${started.url}/auth/profile/personal-token/regenerate`, { method: "POST" });
  assert(regenerateNoSession.status === 401, `POST regenerate with no session should 401, got ${regenerateNoSession.status}`);
  console.log("ok - POST /auth/profile/personal-token/regenerate without a session is rejected (401)");

  // --- Generate (member): raw token shown exactly once ---------------------
  const memberGenerated = await regeneratePersonalToken(memberCookie);
  assert(typeof memberGenerated.token === "string" && memberGenerated.token.length > 20, "Generated token should be a real opaque secret.");
  assert(memberGenerated.tokenHint === memberGenerated.token.slice(-4), "tokenHint should be the last 4 characters of the raw token.");
  console.log("ok - regenerate (first call, member) returns a raw token, tokenHint, and createdAt");

  const memberRow = await db("personal_tokens").where({ owner_user_id: memberUserId }).first();
  assert(memberRow, "personal_tokens row should exist for the member after generation.");
  assert(memberRow!.token_hash !== memberGenerated.token, "token_hash must not equal the raw token.");
  assert(!String(memberRow!.token_hash).includes(memberGenerated.token), "token_hash must not contain the raw token as a substring.");
  assert(memberRow!.token_hash === sha256Hex(memberGenerated.token), "token_hash should be exactly sha256(rawToken) -- hash-only storage, matching sessions/tokens.");
  assert(memberRow!.token_hint === memberGenerated.tokenHint, "Stored token_hint should match the one returned at generation.");
  console.log("ok - only the sha256 hash (and a last-4 hint) is stored; the raw token is never persisted anywhere");

  // --- Status after generation: hint only, never the full token -----------
  const statusAfterGenerate = await personalTokenStatus(memberCookie);
  assert(statusAfterGenerate.exists === true, "Status should report exists:true after generation.");
  assert(statusAfterGenerate.tokenHint === memberGenerated.tokenHint, "Status tokenHint should match the one shown at generation.");
  assert(!JSON.stringify(statusAfterGenerate).includes(memberGenerated.token), "Status response must never include the full raw token again -- shown-once.");
  console.log("ok - status after generation exposes only the hint/dates, never the full token again (shown-once)");

  // --- The token authenticates over Authorization: Bearer, role-derived
  // scope tier identical to a session's (member -> write) -------------------
  const memberProjectA = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `personal-tokens-smoke-a-${unique}`, title: "Personal Tokens Smoke A" }, staticHeaders()))
  );
  projectAId = memberProjectA.project.id;
  const memberProjectB = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `personal-tokens-smoke-b-${unique}`, title: "Personal Tokens Smoke B" }, staticHeaders()))
  );
  projectBId = memberProjectB.project.id;
  await db("project_members").insert({ project_id: projectAId, user_id: memberUserId, created_at: new Date() });
  console.log(`ok - two projects created (static token); member ${memberUserId} added to project_members for project A only`);

  const createdViaToken = expectData<{ item: { id: string } }>(
    unwrap(
      await callTool(
        "memory.create",
        { project: projectAId, type: "note", title: "Personal token note", body: "written over a personal-token bearer" },
        personalTokenHeaders(memberGenerated.token)
      )
    )
  );
  memberMemoryId = createdViaToken.item.id;
  console.log("ok - memory.create succeeds over a member's personal-token bearer (write scope granted)");

  const deleteAttempt = await callTool("memory.delete", { id: memberMemoryId }, personalTokenHeaders(memberGenerated.token));
  const deleteAttemptBody = deleteAttempt.json as ToolResponse<unknown>;
  assert(
    deleteAttempt.status === 403 && deleteAttemptBody.ok === false && deleteAttemptBody.error.code === "INSUFFICIENT_SCOPE",
    `memory.delete over a member's personal token should be denied with INSUFFICIENT_SCOPE (write, not admin), got: HTTP ${deleteAttempt.status} ${JSON.stringify(deleteAttemptBody)}`
  );
  const stillThere = await db("items").where({ id: memberMemoryId }).first();
  assert(stillThere, "The item must survive the denied delete attempt.");
  console.log("ok - memory.delete over a member's personal token is denied with a clear INSUFFICIENT_SCOPE (403), same as a role=member session -- scope is role-derived, not a blanket bearer privilege");

  // --- Admin's personal token gets admin tier, same as an admin session ---
  const adminGenerated = await regeneratePersonalToken(adminCookie);
  const adminDeleteAttempt = await callTool("memory.delete", { id: memberMemoryId }, personalTokenHeaders(adminGenerated.token));
  assert(adminDeleteAttempt.status === 200, `memory.delete over an admin's personal token should succeed (admin tier). Got HTTP ${adminDeleteAttempt.status}: ${JSON.stringify(adminDeleteAttempt.json)}`);
  const adminDeleteBody = adminDeleteAttempt.json as ToolResponse<unknown>;
  assert(adminDeleteBody.ok === true, `memory.delete over an admin's personal token should succeed (admin tier). Got: ${JSON.stringify(adminDeleteBody)}`);
  const deletedRow = await db("items").where({ id: memberMemoryId }).first();
  assert(!deletedRow, "memory.delete over an admin's personal token should actually remove the row.");
  memberMemoryId = undefined;
  console.log("ok - memory.delete over an admin's personal token succeeds (admin tier) -- scope tier is role-derived, matching resolveScopeTier's session behavior exactly");

  // --- Project-membership filtering applies to a personal-token bearer,
  // same as a session (unlike OAuth/static-token/anonymous, which bypass it) --
  const memberTokenProjectList = expectData<{ projects: Array<{ id: string }> }>(
    unwrap(await callTool("project.list", {}, personalTokenHeaders(memberGenerated.token)))
  );
  assert(
    memberTokenProjectList.projects.some((project) => project.id === projectAId),
    "A member's personal token should see project A (has a project_members row), same as their session would."
  );
  assert(
    !memberTokenProjectList.projects.some((project) => project.id === projectBId),
    "A member's personal token must NOT see project B (no project_members row) -- membership filtering is not bypassed for personal tokens."
  );
  console.log("ok - project.list over a member's personal token is filtered by project_members, exactly like a role=member session (not bypassed like OAuth/static-token/anonymous callers)");

  // --- Regenerate invalidates the old token immediately --------------------
  const oldToken = memberGenerated.token;
  const memberRegenerated = await regeneratePersonalToken(memberCookie);
  assert(memberRegenerated.token !== oldToken, "Regenerate should produce a genuinely new token.");
  const oldTokenAttempt = await callTool("gateway.about", {}, personalTokenHeaders(oldToken));
  const oldTokenBody = oldTokenAttempt.json as ToolResponse<unknown> | { ok?: boolean; error?: { code?: string } };
  assert(
    oldTokenAttempt.status === 401,
    `A call using the just-invalidated old token should 401 (unauthenticated), got HTTP ${oldTokenAttempt.status}: ${JSON.stringify(oldTokenBody)}`
  );
  const newTokenWorks = expectData<{ about: unknown }>(unwrap(await callTool("gateway.about", {}, personalTokenHeaders(memberRegenerated.token))));
  assert(newTokenWorks.about !== undefined, "The freshly regenerated token should authenticate successfully.");
  const rowCountAfterRegenerate = await db("personal_tokens").where({ owner_user_id: memberUserId }).count<{ count: string }[]>("id as count").first();
  assert(Number(rowCountAfterRegenerate?.count ?? 0) === 1, "Regenerate should leave exactly one row for this user (replace, not append).");
  console.log("ok - regenerate invalidates the previous token immediately (old token 401s) while the new one works; exactly one row per user (replace, don't append)");

  // --- Git credentials: management stays browser-session-only even over a
  // valid personal-token bearer for the SAME user; reads resolve directly to
  // that bearer's own owner (not the admin-fallback OAuth/static token get) --
  const gitHost = `personal-tokens-smoke-git-${unique}.example.test`;
  const personalTokenCreateAttempt = await callTool(
    "git.credential_create",
    { host: gitHost, label: "should not be created via bearer", token: "glpat-should-not-be-stored" },
    personalTokenHeaders(memberRegenerated.token)
  );
  const personalTokenCreateBody = personalTokenCreateAttempt.json as ToolResponse<unknown>;
  assert(
    personalTokenCreateBody.ok === false && personalTokenCreateBody.error.code === "UNAUTHORIZED" && /logged-in session/i.test(personalTokenCreateBody.error.message),
    `git.credential_create over a personal-token bearer (not a real browser session) should be denied the same way the static token and OAuth are, got: ${JSON.stringify(personalTokenCreateBody)}`
  );
  console.log("ok - git.credential_create over a personal-token bearer is denied ('logged-in session' required) -- the git-credential browser-only boundary is not widened by this task");

  const sessionCreatedCredential = expectData<{ id: string }>(
    unwrap(
      await callTool(
        "git.credential_create",
        { host: gitHost, label: "created via browser session", token: "glpat-personal-token-smoke-0001" },
        sessionHeaders(memberCookie)
      )
    )
  );
  const personalTokenList = expectData<{ credentials: Array<{ id: string; host: string }> }>(
    unwrap(await callTool("git.credential_list", {}, personalTokenHeaders(memberRegenerated.token)))
  );
  assert(
    personalTokenList.credentials.some((credential) => credential.id === sessionCreatedCredential.id),
    "git.credential_list over the SAME user's personal-token bearer should see their own credential directly (not fall back to the instance admin's, the way OAuth/static-token callers do)."
  );
  console.log("ok - git.credential_list over a personal-token bearer resolves directly to that user's own credentials (read fallback treats it like a session, not like OAuth/static-token's admin-fallback)");

  const dbCredRow = await db("git_credentials").where({ id: sessionCreatedCredential.id }).first();
  assert(decryptGitToken(String(dbCredRow!.token_enc)) === "glpat-personal-token-smoke-0001", "Sanity check: the git credential created via session round-trips correctly.");
  await db("git_credentials").where({ id: sessionCreatedCredential.id }).del();

  console.log(`Gateway personal-tokens smoke test passed using ${started.url}`);
} finally {
  if (memberMemoryId) {
    await db("items").where({ id: memberMemoryId }).del();
  }
  if (memberUserId) {
    await db("git_credentials").where({ owner_user_id: memberUserId }).del();
    await db("personal_tokens").where({ owner_user_id: memberUserId }).del();
    await db("project_members").where({ user_id: memberUserId }).del();
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  if (adminUserId) {
    await db("personal_tokens").where({ owner_user_id: adminUserId }).del();
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  if (projectAId) {
    await db("events").where({ project_id: projectAId }).del();
    await db("items").where({ project_id: projectAId }).del();
    await db("projects").where({ id: projectAId }).del();
  }
  if (projectBId) {
    await db("events").where({ project_id: projectBId }).del();
    await db("items").where({ project_id: projectBId }).del();
    await db("projects").where({ id: projectBId }).del();
  }
  await started.stop();
  await service.close();
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert(response.status === 200, `Login for ${email} failed. Status: ${response.status}`);
  const cookie = sessionCookieFrom(response);
  assert(cookie, `Login for ${email} did not set a session cookie.`);
  return cookie!;
}

async function personalTokenStatus(cookie: string): Promise<{ exists: boolean; tokenHint: string | null; createdAt: string | null; lastUsedAt: string | null }> {
  const response = await fetch(`${started.url}/auth/profile/personal-token`, { headers: { cookie } });
  assert(response.status === 200, `GET personal-token status failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: { exists: boolean; tokenHint: string | null; createdAt: string | null; lastUsedAt: string | null } };
  assert(body.ok, "GET personal-token status returned ok:false.");
  return body.data;
}

async function regeneratePersonalToken(cookie: string): Promise<{ token: string; tokenHint: string; createdAt: string }> {
  const response = await fetch(`${started.url}/auth/profile/personal-token/regenerate`, {
    method: "POST",
    headers: { cookie }
  });
  assert(response.status === 200, `POST personal-token regenerate failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: { token: string; tokenHint: string; createdAt: string } };
  assert(body.ok, "POST personal-token regenerate returned ok:false.");
  return body.data;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "Personal Tokens Smoke Static"
  };
}

function personalTokenHeaders(rawToken: string): Record<string, string> {
  return { authorization: `Bearer ${rawToken}` };
}

function sessionHeaders(cookie: string): Record<string, string> {
  return { cookie };
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

function unwrap(result: { status: number; json: unknown }): ToolResponse<unknown> {
  assert(result.status === 200, `Expected a 200 tool response, got HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json as ToolResponse<unknown>;
}

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
}

function sessionCookieFrom(response: Response): string | null {
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return null;
  }
  return raw.split(";")[0] ?? null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
