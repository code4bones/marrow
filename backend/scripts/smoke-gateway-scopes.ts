// T-MEMORY-029 / D-MEMORY-007: read/write/admin scopes, project membership,
// and event credential attribution, end to end against the real gateway
// (ephemeral local instance, real Postgres) -- same style as
// scripts/smoke-gateway-auth.ts, which this complements (that script owns
// invite/claim/verify-email/session coverage; this one owns what a session
// is and is not allowed to do once it exists, plus the static-token
// migration and stable identity fix).
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-scopes-smoke-token-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token,
  auth
});

// T-MEMORY-029: idempotent startup migration this smoke test also exercises
// directly, same call src/gateway.ts makes when MCP_TOKEN is configured.
await service.ensureStaticTokenCredential();

const unique = Date.now();
const adminEmail = `gateway-scopes-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-admin-password-1";
const memberEmail = `gateway-scopes-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-member-password-1";

let adminUserId: string | undefined;
let memberUserId: string | undefined;
let projectAId: string | undefined;
let projectBId: string | undefined;
let memberMemoryId: string | undefined;
let adminMemoryId: string | undefined;

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

  const adminCookie = await login(adminEmail, adminPassword);
  const memberCookie = await login(memberEmail, memberPassword);
  console.log("ok - admin and member sessions established");

  // --- Static MCP_TOKEN: backward compat + stable identity ---------------
  const staticClientGet1 = await callTool("gateway.client_get", { id: "static:mcp-token" }, staticHeaders());
  const staticClient1 = expectData<{ client: { id: string } }>(unwrap(staticClientGet1));
  assert(staticClient1.client.id === "static:mcp-token", "Static token credential was not migrated to a stable id.");

  const projectA = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `gateway-scopes-smoke-a-${unique}`, title: "Scopes Smoke A" }, staticHeaders()))
  );
  projectAId = projectA.project.id;
  const projectB = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `gateway-scopes-smoke-b-${unique}`, title: "Scopes Smoke B" }, staticHeaders()))
  );
  projectBId = projectB.project.id;
  console.log("ok - static token still authenticates and retains admin-tier access (project.create, backward compat)");

  // A second call, without any explicit client-id header, must resolve to
  // the SAME gateway_clients row -- not a fresh anonymous id per request,
  // which was the pre-T-MEMORY-029 behavior this task fixed.
  const staticClientGet2 = await callTool("gateway.client_get", { id: "static:mcp-token" }, staticHeaders());
  const staticClient2 = expectData<{ client: { id: string } }>(unwrap(staticClientGet2));
  assert(staticClient2.client.id === staticClient1.client.id, "Static token credential id was not stable across requests.");
  const anonymousClients = await db("gateway_clients").where("id", "like", "anonymous:%").andWhere("label", "Scopes Smoke Static").first();
  assert(!anonymousClients, "Static token requests must not create anonymous: rows.");
  console.log("ok - static token has a stable clientId across repeated calls, not anonymous:<requestId> each time");

  // Admin owns the migrated static credential once an admin exists.
  const staticRow = await db("gateway_clients").where({ id: "static:mcp-token" }).first();
  assert(staticRow?.scope === "admin", "Static token credential row should carry scope=admin.");
  console.log("ok - static token credential row carries scope=admin");

  await db("project_members").insert({ project_id: projectAId, user_id: memberUserId, created_at: now });
  console.log(`ok - member ${memberUserId} added to project_members for project A only`);

  // --- Member session: write allowed, admin (delete) denied --------------
  const memberCreate = await callTool(
    "memory.create",
    { project: projectAId, type: "note", title: "Member note", body: "written by member session" },
    sessionHeaders(memberCookie)
  );
  assert(memberCreate.status === 200, `Member create over HTTP failed. Status: ${memberCreate.status}`);
  const memberCreateData = expectData<{ item: { id: string } }>(memberCreate.json as ToolResponse<unknown>);
  memberMemoryId = memberCreateData.item.id;
  console.log("ok - role=member session (write scope) can create a memory item");

  const memberDelete = await callTool("memory.delete", { id: memberMemoryId }, sessionHeaders(memberCookie));
  assert(
    memberDelete.status === 403,
    `Write-only credential deleting should return 403, not a silent no-op or generic 401. Status: ${memberDelete.status}`
  );
  const memberDeleteBody = memberDelete.json as { error?: { code?: string; message?: string } };
  assert(
    memberDeleteBody.error?.code === "INSUFFICIENT_SCOPE",
    `Delete with write-only session should fail with INSUFFICIENT_SCOPE, got: ${JSON.stringify(memberDeleteBody)}`
  );
  assert(
    /admin/i.test(memberDeleteBody.error?.message ?? "") && /write/i.test(memberDeleteBody.error?.message ?? ""),
    `Insufficient-scope message should name both tiers, not the generic missing-token text. Got: ${memberDeleteBody.error?.message}`
  );
  const stillThere = await db("items").where({ id: memberMemoryId }).first();
  assert(stillThere, "Item must not have been deleted by a write-only (insufficient-scope) request.");
  console.log("ok - role=member session (write scope) gets a clear INSUFFICIENT_SCOPE error on memory.delete, item untouched");

  // --- Admin session: admin-tier delete succeeds --------------------------
  const adminCreate = expectData<{ item: { id: string } }>(
    unwrap(
      await callTool(
        "memory.create",
        { project: projectAId, type: "note", title: "Admin note", body: "written by admin session" },
        sessionHeaders(adminCookie)
      )
    )
  );
  adminMemoryId = adminCreate.item.id;
  const adminDelete = await callTool("memory.delete", { id: adminMemoryId }, sessionHeaders(adminCookie));
  assert(adminDelete.status === 200, `Admin session delete failed at HTTP level. Status: ${adminDelete.status}`);
  const adminDeleteBody = adminDelete.json as ToolResponse<unknown>;
  assert(adminDeleteBody.ok === true, `Admin session delete failed. ${JSON.stringify(adminDeleteBody)}`);
  const deletedRow = await db("items").where({ id: adminMemoryId }).first();
  assert(!deletedRow, "Admin session memory.delete did not actually delete the row.");
  adminMemoryId = undefined;
  console.log("ok - role=admin session can hard-delete (memory.delete succeeds, row removed)");

  // --- Project membership visibility --------------------------------------
  const memberProjectList = expectData<{ projects: { id: string }[] }>(
    unwrap(await callTool("project.list", {}, sessionHeaders(memberCookie)))
  );
  assert(
    memberProjectList.projects.some((project) => project.id === projectAId),
    "Member session should see project A (has a project_members row)."
  );
  assert(
    !memberProjectList.projects.some((project) => project.id === projectBId),
    "Member session must NOT see project B (no project_members row) in project.list."
  );
  console.log("ok - role=member session's project.list is filtered to its own project_members rows");

  const memberSearchB = await callTool("memory.search", { project: projectBId, query: "note" }, sessionHeaders(memberCookie));
  assert(memberSearchB.status === 200, "memory.search for a non-member project should be a normal 200 tool response, not an HTTP error.");
  const memberSearchBBody = memberSearchB.json as ToolResponse<unknown>;
  assert(
    memberSearchBBody.ok === false && memberSearchBBody.error.code === "PROJECT_NOT_FOUND",
    `memory.search{project:B} for a non-member should look not-found, not leak that the project exists. Got: ${JSON.stringify(memberSearchBBody)}`
  );
  console.log("ok - memory.search for a project the member isn't part of returns not-found, not a distinguishable forbidden error");

  const memberGetB = await callTool("project.get", { id: projectBId }, sessionHeaders(memberCookie));
  const memberGetBBody = memberGetB.json as ToolResponse<unknown>;
  assert(
    memberGetBBody.ok === false && memberGetBBody.error.code === "PROJECT_NOT_FOUND",
    `project.get for a non-member project should look not-found. Got: ${JSON.stringify(memberGetBBody)}`
  );
  console.log("ok - project.get for a non-member project returns not-found");

  // --- Admin bypasses membership entirely ---------------------------------
  const adminProjectList = expectData<{ projects: { id: string }[] }>(
    unwrap(await callTool("project.list", {}, sessionHeaders(adminCookie)))
  );
  assert(
    adminProjectList.projects.some((project) => project.id === projectBId),
    "Admin session must see project B even without a project_members row (decision 3: admins bypass membership filtering)."
  );
  console.log("ok - role=admin session bypasses project_members filtering entirely");

  // --- Event attribution ---------------------------------------------------
  const memberEvents = expectData<{ events: { relatedId: string | null; credentialId: string | null }[] }>(
    unwrap(await callTool("event.list", { relatedId: memberMemoryId, project: projectAId }, staticHeaders()))
  );
  const memberCreateEvent = memberEvents.events.find((event) => event.relatedId === memberMemoryId);
  assert(memberCreateEvent, "Could not find the item.created event for the member-created memory item.");
  assert(
    memberCreateEvent!.credentialId === `user:${memberUserId}`,
    `Event credentialId should attribute the member session's credential. Got: ${memberCreateEvent!.credentialId}`
  );
  console.log("ok - event.list exposes credentialId, attributing the event to the session that performed the operation");

  console.log(`Gateway scopes smoke test passed using ${started.url}`);
} finally {
  if (memberMemoryId) {
    await db("items").where({ id: memberMemoryId }).del();
  }
  if (adminMemoryId) {
    await db("items").where({ id: adminMemoryId }).del();
  }
  if (memberUserId) {
    await db("project_members").where({ user_id: memberUserId }).del();
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  if (adminUserId) {
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

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-project-memory-client-label": "Scopes Smoke Static"
  };
}

function sessionHeaders(cookie: string): Record<string, string> {
  // Deliberately no x-project-memory-client-id header: exercises the same
  // clientId-derivation path a real browser session hits, so credential
  // attribution below actually reflects `user:<id>`.
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
