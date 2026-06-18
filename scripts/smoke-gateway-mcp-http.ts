import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-mcp-http-smoke-token-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token
});
const clientId = `gateway-mcp-http-smoke-${Date.now()}`;

const transport = new StreamableHTTPClientTransport(new URL(`${started.url}/mcp`), {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`,
      "x-project-memory-client-id": clientId,
      "x-project-memory-client-label": "Gateway MCP HTTP Smoke",
      "x-project-memory-client-kind": "mcp-http"
    }
  }
});

const client = new Client({
  name: "project-memory-gateway-mcp-http-smoke",
  version: "0.1.0"
});

const state: {
  projectId?: string;
  taskId?: string;
} = {};

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert(toolNames.includes("gateway.status"), "gateway.status tool was not listed.");
  assert(toolNames.includes("gateway.clients"), "gateway.clients tool was not listed.");
  assert(toolNames.includes("project.create"), "project.create tool was not listed.");
  assert(toolNames.includes("memory.search"), "memory.search tool was not listed.");
  assert(toolNames.includes("preflight"), "preflight tool was not listed.");
  console.log(`ok - gateway MCP HTTP listed ${toolNames.length} tools`);

  const statusResult = await client.callTool({
    name: "gateway.status",
    arguments: {}
  });
  assertOk(statusResult.structuredContent, "gateway.status failed.");

  const clientsResult = await client.callTool({
    name: "gateway.clients",
    arguments: {}
  });
  assertOk(clientsResult.structuredContent, "gateway.clients failed.");
  const clientIds = readNestedArray(clientsResult.structuredContent, ["data", "clients"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(clientIds.includes(clientId), "gateway.clients did not include the MCP HTTP smoke client.");
  console.log("ok - gateway MCP HTTP status and clients");

  const unique = Date.now();
  const projectResult = await client.callTool({
    name: "project.create",
    arguments: {
      slug: `gateway-mcp-http-smoke-${unique}`,
      title: `Gateway MCP HTTP Smoke ${unique}`
    }
  });
  assertOk(projectResult.structuredContent, "project.create failed.");
  state.projectId = readNestedString(projectResult.structuredContent, ["data", "project", "id"]);

  const currentResult = await client.callTool({
    name: "project.set_current",
    arguments: {
      id: state.projectId
    }
  });
  assertOk(currentResult.structuredContent, "project.set_current failed.");

  const memoryResult = await client.callTool({
    name: "memory.create",
    arguments: {
      project: state.projectId,
      type: "agent_rule",
      title: "Gateway MCP HTTP smoke rule",
      body: "Gateway should expose MCP tools directly over Streamable HTTP.",
      tags: ["smoke", "gateway-mcp-http"]
    }
  });
  assertOk(memoryResult.structuredContent, "memory.create failed.");

  const taskResult = await client.callTool({
    name: "task.create",
    arguments: {
      project: state.projectId,
      title: "Verify gateway MCP HTTP",
      scope: "Check direct MCP Streamable HTTP transport through the gateway.",
      acceptance: "Client can create project, memory, task, and run preflight.",
      priority: 1
    }
  });
  assertOk(taskResult.structuredContent, "task.create failed.");
  state.taskId = readNestedString(taskResult.structuredContent, ["data", "task", "id"]);

  const preflightResult = await client.callTool({
    name: "preflight",
    arguments: {
      taskId: state.taskId
    }
  });
  assertOk(preflightResult.structuredContent, "preflight failed.");

  console.log(`ok - gateway MCP HTTP workflow completed for ${state.taskId}`);
  console.log(`Gateway MCP HTTP smoke test passed using ${started.url}/mcp`);
} finally {
  await client.close();
  if (state.projectId) {
    await db("kv").where({ key: "current_project_id", value: state.projectId }).del();
    await db("projects").where({ id: state.projectId }).del();
  }
  await db("gateway_clients").where({ id: clientId }).del();
  await new Promise<void>((resolveServerClose) => started.server.close(() => resolveServerClose()));
  await service.close();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertOk(value: unknown, message: string): void {
  if (!isRecord(value) || value.ok !== true) {
    throw new Error(`${message} Response: ${JSON.stringify(value)}`);
  }
}

function readNestedString(value: unknown, path: string[]): string {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (typeof current !== "string") {
    throw new Error(`Expected string at ${path.join(".")}.`);
  }

  return current;
}

function readNestedArray(value: unknown, path: string[]): unknown[] {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[key];
  }

  if (!Array.isArray(current)) {
    throw new Error(`Expected array at ${path.join(".")}.`);
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
