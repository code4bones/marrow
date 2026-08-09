import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService, staticTokenClientId } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-smoke-token-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token
});

const state: {
  projectId?: string;
  anonymousProjectId?: string;
  staticTokenCurrentProjectKey?: string;
  staleAnonymousClientId?: string;
  pruneAnonymousClientId?: string;
  forgetClientId?: string;
  taskId?: string;
  memoryId?: string;
} = {};
const clientId = `gateway-http-smoke-${Date.now()}`;

try {
  const health = (await getJson(`${started.url}/health`)) as { ok?: boolean };
  assert(health.ok === true, "Gateway health route did not return ok=true.");
  console.log("ok - gateway health");

  const ready = (await getJson(`${started.url}/ready`)) as { ok?: boolean; missingTables?: string[] };
  assert(ready.ok === true, `Gateway readiness failed: ${JSON.stringify(ready)}`);
  console.log("ok - gateway ready");

  const tools = (await getJson(`${started.url}/tools`)) as { tools?: { name: string }[] };
  assert(tools.tools?.some((tool) => tool.name === "preflight"), "Gateway tools route did not expose preflight.");
  assert(tools.tools?.some((tool) => tool.name === "gateway.clients"), "Gateway tools route did not expose gateway.clients.");
  assert(tools.tools?.some((tool) => tool.name === "gateway.client_get"), "Gateway tools route did not expose gateway.client_get.");
  assert(tools.tools?.some((tool) => tool.name === "gateway.client_forget"), "Gateway tools route did not expose gateway.client_forget.");
  assert(tools.tools?.some((tool) => tool.name === "gateway.client_prune"), "Gateway tools route did not expose gateway.client_prune.");
  assert(tools.tools?.some((tool) => tool.name === "project.delete"), "Gateway tools route did not expose project.delete.");
  assert(tools.tools?.some((tool) => tool.name === "task.delete"), "Gateway tools route did not expose task.delete.");
  console.log("ok - gateway tools");

  const unique = Date.now();
  state.staleAnonymousClientId = `anonymous:gateway-smoke-stale-${unique}`;
  await db("gateway_clients").insert({
    id: state.staleAnonymousClientId,
    label: "Gateway Smoke Stale Anonymous",
    last_seen_at: new Date(0).toISOString(),
    metadata: "{}",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  });
  await db("kv").insert({
    key: `current_project_id:${state.staleAnonymousClientId}`,
    value: "P-GATEWAY-SMOKE-STALE",
    updated_at: new Date(0).toISOString()
  });

  const status = await callGateway("gateway.status", {});
  assert(expectData<{ status: { storage: string } }>(status).status.storage === "postgresql", "Gateway status did not report PostgreSQL storage.");
  const staleClient = await db("gateway_clients").where({ id: state.staleAnonymousClientId }).first();
  const staleCurrentProject = await db("kv").where({ key: `current_project_id:${state.staleAnonymousClientId}` }).first();
  assert(!staleClient, "Gateway did not clean up the stale anonymous client.");
  assert(!staleCurrentProject, "Gateway did not clean up the stale anonymous current project key.");
  console.log("ok - anonymous client cleanup");
  console.log("ok - gateway.status");

  const clientGet = await callGateway("gateway.client_get", { id: clientId });
  assert(expectData<{ client: { id: string } }>(clientGet).client.id === clientId, "gateway.client_get returned wrong client.");
  console.log("ok - gateway.client_get");

  state.forgetClientId = `gateway-http-smoke-forget-${unique}`;
  await db("gateway_clients").insert({
    id: state.forgetClientId,
    label: "Gateway Smoke Forget",
    last_seen_at: new Date(0).toISOString(),
    metadata: "{}",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  });
  await db("kv").insert({
    key: `current_project_id:${state.forgetClientId}`,
    value: "P-GATEWAY-SMOKE-FORGET",
    updated_at: new Date(0).toISOString()
  });
  const forget = await callGateway("gateway.client_forget", { id: state.forgetClientId });
  assert(expectData<{ forgotten: boolean }>(forget).forgotten === true, "gateway.client_forget did not report forgotten=true.");
  assert(!(await db("gateway_clients").where({ id: state.forgetClientId }).first()), "gateway.client_forget did not remove client.");
  assert(
    !(await db("kv").where({ key: `current_project_id:${state.forgetClientId}` }).first()),
    "gateway.client_forget did not remove current project key."
  );
  console.log("ok - gateway.client_forget");

  state.pruneAnonymousClientId = `anonymous:gateway-smoke-prune-${unique}`;
  await db("gateway_clients").insert({
    id: state.pruneAnonymousClientId,
    label: "Gateway Smoke Prune Anonymous",
    last_seen_at: new Date(0).toISOString(),
    metadata: "{}",
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString()
  });
  await db("kv").insert({
    key: `current_project_id:${state.pruneAnonymousClientId}`,
    value: "P-GATEWAY-SMOKE-PRUNE",
    updated_at: new Date(0).toISOString()
  });
  const pruneDryRun = await callGateway("gateway.client_prune", {
    anonymousOnly: true,
    olderThanSeconds: 1,
    limit: 1000,
    dryRun: true
  });
  assert(
    expectData<{ matched: number; pruned: number }>(pruneDryRun).matched >= 1 &&
      expectData<{ matched: number; pruned: number }>(pruneDryRun).pruned === 0,
    `gateway.client_prune dry-run did not report a stale anonymous client: ${JSON.stringify(pruneDryRun)}`
  );
  const prune = await callGateway("gateway.client_prune", {
    anonymousOnly: true,
    olderThanSeconds: 1,
    limit: 1000,
    dryRun: false
  });
  assert(
    expectData<{ pruned: number }>(prune).pruned >= 1,
    `gateway.client_prune did not prune stale anonymous clients: ${JSON.stringify(prune)}`
  );
  assert(
    !(await db("gateway_clients").where({ id: state.pruneAnonymousClientId }).first()),
    "gateway.client_prune did not remove stale anonymous client."
  );
  assert(
    !(await db("kv").where({ key: `current_project_id:${state.pruneAnonymousClientId}` }).first()),
    "gateway.client_prune did not remove current project key."
  );
  console.log("ok - gateway.client_prune");

  const project = await callGateway("project.create", {
    slug: `gateway-smoke-${unique}`,
    title: `Gateway Smoke ${unique}`
  });
  state.projectId = expectData<{ project: { id: string } }>(project).project.id;
  console.log("ok - project.create");

  await callGateway("project.set_current", { id: state.projectId });
  console.log("ok - project.set_current");

  const currentProject = await callGateway("project.current", {});
  assert(
    expectData<{ project: { id: string } }>(currentProject).project.id === state.projectId,
    "Gateway current project did not use the smoke client scope."
  );
  console.log("ok - project.current");

  const anonymousProject = await callGateway("project.create", {
    slug: `gateway-smoke-anonymous-${unique}`,
    title: `Gateway Smoke Anonymous ${unique}`
  });
  state.anonymousProjectId = expectData<{ project: { id: string } }>(anonymousProject).project.id;

  // T-MEMORY-029: a static-token request with no explicit client id header
  // used to fall through to a fresh `anonymous:${requestId}` scope on every
  // single call (no stable identity at all). It now resolves to the same
  // stable `static:mcp-token` credential every time, so two such calls
  // share one current-project key -- the second call's value simply
  // overwrites the first, it does not create a second independent scope.
  state.staticTokenCurrentProjectKey = `current_project_id:${staticTokenClientId}`;
  await callGatewayWithoutClient("project.set_current", { id: state.projectId });
  const afterFirstSetCurrent = await db("kv").where({ key: state.staticTokenCurrentProjectKey }).first();
  assert(
    afterFirstSetCurrent?.value === state.projectId,
    "Static-token request without an explicit client id did not use the stable static:mcp-token scope."
  );
  await callGatewayWithoutClient("project.set_current", { id: state.anonymousProjectId });
  const afterSecondSetCurrent = await db("kv").where({ key: state.staticTokenCurrentProjectKey }).first();
  assert(
    afterSecondSetCurrent?.value === state.anonymousProjectId,
    "A second static-token request without an explicit client id should overwrite the same stable scope's current project, not create a second one."
  );
  console.log("ok - static-token requests without an explicit client id share one stable current-project scope");

  const memory = await callGateway("memory.create", {
    project: state.projectId,
    type: "failed_attempt",
    title: "Gateway smoke task preflight failed attempt",
    body: "Smoke record used to verify PostgreSQL full text search and gateway task preflight known fault search.",
    tags: ["smoke", "gateway"]
  });
  state.memoryId = expectData<{ item: { id: string } }>(memory).item.id;
  console.log("ok - memory.create");

  // T-MEMORY-055 regression: updating title/body/status without resending
  // tags on an already-tagged record must not throw a jsonb write error --
  // the tags-omitted fallback has to re-serialize the driver-parsed array,
  // not pass it through raw.
  const memoryUpdateNoTags = await callGateway("memory.update", {
    id: state.memoryId,
    title: "Gateway smoke task preflight failed attempt (updated)"
  });
  const updatedMemory = expectData<{ item: { id: string; title: string; tags: string[] } }>(memoryUpdateNoTags).item;
  assert(updatedMemory.title === "Gateway smoke task preflight failed attempt (updated)", "memory.update did not apply the new title.");
  assert(
    Array.isArray(updatedMemory.tags) && updatedMemory.tags.includes("smoke") && updatedMemory.tags.includes("gateway"),
    "memory.update with tags omitted should preserve the existing tags."
  );
  console.log("ok - memory.update with tags omitted (T-MEMORY-055 regression)");

  const task = await callGateway("task.create", {
    project: state.projectId,
    title: "Gateway smoke task",
    scope: "Verify gateway task creation and preflight.",
    acceptance: "Preflight includes the smoke task and related memory.",
    priority: 1
  });
  state.taskId = expectData<{ task: { id: string } }>(task).task.id;
  console.log("ok - task.create");

  const temporaryTask = await callGateway("task.create", {
    project: state.projectId,
    title: "Gateway smoke delete task",
    scope: "Temporary task used to verify task.delete.",
    acceptance: "task.delete removes this task.",
    priority: 99
  });
  const temporaryTaskId = expectData<{ task: { id: string } }>(temporaryTask).task.id;
  const deleteTask = await callGateway("task.delete", {
    id: temporaryTaskId,
    reason: "Gateway smoke cleanup for task.delete."
  });
  assert(expectData<{ deletedTask: { id: string } }>(deleteTask).deletedTask.id === temporaryTaskId, "task.delete returned wrong task.");
  console.log("ok - task.delete");

  const search = await callGateway("memory.search", {
    query: "PostgreSQL full text smoke",
    project: state.projectId,
    includeCommon: true
  });
  const searchData = expectData<{ results: { id: string }[] }>(search);
  assert(searchData.results.some((item) => item.id === state.memoryId), "Gateway search did not return smoke memory.");
  console.log("ok - memory.search");

  const preflight = await callGateway("preflight", { taskId: state.taskId });
  const preflightData = expectData<{
    task: { id: string };
    project: { id: string };
    knownFaults: { id: string }[];
  }>(preflight);
  assert(preflightData.task.id === state.taskId, "Gateway preflight returned wrong task.");
  assert(preflightData.project.id === state.projectId, "Gateway preflight returned wrong project.");
  assert(
    preflightData.knownFaults.some((item) => item.id === state.memoryId),
    "Gateway preflight did not include the known fault."
  );
  console.log("ok - preflight");

  const clients = await callGateway("gateway.clients", {});
  const clientsData = expectData<{ clients: { id: string }[] }>(clients);
  assert(clientsData.clients.some((client) => client.id === clientId), "Gateway clients did not include smoke client.");
  console.log("ok - gateway.clients");

  const blockedProjectDelete = await callGateway("project.delete", { id: state.projectId });
  assertFailureCode(blockedProjectDelete, "PROJECT_NOT_EMPTY", "project.delete without cascade did not reject a non-empty project.");

  if (state.anonymousProjectId) {
    const anonymousProjectDelete = await callGateway("project.delete", {
      id: state.anonymousProjectId,
      cascade: true,
      reason: "Gateway smoke cleanup for anonymous project."
    });
    assert(
      expectData<{ deletedProject: { id: string } }>(anonymousProjectDelete).deletedProject.id === state.anonymousProjectId,
      "project.delete returned wrong anonymous project."
    );
    state.anonymousProjectId = undefined;
  }

  const projectDelete = await callGateway("project.delete", {
    id: state.projectId,
    cascade: true,
    reason: "Gateway smoke cleanup for primary project."
  });
  assert(expectData<{ deletedProject: { id: string } }>(projectDelete).deletedProject.id === state.projectId, "project.delete returned wrong project.");
  state.projectId = undefined;
  console.log("ok - project.delete");

  console.log(`Gateway smoke test passed using ${started.url}`);
} finally {
  if (state.projectId) {
    await db("kv").where({ key: `current_project_id:${clientId}` }).del();
    await db("projects").where({ id: state.projectId }).del();
  }
  if (state.anonymousProjectId) {
    await db("projects").where({ id: state.anonymousProjectId }).del();
  }
  if (state.staticTokenCurrentProjectKey) {
    // Only the KV current-project pointer is this script's own scratch
    // state -- the static:mcp-token gateway_clients row itself is a stable,
    // shared credential identity (T-MEMORY-029), not scoped to one smoke
    // run, so it is intentionally left alone here.
    await db("kv").where({ key: state.staticTokenCurrentProjectKey }).del();
  }
  if (state.staleAnonymousClientId) {
    await db("kv").where({ key: `current_project_id:${state.staleAnonymousClientId}` }).del();
    await db("gateway_clients").where({ id: state.staleAnonymousClientId }).del();
  }
  if (state.pruneAnonymousClientId) {
    await db("kv").where({ key: `current_project_id:${state.pruneAnonymousClientId}` }).del();
    await db("gateway_clients").where({ id: state.pruneAnonymousClientId }).del();
  }
  if (state.forgetClientId) {
    await db("kv").where({ key: `current_project_id:${state.forgetClientId}` }).del();
    await db("gateway_clients").where({ id: state.forgetClientId }).del();
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await started.stop();
  await service.close();
}

async function callGateway(tool: string, input: unknown): Promise<ToolResponse<unknown>> {
  return (await postJson(`${started.url}/call`, { tool, input })) as ToolResponse<unknown>;
}

async function callGatewayWithoutClient(tool: string, input: unknown): Promise<ToolResponse<unknown>> {
  return (await postJsonWithoutClient(`${started.url}/call`, { tool, input })) as ToolResponse<unknown>;
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

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert(response.ok, `GET ${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway HTTP Smoke",
      "x-project-memory-client-kind": "smoke"
    },
    body: JSON.stringify(body)
  });
  assert(response.ok, `POST ${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function postJsonWithoutClient(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  assert(response.ok, `POST ${url} returned HTTP ${response.status}.`);
  return response.json();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
