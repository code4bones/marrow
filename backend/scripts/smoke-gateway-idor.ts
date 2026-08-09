// T-MEMORY-057 (whitebox pentest finding #1, I-MEMORY-055): by-id record
// operations (task.get/claim, decision.get/supersede, memory.get/update/
// archive/upsert, artifact.get/peek/read_text/update_metadata/archive, and
// the GraphQL record(id) query behind every DetailDrawer open) did not
// assert project membership -- ids are sequential/predictable, so a
// role=member could read/modify records in a project they were never added
// to just by guessing an id. Same style as smoke-gateway-project-invites.ts
// (real gateway, real Postgres, a role=member session, not a static token).
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const staticToken = `gateway-idor-smoke-static-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  auth
});

const unique = Date.now();
const memberEmail = `idor-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-idor-member-password-1";

let memberUserId: string | undefined;
let projectAId: string | undefined;
let projectBId: string | undefined;

try {
  const projectA = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: `idor-smoke-a-${unique}`, title: "IDOR Smoke A" }, staticHeaders()))
  );
  projectAId = projectA.project.id;
  const projectB = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: `idor-smoke-b-${unique}`, title: "IDOR Smoke B" }, staticHeaders()))
  );
  projectBId = projectB.project.id;

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
  await db("project_members").insert({ project_id: projectAId, user_id: memberUserId, created_at: now });
  console.log("ok - two projects created; member added to project A only (not B)");

  const memberCookie = await login(memberEmail, memberPassword);

  // --- Records created in project B (the member is NOT in) -------------------
  const taskB = expectData<{ task: { id: string } }>(
    unwrap(await callTool("task.create", { project: projectB.project.slug, title: "B task" }, staticHeaders()))
  );
  const decisionB = expectData<{ decision: { id: string } }>(
    unwrap(await callTool("decision.record", { project: projectB.project.slug, title: "B decision", decision: "..." }, staticHeaders()))
  );
  const memoryB = expectData<{ item: { id: string } }>(
    unwrap(await callTool("memory.create", { project: projectB.project.slug, type: "note", title: "B note", body: "..." }, staticHeaders()))
  );
  const artifactB = expectData<{ artifact: { id: string } }>(
    unwrap(await callTool("artifact.put_text", { project: projectB.project.slug, path: "idor-smoke.md", text: "b" }, staticHeaders()))
  );
  console.log("ok - one task/decision/memory-item/artifact created in project B via static token");

  // --- A role=member session for project A cannot reach project B's records by id ---
  const taskGetAsMember = unwrap(await callTool("task.get", { id: taskB.task.id }, sessionHeaders(memberCookie)));
  assertBlocked(taskGetAsMember, "task.get");
  const taskClaimAsMember = unwrap(await callTool("task.claim", { taskId: taskB.task.id }, sessionHeaders(memberCookie)));
  assertBlocked(taskClaimAsMember, "task.claim");
  const decisionGetAsMember = unwrap(await callTool("decision.get", { id: decisionB.decision.id }, sessionHeaders(memberCookie)));
  assertBlocked(decisionGetAsMember, "decision.get");
  const memoryGetAsMember = unwrap(await callTool("memory.get", { id: memoryB.item.id }, sessionHeaders(memberCookie)));
  assertBlocked(memoryGetAsMember, "memory.get");
  const memoryUpdateAsMember = unwrap(
    await callTool("memory.update", { id: memoryB.item.id, title: "hijacked" }, sessionHeaders(memberCookie))
  );
  assertBlocked(memoryUpdateAsMember, "memory.update");
  const artifactGetAsMember = unwrap(await callTool("artifact.get", { id: artifactB.artifact.id }, sessionHeaders(memberCookie)));
  assertBlocked(artifactGetAsMember, "artifact.get");
  console.log("ok - a role=member session cannot task.get/task.claim/decision.get/memory.get/memory.update/artifact.get across into project B by id (PROJECT_NOT_FOUND, not the record's real content)");

  // --- Same member CAN reach their own project A's records by id -------------
  const taskA = expectData<{ task: { id: string } }>(
    unwrap(await callTool("task.create", { project: projectA.project.slug, title: "A task" }, staticHeaders()))
  );
  const taskGetOwnProject = unwrap(await callTool("task.get", { id: taskA.task.id }, sessionHeaders(memberCookie)));
  assert(taskGetOwnProject.ok, "member should be able to task.get a task in their own project A.");
  console.log("ok - the same member session CAN task.get a task in their own project (no over-blocking)");

  // --- GraphQL record(id) -- the DetailDrawer's sole data source -------------
  const recordQuery = `query R($id: ID!) { record(id: $id) { id kind } }`;
  const graphqlResponse = await fetch(`${started.url}/api/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: memberCookie },
    body: JSON.stringify({ query: recordQuery, variables: { id: taskB.task.id } })
  });
  const graphqlBody = (await graphqlResponse.json()) as { data?: { record: unknown } | null; errors?: Array<{ message: string }> };
  assert(
    Boolean(graphqlBody.errors?.length) || graphqlBody.data?.record == null,
    `GraphQL record(id) for a project-B task should error or return null for a project-A-only member, got: ${JSON.stringify(graphqlBody)}`
  );
  console.log("ok - GraphQL record(id) also refuses a project-A-only member's lookup of a project-B task");

  // --- Static token / admin-equivalent bypass is unchanged --------------------
  const taskGetAsStatic = unwrap(await callTool("task.get", { id: taskB.task.id }, staticHeaders()));
  assert(taskGetAsStatic.ok, "A static-token caller should still be able to task.get any task (unchanged bypass).");
  console.log("ok - a static-token caller is unaffected (still bypasses membership entirely, same as before this fix)");

  console.log("IDOR smoke test passed.");
} finally {
  if (projectAId) {
    await db("tasks").where({ project_id: projectAId }).del();
    await db("items").where({ project_id: projectAId }).del();
    await db("decisions").where({ project_id: projectAId }).del();
    await db("artifacts").where({ project_id: projectAId }).del();
    await db("links").where({ project_id: projectAId }).del();
    await db("events").where({ project_id: projectAId }).del();
    await db("project_members").where({ project_id: projectAId }).del();
    await db("projects").where({ id: projectAId }).del();
  }
  if (projectBId) {
    await db("tasks").where({ project_id: projectBId }).del();
    await db("items").where({ project_id: projectBId }).del();
    await db("decisions").where({ project_id: projectBId }).del();
    await db("artifacts").where({ project_id: projectBId }).del();
    await db("links").where({ project_id: projectBId }).del();
    await db("events").where({ project_id: projectBId }).del();
    await db("projects").where({ id: projectBId }).del();
  }
  if (memberUserId) {
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  await started.stop();
  await service.close();
}

function assertBlocked(result: ToolResponse<unknown>, tool: string): void {
  assert(!result.ok, `${tool} should have been blocked for a non-member, but it succeeded: ${JSON.stringify(result)}`);
  if (!result.ok) {
    assert(
      result.error.code === "PROJECT_NOT_FOUND",
      `${tool} should fail with PROJECT_NOT_FOUND (don't-leak-existence), got ${result.error.code}: ${result.error.message}`
    );
  }
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
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "IDOR Smoke Static"
  };
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
  assert(result.status === 200, `Expected a 200 HTTP status, got ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json as ToolResponse<unknown>;
}

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return (response as { ok: true; data: T }).data;
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
