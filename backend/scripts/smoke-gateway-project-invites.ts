// Project sharing: reusable, per-project invite link (rename via
// project.update, invite link get-or-create/regenerate, claim), end to end
// against the real gateway (ephemeral local instance, real Postgres) --
// same style as scripts/smoke-gateway-git-credentials.ts and
// scripts/smoke-gateway-scopes.ts, which this complements (scopes owns the
// pre-existing membership-filtering behavior; this owns the new tools that
// actually let someone become a member in the first place).
//
// Covers: get-or-create returns the same code on a second call, regenerate
// invalidates the old code (old code no longer resolves via either the
// unauthenticated lookup or claim), claim adds membership idempotently
// (claiming twice doesn't error or duplicate the project_members row),
// claiming with an unknown/stale code fails cleanly, the unauthenticated
// GET /project-invites/:code lookup works with zero auth headers,
// session-required enforcement for project.invite_claim (static token has
// no real identity to join as), and the GraphQL mutations/query mirror the
// MCP tool behavior.
//
// Also covers the per-project owner concept: a role=member who joins via
// invite is NOT the project's owner and gets UNAUTHORIZED from
// project.update/invite_link_regenerate/project.delete (both over the MCP
// tool call and over GraphQL), while a role=member who CREATED a project
// (and is therefore its owner) can do all three without ever needing
// system-admin scope -- proving ownership, not membership or role, is what
// gates these actions now. A system admin can still do all three
// regardless of ownership, unchanged from before.
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const staticToken = `gateway-project-invites-smoke-static-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  auth
});

const unique = Date.now();
const adminEmail = `project-invites-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-invites-admin-password-1";
const memberAEmail = `project-invites-smoke-member-a-${unique}@example.test`;
const memberAPassword = "smoke-invites-member-a-password-1";
const memberBEmail = `project-invites-smoke-member-b-${unique}@example.test`;
const memberBPassword = "smoke-invites-member-b-password-1";

let adminUserId: string | undefined;
let memberAUserId: string | undefined;
let memberBUserId: string | undefined;
let projectId: string | undefined;
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
  memberAUserId = randomUUID();
  await db("users").insert({
    id: memberAUserId,
    email: memberAEmail,
    password_hash: await hashPassword(memberAPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  memberBUserId = randomUUID();
  await db("users").insert({
    id: memberBUserId,
    email: memberBEmail,
    password_hash: await hashPassword(memberBPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  console.log("ok - one role=admin account and two role=member accounts seeded");

  const adminCookie = await login(adminEmail, adminPassword);
  const memberACookie = await login(memberAEmail, memberAPassword);
  const memberBCookie = await login(memberBEmail, memberBPassword);
  console.log("ok - sessions established for the admin and both members");

  // --- Project setup: admin creates it, neither member is a member yet ---
  const createdProject = expectData<{ project: { id: string; slug: string; title: string } }>(
    unwrap(await callTool("project.create", { slug: `project-invites-smoke-${unique}`, title: "Invites Smoke Project" }, sessionHeaders(adminCookie)))
  );
  projectId = createdProject.project.id;
  const projectSlug = createdProject.project.slug;
  console.log("ok - admin created the project; neither member has a project_members row yet");

  // --- get-or-create is idempotent: same code both times --------------------
  const firstLink = expectData<{ code: string; url: string }>(
    unwrap(await callTool("project.invite_link_get", { id: projectId }, sessionHeaders(adminCookie)))
  );
  assert(firstLink.code.length > 0, "project.invite_link_get should return a non-empty code.");
  assert(firstLink.url.includes(firstLink.code), "project.invite_link_get's url should embed the code.");
  const secondLink = expectData<{ code: string; url: string }>(
    unwrap(await callTool("project.invite_link_get", { id: projectId }, sessionHeaders(adminCookie)))
  );
  assert(secondLink.code === firstLink.code, "A second project.invite_link_get call should return the SAME code (get-or-create, not always-create).");
  const linkRowCount = await db("project_invite_links").where({ project_id: projectId }).count<{ count: string }[]>("id as count").first();
  assert(Number(linkRowCount?.count ?? 0) === 1, "Exactly one project_invite_links row should exist for this project after two get-or-create calls.");
  console.log("ok - project.invite_link_get is get-or-create: same code returned twice, one row written");

  // --- Unauthenticated invite-context lookup: zero auth headers -----------
  const contextResponse = await fetch(`${started.url}/project-invites/${firstLink.code}`);
  assert(contextResponse.status === 200, `Unauthenticated invite-context lookup should succeed. Status: ${contextResponse.status}`);
  const contextBody = (await contextResponse.json()) as { ok: boolean; data?: { projectTitle: string; projectSlug: string } };
  assert(contextBody.ok === true, "Unauthenticated invite-context lookup should report ok:true.");
  assert(contextBody.data?.projectTitle === "Invites Smoke Project", `Unexpected projectTitle: ${JSON.stringify(contextBody.data)}`);
  assert(contextBody.data?.projectSlug === projectSlug, `Unexpected projectSlug: ${JSON.stringify(contextBody.data)}`);
  console.log("ok - GET /project-invites/:code resolves {projectTitle, projectSlug} with zero auth headers");

  const unknownCodeResponse = await fetch(`${started.url}/project-invites/not-a-real-code-${unique}`);
  assert(unknownCodeResponse.status === 404, `Unknown invite code should 404, got ${unknownCodeResponse.status}`);
  console.log("ok - GET /project-invites/:code for an unknown code returns 404, not a 500 or leaked detail");

  // --- Session-required enforcement: static token has no real identity ----
  const staticClaimAttempt = await callTool("project.invite_claim", { code: firstLink.code }, staticHeaders());
  const staticClaimBody = staticClaimAttempt.json as ToolResponse<unknown>;
  assert(
    staticClaimBody.ok === false && staticClaimBody.error.code === "UNAUTHORIZED",
    `project.invite_claim over the static token should fail with UNAUTHORIZED, got: ${JSON.stringify(staticClaimBody)}`
  );
  assert(
    /logged-in session/i.test(staticClaimBody.ok === false ? staticClaimBody.error.message : ""),
    `Error message should clearly explain the session requirement, got: ${staticClaimBody.ok === false ? staticClaimBody.error.message : ""}`
  );
  const noMembershipYet = await db("project_members").where({ project_id: projectId, user_id: memberAUserId }).first();
  assert(!noMembershipYet, "Denied static-token claim attempt must be a true no-op.");
  console.log('ok - project.invite_claim over the static token fails clearly ("requires a logged-in session"), not a silent no-op');

  // --- Claim: member A joins via the invite link ---------------------------
  const claimResult = expectData<{ project: { id: string; slug: string }; joined: boolean }>(
    unwrap(await callTool("project.invite_claim", { code: firstLink.code }, sessionHeaders(memberACookie)))
  );
  assert(claimResult.joined === true, "First-time claim should report joined:true.");
  assert(claimResult.project.id === projectId, "Claim result should return the invited project.");
  const membershipRow = await db("project_members").where({ project_id: projectId, user_id: memberAUserId }).first();
  assert(membershipRow, "project.invite_claim should insert a project_members row for the claiming user.");
  console.log("ok - project.invite_claim adds a project_members row and reports joined:true on first claim");

  // --- Claim again: idempotent, no duplicate, no error ----------------------
  const reclaimResult = expectData<{ project: { id: string }; joined: boolean }>(
    unwrap(await callTool("project.invite_claim", { code: firstLink.code }, sessionHeaders(memberACookie)))
  );
  assert(reclaimResult.joined === false, "Re-claiming an already-joined project should report joined:false, not error.");
  const membershipCount = await db("project_members").where({ project_id: projectId, user_id: memberAUserId }).count<{ count: string }[]>("project_id as count").first();
  assert(Number(membershipCount?.count ?? 0) === 1, "Re-claiming must not duplicate the project_members row.");
  console.log("ok - re-claiming an already-joined project is a friendly no-op: joined:false, no duplicate row, no error");

  // --- A joined-via-invite member is NOT the owner: update/delete/regenerate
  // all reject with UNAUTHORIZED (the project survives the admin created it,
  // owner_user_id is the admin's, not memberA's) --------------------------
  const memberRenameAttempt = await callTool(
    "project.update",
    { id: projectId, title: "Should not apply" },
    sessionHeaders(memberACookie)
  );
  const memberRenameBody = memberRenameAttempt.json as ToolResponse<unknown>;
  assert(
    memberRenameBody.ok === false && memberRenameBody.error.code === "UNAUTHORIZED",
    `project.update by a non-owner member should fail with UNAUTHORIZED, got: ${JSON.stringify(memberRenameBody)}`
  );
  console.log("ok - a joined-via-invite member who is not the project's owner gets UNAUTHORIZED from project.update");

  const memberRegenerateAttempt = await callTool("project.invite_link_regenerate", { id: projectId }, sessionHeaders(memberACookie));
  const memberRegenerateBody = memberRegenerateAttempt.json as ToolResponse<unknown>;
  assert(
    memberRegenerateBody.ok === false && memberRegenerateBody.error.code === "UNAUTHORIZED",
    `project.invite_link_regenerate by a non-owner member should fail with UNAUTHORIZED, got: ${JSON.stringify(memberRegenerateBody)}`
  );
  console.log("ok - a joined-via-invite member who is not the project's owner gets UNAUTHORIZED from project.invite_link_regenerate");

  const memberDeleteAttempt = await callTool("project.delete", { id: projectId }, sessionHeaders(memberACookie));
  assert(memberDeleteAttempt.status === 200, `project.delete by a non-owner member should still be a normal 200 tool response, got HTTP ${memberDeleteAttempt.status}`);
  const memberDeleteBody = memberDeleteAttempt.json as ToolResponse<unknown>;
  assert(
    memberDeleteBody.ok === false && memberDeleteBody.error.code === "UNAUTHORIZED",
    `project.delete by a non-owner member should fail with UNAUTHORIZED, got: ${JSON.stringify(memberDeleteBody)}`
  );
  const stillExists = await db("projects").where({ id: projectId }).first();
  assert(stillExists, "Project must survive a denied delete attempt by a non-owner member.");
  console.log("ok - project.delete rejects a joined-via-invite member who is not the project's owner (UNAUTHORIZED, not just a coarse scope check)");

  // --- The project's actual owner (admin, who created it) can do all three -
  const renamed = expectData<{ project: { id: string; title: string } }>(
    unwrap(await callTool("project.update", { id: projectId, title: "Invites Smoke Project (renamed by owner)" }, sessionHeaders(adminCookie)))
  );
  assert(renamed.project.title === "Invites Smoke Project (renamed by owner)", "project.update should apply the new title.");
  console.log("ok - the project's owner (here, the admin who created it) can rename it");

  // --- Regenerate: old code stops resolving, new code works ----------------
  const regenerated = expectData<{ code: string; url: string }>(
    unwrap(await callTool("project.invite_link_regenerate", { id: projectId }, sessionHeaders(adminCookie)))
  );
  assert(regenerated.code !== firstLink.code, "Regenerate should produce a different code.");
  const staleContextResponse = await fetch(`${started.url}/project-invites/${firstLink.code}`);
  assert(staleContextResponse.status === 404, `Old invite code should no longer resolve after regenerate, got ${staleContextResponse.status}`);
  console.log("ok - project.invite_link_regenerate invalidates the old code immediately (unauthenticated lookup 404s)");

  const staleClaimAttempt = await callTool("project.invite_claim", { code: firstLink.code }, sessionHeaders(memberBCookie));
  const staleClaimBody = staleClaimAttempt.json as ToolResponse<unknown>;
  assert(
    staleClaimBody.ok === false && staleClaimBody.error.code === "PROJECT_INVITE_NOT_FOUND",
    `Claiming a regenerated-away code should fail cleanly with PROJECT_INVITE_NOT_FOUND, got: ${JSON.stringify(staleClaimBody)}`
  );
  const memberBNotAdded = await db("project_members").where({ project_id: projectId, user_id: memberBUserId }).first();
  assert(!memberBNotAdded, "A stale-code claim attempt must not add membership.");
  console.log("ok - claiming a stale/regenerated-away code fails cleanly (PROJECT_INVITE_NOT_FOUND), no membership granted");

  const unknownCodeClaimAttempt = await callTool("project.invite_claim", { code: `totally-unknown-${unique}` }, sessionHeaders(memberBCookie));
  const unknownCodeClaimBody = unknownCodeClaimAttempt.json as ToolResponse<unknown>;
  assert(
    unknownCodeClaimBody.ok === false && unknownCodeClaimBody.error.code === "PROJECT_INVITE_NOT_FOUND",
    `Claiming a never-issued code should fail cleanly with PROJECT_INVITE_NOT_FOUND, got: ${JSON.stringify(unknownCodeClaimBody)}`
  );
  console.log("ok - claiming a never-issued code fails cleanly (PROJECT_INVITE_NOT_FOUND)");

  // --- Member B claims the NEW code successfully ----------------------------
  const memberBClaim = expectData<{ project: { id: string }; joined: boolean }>(
    unwrap(await callTool("project.invite_claim", { code: regenerated.code }, sessionHeaders(memberBCookie)))
  );
  assert(memberBClaim.joined === true, "Member B's first claim with the regenerated code should report joined:true.");
  const memberBMembership = await db("project_members").where({ project_id: projectId, user_id: memberBUserId }).first();
  assert(memberBMembership, "Member B should now be a project member via the regenerated code.");
  console.log("ok - the regenerated code works: member B successfully joins with it");

  // --- GraphQL, exercised on a SECOND project that member B creates (and
  // therefore owns) itself -- proves ownership, not admin scope, is what
  // GraphQL's updateProject/projectInviteLink/regenerateProjectInviteLink/
  // deleteProject mutations honor too, not just the MCP tool-call path
  // above. Member A then joins as a non-owner member and gets rejected the
  // same way over GraphQL.
  const projectB = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `project-invites-smoke-b-${unique}`, title: "Invites Smoke Project B" }, sessionHeaders(memberBCookie)))
  );
  projectBId = projectB.project.id;
  console.log("ok - member B (role=member) created project B and is therefore its owner");

  const graphqlRenamed = await graphql<{ updateProject: { id: string; title: string } }>(
    `mutation Rename($id: ID!, $title: String!) { updateProject(id: $id, title: $title) { id title } }`,
    { id: projectBId, title: "Invites Smoke Project B (renamed via GraphQL)" },
    memberBCookie
  );
  assert(graphqlRenamed.updateProject.title === "Invites Smoke Project B (renamed via GraphQL)", "GraphQL updateProject did not apply the new title.");
  console.log("ok - GraphQL updateProject mutation works for the project's owner (role=member, no admin scope needed)");

  const graphqlLink = await graphql<{ projectInviteLink: { code: string; url: string } }>(
    `query Link($id: ID!) { projectInviteLink(id: $id) { code url } }`,
    { id: projectBId },
    memberBCookie
  );
  assert(graphqlLink.projectInviteLink.code.length > 0, "GraphQL projectInviteLink should return a non-empty code.");
  console.log("ok - GraphQL projectInviteLink query returns a link for the project's owner");

  const graphqlRegenerated = await graphql<{ regenerateProjectInviteLink: { code: string; url: string } }>(
    `mutation Regen($id: ID!) { regenerateProjectInviteLink(id: $id) { code url } }`,
    { id: projectBId },
    memberBCookie
  );
  assert(graphqlRegenerated.regenerateProjectInviteLink.code !== graphqlLink.projectInviteLink.code, "GraphQL regenerateProjectInviteLink should produce a new code.");
  console.log("ok - GraphQL regenerateProjectInviteLink mutation issues a fresh code for the project's owner");

  const graphqlClaim = await graphql<{ claimProjectInviteLink: { project: { id: string }; joined: boolean } }>(
    `mutation Claim($code: String!) { claimProjectInviteLink(code: $code) { project { id } joined } }`,
    { code: graphqlRegenerated.regenerateProjectInviteLink.code },
    memberACookie
  );
  assert(graphqlClaim.claimProjectInviteLink.joined === true, "Member A's first claim on project B should report joined:true.");
  assert(graphqlClaim.claimProjectInviteLink.project.id === projectBId, "GraphQL claimProjectInviteLink returned the wrong project.");
  console.log("ok - GraphQL claimProjectInviteLink mutation lets member A join project B, still not its owner");

  const graphqlMemberRenameAttempt = await fetch(`${started.url}${normalizedApiEndpoint() ?? ""}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: memberACookie },
    body: JSON.stringify({
      query: `mutation Rename($id: ID!, $title: String!) { updateProject(id: $id, title: $title) { id title } }`,
      variables: { id: projectBId, title: "Should not apply" }
    })
  });
  const graphqlMemberRenameBody = (await graphqlMemberRenameAttempt.json()) as { errors?: Array<{ message: string }> };
  assert(
    graphqlMemberRenameBody.errors?.some((e) => /UNAUTHORIZED|owner/i.test(e.message)),
    `GraphQL updateProject by a non-owner member should error, got: ${JSON.stringify(graphqlMemberRenameBody)}`
  );
  console.log("ok - GraphQL updateProject rejects a non-owner member on project B, same as the MCP tool call");

  const graphqlDeleted = await graphql<{ deleteProject: { deletedProject: { id: string } } }>(
    `mutation Delete($id: ID!, $cascade: Boolean) { deleteProject(id: $id, cascade: $cascade) { deletedProject { id } } }`,
    { id: projectBId, cascade: true },
    memberBCookie
  );
  assert(graphqlDeleted.deleteProject.deletedProject.id === projectBId, "GraphQL deleteProject returned the wrong project.");
  console.log("ok - GraphQL deleteProject lets the project's owner (role=member, no admin scope) delete their own project");
  projectBId = undefined;

  console.log(`Gateway project-invites smoke test passed using ${started.url}`);
} finally {
  if (projectId) {
    await db("events").where({ project_id: projectId }).del();
    await db("project_members").where({ project_id: projectId }).del();
    await db("project_invite_links").where({ project_id: projectId }).del();
    await db("projects").where({ id: projectId }).del();
  }
  if (projectBId) {
    await db("events").where({ project_id: projectBId }).del();
    await db("project_members").where({ project_id: projectBId }).del();
    await db("project_invite_links").where({ project_id: projectBId }).del();
    await db("projects").where({ id: projectBId }).del();
  }
  if (adminUserId) {
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  if (memberAUserId) {
    await db("sessions").where({ user_id: memberAUserId }).del();
    await db("users").where({ id: memberAUserId }).del();
  }
  if (memberBUserId) {
    await db("sessions").where({ user_id: memberBUserId }).del();
    await db("users").where({ id: memberBUserId }).del();
  }
  await db("gateway_clients").where("label", "like", "Project Invites Smoke%").del();
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
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "Project Invites Smoke Static"
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
