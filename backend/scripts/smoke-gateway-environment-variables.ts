// Marrow-native "Environment Variables" domain (owner's request,
// 2026-09-14), end to end against the real gateway (ephemeral local
// instance, real Postgres) -- same style as
// scripts/smoke-gateway-git-credentials.ts. NOT GitLab CI/CD variables
// (git.variable_*, already covered by that script); this is Marrow's own
// .env-style store.
//
// Covers: common (profile-scoped) variable set/get/list round trip and
// privacy (one user cannot see another's common variables) -> secret
// masking by default with a redact:false opt-out -> project-scoped
// variables visible to any project member on read, but writable only by
// the project owner (assertProjectOwnerOrAdmin, a plain member gets
// UNAUTHORIZED) -> the merge rule on env.variables_list/variable_get when
// both a common and a same-keyed project variable exist (project wins) ->
// delete round trip + NOT_FOUND on a missing key -> a static-token caller
// (no sessionUserId) rejected on write with a clear error -> the GraphQL
// equivalents (setEnvironmentVariable/deleteEnvironmentVariable/
// environmentVariables/environmentVariable).
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}
if (!process.env.ENV_VAR_ENC_KEY) {
  process.env.ENV_VAR_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const unique = Date.now();

const db = createPgKnex();
const service = new PgToolService(db);
const staticToken = `gateway-env-vars-smoke-static-${unique}`;
const auth = createAuthFacade(db);
const publicUrl = "https://pmem-env-vars-smoke.example/api";

const oauth = createOAuthFacadeFromEnv({
  ...process.env,
  PROJECT_MEMORY_PUBLIC_URL: publicUrl,
  PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
  PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl
}, db);
assert(oauth, "OAuth facade was not created.");

const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  oauth,
  auth
});
const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;

const ownerEmail = `env-vars-smoke-owner-${unique}@example.test`;
const ownerPassword = "smoke-env-vars-owner-password-1";
const memberEmail = `env-vars-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-env-vars-member-password-1";
const outsiderEmail = `env-vars-smoke-outsider-${unique}@example.test`;
const outsiderPassword = "smoke-env-vars-outsider-password-1";

let ownerUserId: string | undefined;
let memberUserId: string | undefined;
let outsiderUserId: string | undefined;
let projectSlug: string | undefined;

try {
  const now = new Date();
  ownerUserId = randomUUID();
  await db("users").insert({
    id: ownerUserId, email: ownerEmail, password_hash: await hashPassword(ownerPassword),
    email_verified_at: now, totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });
  memberUserId = randomUUID();
  await db("users").insert({
    id: memberUserId, email: memberEmail, password_hash: await hashPassword(memberPassword),
    email_verified_at: now, totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });
  outsiderUserId = randomUUID();
  await db("users").insert({
    id: outsiderUserId, email: outsiderEmail, password_hash: await hashPassword(outsiderPassword),
    email_verified_at: now, totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });
  console.log("ok - project owner, a project member, and an unrelated outsider seeded");

  const ownerCookie = await login(ownerEmail, ownerPassword);
  const memberCookie = await login(memberEmail, memberPassword);
  const outsiderCookie = await login(outsiderEmail, outsiderPassword);
  console.log("ok - sessions established for all three accounts");

  // --- Common (profile-scoped) variables ----------------------------------
  const setCommon = expectData<{ key: string; value: string; secret: boolean; scope: string }>(
    unwrap(await callTool("env.variable_set", { key: "MY_API_KEY", value: "sk-owner-secret-000", secret: true }, sessionHeaders(ownerCookie)))
  );
  assert(setCommon.scope === "user" && setCommon.value === "sk-owner-secret-000", `env.variable_set (no project) should echo the real value unredacted. Got: ${JSON.stringify(setCommon)}`);
  console.log("ok - env.variable_set with no project creates a common (profile-scoped) variable, echoed back unredacted");

  const getCommonMasked = expectData<{ value: string }>(
    unwrap(await callTool("env.variable_get", { key: "MY_API_KEY" }, sessionHeaders(ownerCookie)))
  );
  assert(getCommonMasked.value === "[MASKED]", `secret:true variable should read masked by default. Got: ${JSON.stringify(getCommonMasked)}`);
  console.log("ok - env.variable_get masks a secret:true value by default");

  const getCommonUnmasked = expectData<{ value: string }>(
    unwrap(await callTool("env.variable_get", { key: "MY_API_KEY", redact: false }, sessionHeaders(ownerCookie)))
  );
  assert(getCommonUnmasked.value === "sk-owner-secret-000", "redact:false should return the real value.");
  console.log("ok - env.variable_get redact:false returns the real value");

  const memberSeesOwnerCommon = expectData<{ variables: unknown[] }>(
    unwrap(await callTool("env.variables_list", {}, sessionHeaders(memberCookie)))
  );
  assert(memberSeesOwnerCommon.variables.length === 0, "Another user's common variables must never appear in someone else's list.");
  console.log("ok - common (profile-scoped) variables are private to their owner, not visible to another user");

  // --- Project-scoped variables --------------------------------------------
  projectSlug = `env-vars-smoke-project-${unique}`;
  const { project } = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: projectSlug, title: "Env Vars Smoke Project" }, sessionHeaders(ownerCookie)))
  );
  await db("project_members").insert({ project_id: project.id, user_id: memberUserId, role: "developer", status: "active", created_at: new Date() });
  console.log("ok - project created (owner) and a second user added as a plain member");

  const memberSetAttempt = await callTool("env.variable_set", { key: "SHARED_BASE_URL", value: "https://api.example.test", project: projectSlug }, sessionHeaders(memberCookie));
  assert(memberSetAttempt.status === 200, `Expected a normal tool-response envelope. Status: ${memberSetAttempt.status}`);
  assertFailureCode(unwrap(memberSetAttempt), "UNAUTHORIZED", "A plain project member (not owner/admin) must not be able to set a project-scoped environment variable.");
  console.log("ok - a plain project member cannot set a project-scoped variable (owner/admin only)");

  const ownerSetProject = expectData<{ scope: string; value: string }>(
    unwrap(await callTool("env.variable_set", { key: "SHARED_BASE_URL", value: "https://api.example.test", project: projectSlug }, sessionHeaders(ownerCookie)))
  );
  assert(ownerSetProject.scope === "project" && ownerSetProject.value === "https://api.example.test", `Project owner's env.variable_set failed. Got: ${JSON.stringify(ownerSetProject)}`);
  console.log("ok - the project owner can set a project-scoped variable");

  const memberReadsProjectVar = expectData<{ value: string }>(
    unwrap(await callTool("env.variable_get", { key: "SHARED_BASE_URL", project: projectSlug }, sessionHeaders(memberCookie)))
  );
  assert(memberReadsProjectVar.value === "https://api.example.test", "A plain project member should still be able to READ a project-scoped variable.");
  console.log("ok - a plain project member can read (though not write) a project-scoped variable");

  const outsiderReadAttempt = await callTool("env.variable_get", { key: "SHARED_BASE_URL", project: projectSlug }, sessionHeaders(outsiderCookie));
  assertFailureCode(unwrap(outsiderReadAttempt), "PROJECT_NOT_FOUND", "A non-member must not be able to read a project's environment variables (same not-found-not-forbidden convention as every other project-scoped read).");
  console.log("ok - a non-member cannot read a project's environment variables at all");

  // --- Merge rule: project overrides a same-keyed common variable ---------
  await callTool("env.variable_set", { key: "SHARED_BASE_URL", value: "https://common-default.example.test" }, sessionHeaders(ownerCookie));
  const mergedList = expectData<{ variables: Array<{ key: string; value: string; scope: string }> }>(
    unwrap(await callTool("env.variables_list", { project: projectSlug }, sessionHeaders(ownerCookie)))
  );
  const mergedShared = mergedList.variables.find((v) => v.key === "SHARED_BASE_URL");
  assert(mergedShared?.scope === "project" && mergedShared.value === "https://api.example.test", `Project value should win over the caller's own common value with the same key. Got: ${JSON.stringify(mergedShared)}`);
  const mergedApiKey = mergedList.variables.find((v) => v.key === "MY_API_KEY");
  assert(mergedApiKey?.scope === "user", "The caller's own common variables not overridden by the project should still appear in the merged list.");
  console.log("ok - env.variables_list(project) merges the caller's common variables with the project's, project winning on key collision");

  // --- Delete round trip + NOT_FOUND -----------------------------------
  const deleted = expectData<{ deleted: boolean }>(
    unwrap(await callTool("env.variable_delete", { key: "MY_API_KEY" }, sessionHeaders(ownerCookie)))
  );
  assert(deleted.deleted === true, "env.variable_delete should report deleted: true.");
  const getAfterDelete = await callTool("env.variable_get", { key: "MY_API_KEY" }, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(getAfterDelete), "NOT_FOUND", "Getting a deleted variable should fail with NOT_FOUND.");
  const deleteAgain = await callTool("env.variable_delete", { key: "MY_API_KEY" }, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(deleteAgain), "NOT_FOUND", "Deleting an already-deleted key should fail cleanly, not silently succeed or 500.");
  console.log("ok - env.variable_delete actually removes the row; re-getting or re-deleting fails with NOT_FOUND");

  // --- No authenticated identity at all ------------------------------------
  const staticSetAttempt = await callTool("env.variable_set", { key: "SHOULD_NOT_BE_SET", value: "nope" }, staticHeaders());
  assertFailureCode(unwrap(staticSetAttempt), "UNAUTHORIZED", "A static-token caller (no sessionUserId) must not be able to set a common environment variable.");
  console.log("ok - a caller with no authenticated identity cannot set a common environment variable");

  // --- GraphQL equivalents --------------------------------------------------
  const gqlSet = await graphql<{ setEnvironmentVariable: { key: string; value: string } }>(
    `mutation($key: String!, $value: String!) { setEnvironmentVariable(key: $key, value: $value) { key value } }`,
    { key: "GQL_VAR", value: "gql-value" },
    ownerCookie
  );
  assert(gqlSet.setEnvironmentVariable.value === "gql-value", "GraphQL setEnvironmentVariable did not return the value just set.");

  const gqlList = await graphql<{ environmentVariables: Array<{ key: string }> }>(
    `query { environmentVariables { key } }`,
    {},
    ownerCookie
  );
  assert(gqlList.environmentVariables.some((v) => v.key === "GQL_VAR"), "GraphQL environmentVariables should list the variable just created via GraphQL.");

  const gqlGet = await graphql<{ environmentVariable: { value: string } | null }>(
    `query($key: String!) { environmentVariable(key: $key) { value } }`,
    { key: "GQL_VAR" },
    ownerCookie
  );
  assert(gqlGet.environmentVariable?.value === "gql-value", "GraphQL environmentVariable did not return the expected value.");

  const gqlDelete = await graphql<{ deleteEnvironmentVariable: boolean }>(
    `mutation($key: String!) { deleteEnvironmentVariable(key: $key) }`,
    { key: "GQL_VAR" },
    ownerCookie
  );
  assert(gqlDelete.deleteEnvironmentVariable === true, "GraphQL deleteEnvironmentVariable should return true.");
  console.log("ok - GraphQL setEnvironmentVariable/environmentVariables/environmentVariable/deleteEnvironmentVariable all work end to end");

  console.log(`Gateway environment-variables smoke test passed using ${started.url}`);
} finally {
  if (projectSlug) {
    await db("projects").where({ slug: projectSlug }).del();
  }
  for (const id of [ownerUserId, memberUserId, outsiderUserId]) {
    if (id) {
      await db("environment_variables").where({ owner_user_id: id }).del();
      await db("users").where({ id }).del();
    }
  }
  await started.stop();
  await db.destroy();
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
    "x-project-memory-client-label": "Env Vars Smoke Static"
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
  const response = await fetch(graphqlUrl, {
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

function assertFailureCode(response: ToolResponse<unknown>, code: string, message: string): void {
  if (response.ok || response.error.code !== code) {
    throw new Error(`${message} Response: ${JSON.stringify(response)}`);
  }
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
