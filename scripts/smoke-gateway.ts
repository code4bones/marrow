import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0
});

const state: {
  projectId?: string;
  taskId?: string;
  memoryId?: string;
} = {};
const clientId = `gateway-http-smoke-${Date.now()}`;

try {
  const health = (await getJson(`${started.url}/health`)) as { ok?: boolean };
  assert(health.ok === true, "Gateway health route did not return ok=true.");
  console.log("ok - gateway health");

  const tools = (await getJson(`${started.url}/tools`)) as { tools?: { name: string }[] };
  assert(tools.tools?.some((tool) => tool.name === "preflight"), "Gateway tools route did not expose preflight.");
  assert(tools.tools?.some((tool) => tool.name === "gateway.clients"), "Gateway tools route did not expose gateway.clients.");
  console.log("ok - gateway tools");

  const unique = Date.now();
  const status = await callGateway("gateway.status", {});
  assert(expectData<{ status: { storage: string } }>(status).status.storage === "postgresql", "Gateway status did not report PostgreSQL storage.");
  console.log("ok - gateway.status");

  const project = await callGateway("project.create", {
    slug: `gateway-smoke-${unique}`,
    title: `Gateway Smoke ${unique}`
  });
  state.projectId = expectData<{ project: { id: string } }>(project).project.id;
  console.log("ok - project.create");

  await callGateway("project.set_current", { id: state.projectId });
  console.log("ok - project.set_current");

  const memory = await callGateway("memory.create", {
    type: "failed_attempt",
    title: "Gateway smoke searchable failed attempt",
    body: "Smoke record used to verify PostgreSQL full text search.",
    tags: ["smoke", "gateway"]
  });
  state.memoryId = expectData<{ item: { id: string } }>(memory).item.id;
  console.log("ok - memory.create");

  const task = await callGateway("task.create", {
    title: "Gateway smoke task",
    scope: "Verify gateway task creation and preflight.",
    acceptance: "Preflight includes the smoke task and related memory.",
    priority: 1
  });
  state.taskId = expectData<{ task: { id: string } }>(task).task.id;
  console.log("ok - task.create");

  const search = await callGateway("memory.search", {
    query: "PostgreSQL full text smoke",
    includeCommon: true
  });
  const searchData = expectData<{ results: { id: string }[] }>(search);
  assert(searchData.results.some((item) => item.id === state.memoryId), "Gateway search did not return smoke memory.");
  console.log("ok - memory.search");

  const preflight = await callGateway("preflight", { taskId: state.taskId });
  const preflightData = expectData<{ task: { id: string }; project: { id: string } }>(preflight);
  assert(preflightData.task.id === state.taskId, "Gateway preflight returned wrong task.");
  assert(preflightData.project.id === state.projectId, "Gateway preflight returned wrong project.");
  console.log("ok - preflight");

  const clients = await callGateway("gateway.clients", {});
  const clientsData = expectData<{ clients: { id: string }[] }>(clients);
  assert(clientsData.clients.some((client) => client.id === clientId), "Gateway clients did not include smoke client.");
  console.log("ok - gateway.clients");

  console.log(`Gateway smoke test passed using ${started.url}`);
} finally {
  if (state.projectId) {
    await db("kv").where({ key: "current_project_id", value: state.projectId }).del();
    await db("projects").where({ id: state.projectId }).del();
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await new Promise<void>((resolve) => started.server.close(() => resolve()));
  await service.close();
}

async function callGateway(tool: string, input: unknown): Promise<ToolResponse<unknown>> {
  return (await postJson(`${started.url}/call`, { tool, input })) as ToolResponse<unknown>;
}

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  assert(response.ok, `GET ${url} returned HTTP ${response.status}.`);
  return response.json();
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway HTTP Smoke",
      "x-project-memory-client-kind": "smoke"
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
