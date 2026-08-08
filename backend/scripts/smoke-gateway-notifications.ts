// T-MEMORY-051: notifications badge/page -- the per-account "seen" REST pair
// plus the eventsPage global-feed membership-filter fix it depends on, end
// to end against the real gateway (ephemeral local instance, real Postgres)
// -- same style as scripts/smoke-gateway-personal-tokens.ts (session-only
// profile REST pair) and scripts/smoke-gateway-project-invites.ts (GraphQL
// coverage alongside the MCP tool).
//
// Covers: /auth/profile/notifications and /auth/profile/notifications-seen
// both require a session (401 without one); a freshly-active user has
// seenAt:null until they first visit the notifications page; POST stamps
// now() and GET reflects it afterward (persisted, not just returned once).
//
// Separately: before this task, eventsPage(project: undefined) -- the
// global feed a notifications page needs -- applied zero project-membership
// filtering, so a role=member session would see events from every project
// system-wide, including ones it was never added to. This covers the fix:
// a member sees only events from projects they belong to plus common
// (project_id IS NULL) events; a member with no project memberships at all
// sees only the common events (fail-closed, not fail-open); an explicit
// `project` argument is unaffected (unchanged pre-existing behavior); and
// admin/static-token callers still bypass the filter entirely, same as
// every other project-membership check in this codebase.
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const staticToken = `gateway-notifications-smoke-static-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  auth
});

const unique = Date.now();
const adminEmail = `notifications-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-notifications-admin-pw-1";
const memberEmail = `notifications-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-notifications-member-pw-1";
const outsiderEmail = `notifications-smoke-outsider-${unique}@example.test`;
const outsiderPassword = "smoke-notifications-outsider-pw-1";

let adminUserId: string | undefined;
let memberUserId: string | undefined;
let outsiderUserId: string | undefined;
let projectAId: string | undefined;
let projectBId: string | undefined;

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
  outsiderUserId = randomUUID();
  await db("users").insert({
    id: outsiderUserId,
    email: outsiderEmail,
    password_hash: await hashPassword(outsiderPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  console.log("ok - one role=admin account and two role=member accounts (one an outsider with no project memberships) seeded");

  const adminCookie = await login(adminEmail, adminPassword);
  const memberCookie = await login(memberEmail, memberPassword);
  const outsiderCookie = await login(outsiderEmail, outsiderPassword);
  console.log("ok - sessions established for all three accounts");

  // --- /auth/profile/notifications requires a session ----------------------
  const statusNoSession = await fetch(`${started.url}/auth/profile/notifications`);
  assert(statusNoSession.status === 401, `GET notifications status with no session should 401, got ${statusNoSession.status}`);
  const markNoSession = await fetch(`${started.url}/auth/profile/notifications-seen`, { method: "POST" });
  assert(markNoSession.status === 401, `POST notifications-seen with no session should 401, got ${markNoSession.status}`);
  console.log("ok - both /auth/profile/notifications endpoints reject a request with no session (401)");

  // --- A freshly-active user has never viewed notifications ----------------
  const initialStatus = await notificationsStatus(memberCookie);
  assert(initialStatus.seenAt === null, "A freshly-active user should have seenAt:null (never viewed) until their first visit.");
  console.log("ok - a freshly-active user's notifications status is seenAt:null (everything counts as unread)");

  // --- Marking seen stamps now() and persists across requests --------------
  const beforeMark = Date.now();
  const marked = await markNotificationsSeen(memberCookie);
  assert(typeof marked.seenAt === "string" && marked.seenAt.length > 0, "POST notifications-seen should return a non-empty seenAt.");
  const markedMs = Date.parse(marked.seenAt!);
  assert(markedMs >= beforeMark - 1000 && markedMs <= Date.now() + 1000, `seenAt should be close to now(), got ${marked.seenAt}`);
  const dbUserRow = await db("users").where({ id: memberUserId }).first();
  assert(dbUserRow!.notifications_seen_at, "users.notifications_seen_at should be set in the database after marking seen.");
  console.log("ok - POST /auth/profile/notifications-seen stamps notifications_seen_at = now() in the database");

  const statusAfterMark = await notificationsStatus(memberCookie);
  assert(statusAfterMark.seenAt === marked.seenAt, "GET status after marking seen should return the exact same seenAt that was just persisted.");
  console.log("ok - GET /auth/profile/notifications reflects the persisted seenAt on a subsequent request (not just returned once)");

  // --- eventsPage global-feed membership filter -----------------------------
  const projectA = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: `notifications-smoke-a-${unique}`, title: "Notifications Smoke A" }, staticHeaders()))
  );
  projectAId = projectA.project.id;
  const projectB = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: `notifications-smoke-b-${unique}`, title: "Notifications Smoke B" }, staticHeaders()))
  );
  projectBId = projectB.project.id;
  await db("project_members").insert({ project_id: projectAId, user_id: memberUserId, created_at: new Date() });
  console.log(`ok - two projects created; member ${memberUserId} added to project_members for project A only, outsider has no memberships`);

  const eventA = expectData<{ event: { id: string } }>(
    unwrap(await callTool("event.record", { project: projectA.project.slug, type: "notifications.smoke", title: "Event in project A" }, staticHeaders()))
  );
  const eventB = expectData<{ event: { id: string } }>(
    unwrap(await callTool("event.record", { project: projectB.project.slug, type: "notifications.smoke", title: "Event in project B" }, staticHeaders()))
  );
  const eventCommon = expectData<{ event: { id: string } }>(
    unwrap(await callTool("event.record", { project: null, type: "notifications.smoke", title: "Common (global-scope) event" }, staticHeaders()))
  );
  console.log("ok - one event recorded in project A, one in project B, one common (project_id IS NULL)");

  // Member (in project A only): sees A's event and the common event, NOT B's.
  const memberGlobalFeed = await graphql<{ eventsPage: { items: Array<{ id: string; projectId: string | null }> } }>(
    `query Feed($limit: Int!, $offset: Int!) { eventsPage(pagination: { limit: $limit, offset: $offset }) { items { id projectId } } }`,
    { limit: 100, offset: 0 },
    memberCookie
  );
  const memberIds = memberGlobalFeed.eventsPage.items.map((item) => item.id);
  assert(memberIds.includes(eventA.event.id), "Member's global feed should include project A's event (a project they belong to).");
  assert(memberIds.includes(eventCommon.event.id), "Member's global feed should include the common (project_id IS NULL) event.");
  assert(!memberIds.includes(eventB.event.id), "Member's global feed must NOT include project B's event -- they were never added to that project.");
  console.log("ok - a role=member's global eventsPage feed is filtered to their own project(s) plus common events, exactly the fix this task closes");

  // Outsider (no project memberships at all): sees ONLY the common event --
  // fail-closed, not fail-open, per this task's explicit rule.
  const outsiderGlobalFeed = await graphql<{ eventsPage: { items: Array<{ id: string; projectId: string | null }> } }>(
    `query Feed($limit: Int!, $offset: Int!) { eventsPage(pagination: { limit: $limit, offset: $offset }) { items { id projectId } } }`,
    { limit: 100, offset: 0 },
    outsiderCookie
  );
  const outsiderIds = outsiderGlobalFeed.eventsPage.items.map((item) => item.id);
  assert(!outsiderIds.includes(eventA.event.id), "An outsider with zero project memberships must not see project A's event.");
  assert(!outsiderIds.includes(eventB.event.id), "An outsider with zero project memberships must not see project B's event.");
  assert(outsiderIds.includes(eventCommon.event.id), "An outsider with zero project memberships should still see the common event.");
  console.log("ok - a role=member with NO project memberships sees only common events on the global feed (fail-closed, not fail-open)");

  // Admin bypasses the filter entirely, same as every other membership check.
  const adminGlobalFeed = await graphql<{ eventsPage: { items: Array<{ id: string }> } }>(
    `query Feed($limit: Int!, $offset: Int!) { eventsPage(pagination: { limit: $limit, offset: $offset }) { items { id } } }`,
    { limit: 100, offset: 0 },
    adminCookie
  );
  const adminIds = adminGlobalFeed.eventsPage.items.map((item) => item.id);
  assert(adminIds.includes(eventA.event.id) && adminIds.includes(eventB.event.id) && adminIds.includes(eventCommon.event.id), "An admin session's global feed should be unaffected (sees every project's events, unchanged bypass).");
  console.log("ok - role=admin's global eventsPage feed is unaffected (unchanged bypass, sees all three events)");

  // An explicit `project` argument is unaffected by this fix (pre-existing,
  // already project-scoped behavior).
  const memberScopedFeed = await graphql<{ eventsPage: { items: Array<{ id: string }> } }>(
    `query Feed($project: String, $limit: Int!, $offset: Int!) { eventsPage(project: $project, pagination: { limit: $limit, offset: $offset }) { items { id } } }`,
    { project: projectA.project.slug, limit: 100, offset: 0 },
    memberCookie
  );
  const memberScopedIds = memberScopedFeed.eventsPage.items.map((item) => item.id);
  assert(memberScopedIds.includes(eventA.event.id) && !memberScopedIds.includes(eventB.event.id) && !memberScopedIds.includes(eventCommon.event.id), "An explicit project= argument should behave exactly as before this fix (scoped to that one project only).");
  console.log("ok - eventsPage with an explicit project= argument is unaffected by this fix (still scoped to exactly that project)");

  console.log(`Gateway notifications smoke test passed using ${started.url}`);
} finally {
  if (projectAId) {
    await db("events").where({ project_id: projectAId }).del();
    await db("project_members").where({ project_id: projectAId }).del();
    await db("projects").where({ id: projectAId }).del();
  }
  if (projectBId) {
    await db("events").where({ project_id: projectBId }).del();
    await db("project_members").where({ project_id: projectBId }).del();
    await db("projects").where({ id: projectBId }).del();
  }
  await db("events").where({ type: "notifications.smoke", project_id: null }).del();
  if (adminUserId) {
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  if (memberUserId) {
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  if (outsiderUserId) {
    await db("sessions").where({ user_id: outsiderUserId }).del();
    await db("users").where({ id: outsiderUserId }).del();
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

async function notificationsStatus(cookie: string): Promise<{ seenAt: string | null }> {
  const response = await fetch(`${started.url}/auth/profile/notifications`, { headers: { cookie } });
  assert(response.status === 200, `GET notifications status failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: { seenAt: string | null } };
  assert(body.ok, "GET notifications status returned ok:false.");
  return body.data;
}

async function markNotificationsSeen(cookie: string): Promise<{ seenAt: string | null }> {
  const response = await fetch(`${started.url}/auth/profile/notifications-seen`, {
    method: "POST",
    headers: { cookie }
  });
  assert(response.status === 200, `POST notifications-seen failed. Status: ${response.status}`);
  const body = (await response.json()) as { ok: boolean; data: { seenAt: string | null } };
  assert(body.ok, "POST notifications-seen returned ok:false.");
  return body.data;
}

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "Notifications Smoke Static"
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

async function graphql<T>(query: string, variables: Record<string, unknown>, cookie: string): Promise<T> {
  const response = await fetch(`${started.url}${normalizedApiEndpoint() ?? ""}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ query, variables })
  });
  assert(response.ok, `GraphQL HTTP request returned ${response.status}.`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  assert(body.data, "GraphQL response did not include data.");
  return body.data;
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

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
