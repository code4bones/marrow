// SEC-4 (T-MEMORY-168): a role=member session must not be able to read or
// mutate records of projects it is not an ACTIVE member of through the
// by-id paths that used to skip assertProjectMember -- context.pack{taskId},
// event.list without a project, request.get / reply.create, link.create /
// link.list, decision.record{supersedesId}, projectGraph via a cross-project
// link. Positive controls make sure the legitimate paths still work.
// It also covers SEC-8 (T-MEMORY-172): common-scope deletes, credit IDOR,
// gateway.clients user directory, client-id impersonation.
// Same style as smoke-gateway-scopes.ts (ephemeral local gateway, real
// Postgres -- point POSTGRES_* at a DEDICATED test database, never a live one).
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-idor-smoke-token-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, { host: "127.0.0.1", port: 0, token, auth });
await service.ensureStaticTokenCredential();

const unique = Date.now();
const memberEmail = `gateway-idor-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-member-password-1";
let memberUserId: string | undefined;
const projectIds: string[] = [];

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
  const memberCookie = await login(memberEmail, memberPassword);

  const mkProject = async (name: string): Promise<string> => {
    const created = expectData<{ project: { id: string } }>(
      unwrap(await callTool("project.create", { slug: `gateway-idor-smoke-${name}-${unique}`, title: `IDOR ${name}` }, staticHeaders()))
    );
    projectIds.push(created.project.id);
    return created.project.id;
  };
  const projectA = await mkProject("a"); // the member's own project
  const projectB = await mkProject("b"); // victim project, member has no row
  const projectC = await mkProject("c"); // a third project, member has no row
  await db("project_members").insert({ project_id: projectA, user_id: memberUserId, status: "active", created_at: now });
  console.log("ok - member is an active member of project A only");

  // Victim data in B (created with the static admin-tier token).
  const taskB = expectData<{ task: { id: string } }>(
    unwrap(await callTool("task.create", { project: projectB, title: "Victim task", scope: "secret scope" }, staticHeaders()))
  ).task.id;
  const memoryB = expectData<{ item: { id: string } }>(
    unwrap(await callTool("memory.create", { project: projectB, type: "note", title: "Victim note", body: "victim body" }, staticHeaders()))
  ).item.id;
  const decisionB = expectData<{ decision: { id: string } }>(
    unwrap(
      await callTool(
        "decision.record",
        { project: projectB, title: "Victim decision", context: "c", decision: "d", rationale: "r", status: "accepted" },
        staticHeaders()
      )
    )
  ).decision.id;
  // Own data in A for positive controls.
  const taskA = expectData<{ task: { id: string } }>(
    unwrap(await callTool("task.create", { project: projectA, title: "Own task" }, sessionHeaders(memberCookie)))
  ).task.id;
  const memoryA = expectData<{ item: { id: string } }>(
    unwrap(await callTool("memory.create", { project: projectA, type: "note", title: "Own note", body: "own" }, sessionHeaders(memberCookie)))
  ).item.id;

  // Requests: A asks B (member is on the ASKING side), C asks B (member is on neither side).
  const requestAB = expectData<{ request: { id: string } }>(
    unwrap(await callTool("request.create", { project: projectB, fromProject: projectA, question: "From A to B?" }, staticHeaders()))
  ).request.id;
  const requestCB = expectData<{ request: { id: string } }>(
    unwrap(await callTool("request.create", { project: projectB, fromProject: projectC, question: "From C to B?" }, staticHeaders()))
  ).request.id;
  console.log("ok - fixtures created");

  const asMember = (tool: string, input: unknown) => callTool(tool, input, sessionHeaders(memberCookie));
  const expectNotFound = (label: string, result: { status: number; json: unknown }) => {
    const body = result.json as ToolResponse<unknown>;
    assert(result.status === 200 && body.ok === false, `${label}: expected a not-found tool error, got ${JSON.stringify(result.json).slice(0, 300)}`);
    console.log(`ok - ${label}`);
  };

  // (a) context.pack{taskId}
  expectNotFound("context.pack{taskId} of a foreign project's task is not-found", await asMember("context.pack", { taskId: taskB }));
  const packOwn = unwrap(await asMember("context.pack", { taskId: taskA }));
  assert(packOwn.ok, `context.pack for the member's own task must keep working: ${JSON.stringify(packOwn).slice(0, 300)}`);
  console.log("ok - context.pack{taskId} for the member's own task still works");

  // (b) event.list without a project, plus (f) pending-approval membership
  const eventsFor = async (input: unknown) =>
    expectData<{ events: { projectId: string | null; relatedId: string | null }[] }>(unwrap(await asMember("event.list", input))).events;
  let events = await eventsFor({ limit: 100 });
  assert(!events.some((event) => event.projectId === projectB || event.projectId === projectC), "event.list leaked another project's events.");
  assert(events.some((event) => event.projectId === projectA), "event.list must still return the member's own project events.");
  events = await eventsFor({ relatedId: taskB, limit: 100 });
  assert(events.length === 0, "event.list{relatedId} leaked events about a foreign project's record.");
  await db("project_members").insert({ project_id: projectB, user_id: memberUserId, status: "pending_approval", created_at: now });
  events = await eventsFor({ limit: 100 });
  assert(!events.some((event) => event.projectId === projectB), "A pending-approval claimant must not see the project's events.");
  await db("project_members").where({ project_id: projectB, user_id: memberUserId }).del();
  console.log("ok - event.list is membership-filtered (also for pending-approval rows), own events still visible");

  // (c) requests
  const getAB = unwrap(await asMember("request.get", { id: requestAB }));
  assert(getAB.ok, "The ASKING project's member must still read the request thread.");
  console.log("ok - request.get works for a member of the asking project");
  expectNotFound("request.get on a request between two foreign projects is not-found", await asMember("request.get", { id: requestCB }));
  expectNotFound("reply.create on a request between two foreign projects is not-found", await asMember("reply.create", { requestId: requestCB, body: "injected" }));
  const injected = await db("items").where({ type: "reply" }).whereRaw("tags @> ?::jsonb", [JSON.stringify([`thread:${requestCB}`])]);
  assert(injected.length === 0, "reply.create must not have inserted a reply into a foreign request thread.");

  // (d) links + graph
  expectNotFound("link.create toward a foreign project's record is not-found", await asMember("link.create", { project: projectA, fromId: memoryA, toId: taskB, relation: "relates_to" }));
  expectNotFound("link.create from a foreign project's record is not-found", await asMember("link.create", { project: projectA, fromId: taskB, toId: memoryA, relation: "relates_to" }));
  const okLink = unwrap(await asMember("link.create", { project: projectA, fromId: memoryA, toId: taskA, relation: "relates_to" }));
  assert(okLink.ok, "link.create between the member's own records must keep working.");
  console.log("ok - link.create inside the member's own project still works");

  await callTool("link.create", { project: projectB, fromId: taskB, toId: memoryB, relation: "relates_to" }, staticHeaders());
  const foreignLinks = expectData<{ links: unknown[] }>(unwrap(await asMember("link.list", { id: taskB })));
  assert(foreignLinks.links.length === 0, "link.list{id} leaked links of a foreign project's record.");
  const ownLinks = expectData<{ links: unknown[] }>(unwrap(await asMember("link.list", { id: taskA })));
  assert(ownLinks.links.length >= 1, "link.list must still return the member's own links.");
  console.log("ok - link.list is hidden for foreign records, works for own");

  // A pre-existing cross-project link (created by an admin) must not turn
  // the foreign record into a graph node with its title.
  await callTool("link.create", { project: projectA, fromId: memoryA, toId: taskB, relation: "relates_to" }, staticHeaders());
  const graphResponse = await fetch(`${started.url}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: memberCookie },
    body: JSON.stringify({ query: `{ projectGraph(projectId: "${projectA}") { nodes { id title } } }` })
  });
  const graph = (await graphResponse.json()) as { data?: { projectGraph: { nodes: { id: string; title: string }[] } }; errors?: unknown };
  assert(graph.data, `projectGraph query failed: ${JSON.stringify(graph).slice(0, 300)}`);
  assert(!graph.data.projectGraph.nodes.some((node) => node.id === taskB), "projectGraph leaked a foreign project's record as a node.");
  assert(graph.data.projectGraph.nodes.some((node) => node.id === memoryA), "projectGraph must still contain the member's own nodes.");
  console.log("ok - projectGraph omits foreign records reachable through a cross-project link");

  // (e) supersedes
  expectNotFound(
    "decision.record{supersedesId} of a foreign decision is not-found",
    await asMember("decision.record", {
      project: projectA, title: "Hostile", context: "c", decision: "d", rationale: "r", supersedesId: decisionB
    })
  );
  const victimDecision = await db("decisions").where({ id: decisionB }).first();
  assert(victimDecision?.status === "accepted", `The foreign decision must stay accepted, is: ${victimDecision?.status}`);
  console.log("ok - foreign decision was not flipped to superseded");

  // ---- SEC-8 ---------------------------------------------------------------
  // A second member, so there is another user's identity/wallet to target.
  const otherEmail = `gateway-idor-smoke-other-${unique}@example.test`;
  const otherUserId = randomUUID();
  await db("users").insert({
    id: otherUserId, email: otherEmail, password_hash: await hashPassword(memberPassword),
    email_verified_at: now, totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });
  const otherCookie = await login(otherEmail, memberPassword);
  unwrap(await callTool("project.list", {}, sessionHeaders(otherCookie))); // creates the user:<other> client row
  try {
    // common-scope deletes
    const commonByStatic = expectData<{ item: { id: string } }>(
      unwrap(await callTool("memory.create", { common: true, type: "note", title: "Shared rule", body: "common" }, staticHeaders()))
    ).item.id;
    const commonByMember = expectData<{ item: { id: string } }>(
      unwrap(await asMember("memory.create", { common: true, type: "note", title: "Member's own common note", body: "mine" }))
    ).item.id;
    const denied = (await asMember("memory.delete", { id: commonByStatic })).json as ToolResponse<unknown>;
    assert(denied.ok === false && denied.error.code === "UNAUTHORIZED", `A member must not delete someone else's common record: ${JSON.stringify(denied).slice(0, 200)}`);
    assert(await db("items").where({ id: commonByStatic }).first(), "The common record must still exist.");
    console.log("ok - member cannot delete a common-scope record they did not author");
    const own = (await asMember("memory.delete", { id: commonByMember })).json as ToolResponse<unknown>;
    assert(own.ok === true, `A member must still be able to delete their own common record: ${JSON.stringify(own).slice(0, 200)}`);
    console.log("ok - member can delete their own common-scope record");
    const commonEvent = await db("events").whereNull("project_id").first();
    if (commonEvent) {
      const evDenied = (await asMember("event.delete", { id: commonEvent.id })).json as ToolResponse<unknown>;
      assert(evDenied.ok === false, "A member must not delete a common-scope (audit) event.");
      assert(await db("events").where({ id: commonEvent.id }).first(), "The common event must still exist.");
      console.log("ok - member cannot delete a common-scope event");
    }
    await db("items").where({ id: commonByStatic }).del();

    // credits IDOR
    const credDenied = (await asMember("credit.history", { userId: otherUserId })).json as ToolResponse<unknown>;
    assert(credDenied.ok === false && credDenied.error.code === "UNAUTHORIZED", "credit.history for another user must be denied to a member.");
    const credBalanceDenied = (await asMember("credit.balance", { userId: otherUserId })).json as ToolResponse<unknown>;
    assert(credBalanceDenied.ok === false, "credit.balance for another user must be denied to a member.");
    assert(unwrap(await asMember("credit.balance", {})).ok, "A member must still read their own balance.");
    assert(unwrap(await asMember("credit.balance", { userId: memberUserId })).ok, "A member must still read their own balance by explicit id.");
    console.log("ok - credit.balance/history are self-only for members");

    // user directory
    const clientsSeen = expectData<{ clients: { id: string }[] }>(unwrap(await asMember("gateway.clients", { limit: 100 }))).clients;
    assert(!clientsSeen.some((client) => client.id === `user:${otherUserId}`), "gateway.clients leaked another user's client row (email label).");
    const staticSeen = expectData<{ clients: { id: string }[] }>(unwrap(await callTool("gateway.clients", { limit: 100 }, staticHeaders()))).clients;
    assert(staticSeen.some((client) => client.id === `user:${otherUserId}`), "Control: the static token should still see every client.");
    const getOther = (await asMember("gateway.client_get", { id: `user:${otherUserId}` })).json as ToolResponse<unknown>;
    assert(getOther.ok === false, "gateway.client_get on another user's client must be denied to a member.");
    console.log("ok - gateway.clients / client_get do not expose other users to a member");

    // client-id impersonation
    const spoofed = expectData<{ item: { id: string } }>(
      unwrap(await callTool("memory.create", { project: projectA, type: "note", title: "Spoof", body: "x" }, {
        ...sessionHeaders(memberCookie), "x-project-memory-client-id": `user:${otherUserId}`
      }))
    ).item.id;
    const spoofRow = await db("items").where({ id: spoofed }).first();
    assert(spoofRow?.created_by === `user:${memberUserId}`, `Impersonation: created_by was ${spoofRow?.created_by}, expected user:${memberUserId}.`);
    console.log("ok - an authenticated member cannot claim another user's client id");

    // private common-scope events (SEC-8/11): visible to their author and admins only
    const mkEvent = async (type: string, createdBy: string) => {
      const id = `E-COMMON-SMOKE-${type.replace(/\W/g, "")}-${createdBy.replace(/\W/g, "")}-${unique}`;
      await db("events").insert({
        id, project_id: null, type, title: `smoke ${type}`, body: null, related_id: null, agent_name: null,
        target_user_ids: JSON.stringify([]), created_by: createdBy, source_instance_id: createdBy, created_at: new Date().toISOString()
      });
      return id;
    };
    const otherPrivate = await mkEvent("git_credential.created", `user:${otherUserId}`);
    const ownPrivate = await mkEvent("git_credential.created", `user:${memberUserId}`);
    const publicCommon = await mkEvent("item.created", `user:${otherUserId}`);
    try {
      const seenIds = async (headers: Record<string, string>) =>
        expectData<{ events: { id: string }[] }>(unwrap(await callTool("event.list", { limit: 100 }, headers))).events.map((event) => event.id);
      const memberSees = await seenIds(sessionHeaders(memberCookie));
      assert(!memberSees.includes(otherPrivate), "A member must not see another user's private common event (git credential).");
      assert(memberSees.includes(ownPrivate), "A member must still see their own private common events.");
      assert(memberSees.includes(publicCommon), "Ordinary common events stay visible to members.");
      const staticSees = await seenIds(staticHeaders());
      assert(staticSees.includes(otherPrivate) && staticSees.includes(ownPrivate), "Admin-tier callers see every common event.");
      console.log("ok - private common events (git/env/user housekeeping) are visible to admins and their author only");
    } finally {
      await db("events").whereIn("id", [otherPrivate, ownPrivate, publicCommon]).del();
    }
  } finally {
    await db("sessions").where({ user_id: otherUserId }).del();
    await db("gateway_clients").where({ id: `user:${otherUserId}` }).del();
    await db("users").where({ id: otherUserId }).del();
  }
} finally {
  if (memberUserId) {
    await db("project_members").where({ user_id: memberUserId }).del();
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  for (const id of projectIds) {
    await db("links").where({ project_id: id }).del();
    await db("events").where({ project_id: id }).del();
    await db("items").where({ project_id: id }).del();
    await db("tasks").where({ project_id: id }).del();
    await db("decisions").where({ project_id: id }).del();
    await db("projects").where({ id }).del();
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
  return { authorization: `Bearer ${token}`, "x-project-memory-client-label": "IDOR Smoke Static" };
}
function sessionHeaders(cookie: string): Record<string, string> {
  return { cookie };
}
async function callTool(tool: string, input: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
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
  return raw ? (raw.split(";")[0] ?? null) : null;
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
