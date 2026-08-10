// T-MEMORY-047: personal Marrow API tokens -- a third bearer-auth source.
// Made multi-token-per-user in a later pass (mirroring
// 017_oauth_clients_per_connector.cjs's exact fix for oauth_clients) after
// the owner hit this live: generating a token for a second agent (Codex,
// after Claude Code was already connected) used to invalidate the first
// agent's already-working token, since there was only ever one row per
// user. Same style as scripts/smoke-gateway-scopes.ts (session-derived
// scope tiers) and scripts/smoke-gateway-git-credentials.ts (session-only
// management, admin-fallback for reads, per-credential independence).
//
// Covers: /auth/profile/personal-tokens requires a session (401 without
// one); a freshly-active user has no tokens until one is explicitly
// created; create returns the raw token exactly once and the row only
// ever stores its sha256 hash plus a last-4-chars hint; the token
// authenticates over `Authorization: Bearer` on /call with a role-derived
// scope tier identical to a session's (member -> write, admin -> admin);
// project-membership filtering applies to a personal-token bearer exactly
// like a session (not bypassed the way OAuth/static-token/anonymous
// callers are); a SECOND token for the same user is fully independent --
// creating it doesn't touch the first, and regenerating/deleting one
// never invalidates the other (the actual bug this pass fixes); and
// git-credential *management* (create/delete) stays deliberately
// browser-session-only even over a valid personal-token bearer for the
// same user, while git-credential *reads* (list) resolve directly to
// that bearer's own owner (not the admin-fallback OAuth/static-token
// callers get), because a personal token IS that specific user
// connecting programmatically.
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

  // --- GET /auth/profile/personal-tokens requires a session ---------------
  const statusNoSession = await fetch(`${started.url}/auth/profile/personal-tokens`);
  assert(statusNoSession.status === 401, `GET personal-tokens with no session should 401, got ${statusNoSession.status}`);
  console.log("ok - GET /auth/profile/personal-tokens without a session is rejected (401)");

  // --- No tokens yet for a freshly-active user -----------------------------
  const initialList = await listPersonalTokens(memberCookie);
  assert(initialList.length === 0, "A freshly-active user should have no personal tokens until one is explicitly created.");
  console.log("ok - a freshly-active user has an empty personal-tokens list");

  // --- POST create requires a session ---------------------------------------
  const createNoSession = await fetch(`${started.url}/auth/profile/personal-tokens`, { method: "POST" });
  assert(createNoSession.status === 401, `POST create with no session should 401, got ${createNoSession.status}`);
  console.log("ok - POST /auth/profile/personal-tokens without a session is rejected (401)");

  // --- Create (member): raw token shown exactly once -----------------------
  const memberFirst = await createPersonalToken(memberCookie, "Claude Code (CLI)");
  assert(typeof memberFirst.token === "string" && memberFirst.token.length > 20, "Created token should be a real opaque secret.");
  assert(memberFirst.tokenHint === memberFirst.token.slice(-4), "tokenHint should be the last 4 characters of the raw token.");
  assert(memberFirst.label === "Claude Code (CLI)", "label should round-trip exactly as given.");
  console.log("ok - create (member, labeled) returns a raw token, tokenHint, label, and createdAt");

  const memberFirstRow = await db("personal_tokens").where({ id: memberFirst.id }).first();
  assert(memberFirstRow, "personal_tokens row should exist for the created token.");
  assert(memberFirstRow!.token_hash !== memberFirst.token, "token_hash must not equal the raw token.");
  assert(!String(memberFirstRow!.token_hash).includes(memberFirst.token), "token_hash must not contain the raw token as a substring.");
  assert(memberFirstRow!.token_hash === sha256Hex(memberFirst.token), "token_hash should be exactly sha256(rawToken) -- hash-only storage, matching sessions/tokens.");
  assert(memberFirstRow!.token_hint === memberFirst.tokenHint, "Stored token_hint should match the one returned at creation.");
  console.log("ok - only the sha256 hash (and a last-4 hint) is stored; the raw token is never persisted anywhere");

  // --- List after creation: hint only, never the full token ---------------
  const listAfterCreate = await listPersonalTokens(memberCookie);
  assert(listAfterCreate.length === 1, "List should report exactly one token after one create.");
  assert(listAfterCreate[0].tokenHint === memberFirst.tokenHint, "Listed tokenHint should match the one shown at creation.");
  assert(!JSON.stringify(listAfterCreate).includes(memberFirst.token), "List response must never include the full raw token again -- shown-once.");
  console.log("ok - list after creation exposes only the hint/label/dates, never the full token again (shown-once)");

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
        personalTokenHeaders(memberFirst.token)
      )
    )
  );
  memberMemoryId = createdViaToken.item.id;
  console.log("ok - memory.create succeeds over a member's personal-token bearer (write scope granted)");

  const deleteAttempt = await callTool("memory.delete", { id: memberMemoryId }, personalTokenHeaders(memberFirst.token));
  const deleteAttemptBody = deleteAttempt.json as ToolResponse<unknown>;
  assert(
    deleteAttempt.status === 403 && deleteAttemptBody.ok === false && deleteAttemptBody.error.code === "INSUFFICIENT_SCOPE",
    `memory.delete over a member's personal token should be denied with INSUFFICIENT_SCOPE (write, not admin), got: HTTP ${deleteAttempt.status} ${JSON.stringify(deleteAttemptBody)}`
  );
  const stillThere = await db("items").where({ id: memberMemoryId }).first();
  assert(stillThere, "The item must survive the denied delete attempt.");
  console.log("ok - memory.delete over a member's personal token is denied with a clear INSUFFICIENT_SCOPE (403), same as a role=member session -- scope is role-derived, not a blanket bearer privilege");

  // --- Admin's personal token gets admin tier, same as an admin session ---
  const adminCreated = await createPersonalToken(adminCookie, null);
  assert(adminCreated.label === null, "Omitting a label should store/return null, not an empty string or a placeholder.");
  const adminDeleteAttempt = await callTool("memory.delete", { id: memberMemoryId }, personalTokenHeaders(adminCreated.token));
  assert(adminDeleteAttempt.status === 200, `memory.delete over an admin's personal token should succeed (admin tier). Got HTTP ${adminDeleteAttempt.status}: ${JSON.stringify(adminDeleteAttempt.json)}`);
  const adminDeleteBody = adminDeleteAttempt.json as ToolResponse<unknown>;
  assert(adminDeleteBody.ok === true, `memory.delete over an admin's personal token should succeed (admin tier). Got: ${JSON.stringify(adminDeleteBody)}`);
  const deletedRow = await db("items").where({ id: memberMemoryId }).first();
  assert(!deletedRow, "memory.delete over an admin's personal token should actually remove the row.");
  memberMemoryId = undefined;
  console.log("ok - memory.delete over an admin's personal token succeeds (admin tier) -- scope tier is role-derived, matching resolveScopeTier's session behavior exactly; unlabeled create stores label:null");

  // --- Project-membership filtering applies to a personal-token bearer,
  // same as a session (unlike OAuth/static-token/anonymous, which bypass it) --
  const memberTokenProjectList = expectData<{ projects: Array<{ id: string }> }>(
    unwrap(await callTool("project.list", {}, personalTokenHeaders(memberFirst.token)))
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

  // --- THE ACTUAL BUG THIS PASS FIXES: a second token for the same user is
  // fully independent -- creating it doesn't touch the first, and
  // regenerating/deleting one never invalidates the other -----------------
  const memberSecond = await createPersonalToken(memberCookie, "Codex (CLI)");
  assert(memberSecond.id !== memberFirst.id, "A second create must insert a new row, not replace the first.");
  const listAfterSecond = await listPersonalTokens(memberCookie);
  assert(listAfterSecond.length === 2, `Creating a second token should leave both -- expected 2 rows, got ${listAfterSecond.length}.`);
  const stillWorksAfterSecondCreate = await callTool("gateway.about", {}, personalTokenHeaders(memberFirst.token));
  assert(stillWorksAfterSecondCreate.status === 200, "Creating a second token must not invalidate the first -- this is the exact bug reported live (generating Codex's token killed Claude Code's).");
  console.log("ok - creating a second named token (Codex) leaves the first (Claude Code) fully intact and still authenticating -- the actual live-reported bug is fixed");

  const oldFirstToken = memberFirst.token;
  const memberFirstRegenerated = await regeneratePersonalToken(memberCookie, memberFirst.id);
  assert(memberFirstRegenerated.token !== oldFirstToken, "Regenerate should produce a genuinely new token.");
  assert(memberFirstRegenerated.label === "Claude Code (CLI)", "Regenerate should preserve the row's existing label.");
  const oldFirstTokenAttempt = await callTool("gateway.about", {}, personalTokenHeaders(oldFirstToken));
  assert(oldFirstTokenAttempt.status === 401, `The just-regenerated old token should 401, got HTTP ${oldFirstTokenAttempt.status}.`);
  const newFirstTokenWorks = await callTool("gateway.about", {}, personalTokenHeaders(memberFirstRegenerated.token));
  assert(newFirstTokenWorks.status === 200, "The freshly regenerated token should authenticate successfully.");
  const secondStillWorksAfterFirstRegenerate = await callTool("gateway.about", {}, personalTokenHeaders(memberSecond.token));
  assert(secondStillWorksAfterFirstRegenerate.status === 200, "Regenerating the first token must not invalidate the second (Codex) -- independence must hold in both directions.");
  console.log("ok - regenerating one token invalidates only that token (old value 401s, new value works) and leaves the other named token untouched");

  await deletePersonalToken(memberCookie, memberSecond.id);
  const listAfterDelete = await listPersonalTokens(memberCookie);
  assert(listAfterDelete.length === 1 && listAfterDelete[0].id === memberFirst.id, "Deleting the second token should leave exactly the first.");
  const secondTokenAfterDelete = await callTool("gateway.about", {}, personalTokenHeaders(memberSecond.token));
  assert(secondTokenAfterDelete.status === 401, "A deleted token must stop authenticating immediately.");
  const firstStillWorksAfterSecondDelete = await callTool("gateway.about", {}, personalTokenHeaders(memberFirstRegenerated.token));
  assert(firstStillWorksAfterSecondDelete.status === 200, "Deleting the second token must not invalidate the first.");
  console.log("ok - deleting one token stops only that token from authenticating and leaves the other untouched");

  // --- A different user cannot regenerate/delete another user's token -----
  const crossUserRegenerate = await fetch(`${started.url}/auth/profile/personal-tokens/${memberFirst.id}/regenerate`, {
    method: "POST",
    headers: { cookie: adminCookie }
  });
  assert(crossUserRegenerate.status !== 200, "An admin session must not be able to regenerate another user's personal token by id.");
  const crossUserDelete = await fetch(`${started.url}/auth/profile/personal-tokens/${memberFirst.id}`, {
    method: "DELETE",
    headers: { cookie: adminCookie }
  });
  assert(crossUserDelete.status !== 200, "An admin session must not be able to delete another user's personal token by id.");
  const survivedCrossUserAttempts = await callTool("gateway.about", {}, personalTokenHeaders(memberFirstRegenerated.token));
  assert(survivedCrossUserAttempts.status === 200, "The member's token must still work after another user's failed regenerate/delete attempts against it.");
  console.log("ok - a different user's session cannot regenerate or delete another user's personal token by id (ownership-scoped, not just id-scoped)");

  // --- Git credentials: management stays browser-session-only even over a
  // valid personal-token bearer for the SAME user; reads resolve directly to
  // that bearer's own owner (not the admin-fallback OAuth/static token get) --
  const gitHost = `personal-tokens-smoke-git-${unique}.example.test`;
  const personalTokenCreateAttempt = await callTool(
    "git.credential_create",
    { host: gitHost, label: "should not be created via bearer", token: "glpat-should-not-be-stored" },
    personalTokenHeaders(memberFirstRegenerated.token)
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
    unwrap(await callTool("git.credential_list", {}, personalTokenHeaders(memberFirstRegenerated.token)))
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

interface PersonalTokenListItem {
  id: string;
  label: string | null;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface PersonalTokenSecretResult {
  id: string;
  token: string;
  tokenHint: string;
  label: string | null;
  createdAt: string;
}

async function listPersonalTokens(cookie: string): Promise<PersonalTokenListItem[]> {
  const response = await fetch(`${started.url}/auth/profile/personal-tokens`, { headers: { cookie } });
  assert(response.status === 200, `GET personal-tokens failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: PersonalTokenListItem[] };
  assert(body.ok, "GET personal-tokens returned ok:false.");
  return body.data;
}

async function createPersonalToken(cookie: string, label: string | null): Promise<PersonalTokenSecretResult> {
  const response = await fetch(`${started.url}/auth/profile/personal-tokens`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(label === null ? {} : { label })
  });
  assert(response.status === 200, `POST personal-tokens create failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: PersonalTokenSecretResult };
  assert(body.ok, "POST personal-tokens create returned ok:false.");
  return body.data;
}

async function regeneratePersonalToken(cookie: string, id: string): Promise<PersonalTokenSecretResult> {
  const response = await fetch(`${started.url}/auth/profile/personal-tokens/${id}/regenerate`, {
    method: "POST",
    headers: { cookie }
  });
  assert(response.status === 200, `POST personal-tokens regenerate failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: PersonalTokenSecretResult };
  assert(body.ok, "POST personal-tokens regenerate returned ok:false.");
  return body.data;
}

async function deletePersonalToken(cookie: string, id: string): Promise<void> {
  const response = await fetch(`${started.url}/auth/profile/personal-tokens/${id}`, {
    method: "DELETE",
    headers: { cookie }
  });
  assert(response.status === 200, `DELETE personal-tokens failed. Status: ${response.status}`);
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
