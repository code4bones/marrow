import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";

const clientPath = resolve("dist/src/gateway-client.js");

if (!existsSync(clientPath)) {
  throw new Error("Built gateway client not found at dist/src/gateway-client.js. Run npm run build first.");
}

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-stdio-smoke-token-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token
});
const clientId = `gateway-stdio-smoke-${Date.now()}`;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [clientPath],
  cwd: process.cwd(),
  env: {
    ...process.env,
    PROJECT_MEMORY_CLIENT_ID: clientId,
    PROJECT_MEMORY_CLIENT_LABEL: "Gateway Stdio Smoke",
    PROJECT_MEMORY_GATEWAY_TOKEN: token,
    PROJECT_MEMORY_GATEWAY_URL: started.url
  },
  stderr: "pipe"
});

const client = new Client({
  name: "project-memory-gateway-stdio-smoke",
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
  console.log(`ok - gateway stdio client listed ${toolNames.length} tools`);

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
  const clientIds = readNestedArray(clientsResult.structuredContent, ["data", "clients"])
    .map((item) => (isRecord(item) ? item.id : undefined));
  assert(clientIds.includes(clientId), "gateway.clients did not include the stdio smoke client.");
  console.log("ok - gateway status and clients");

  const unique = Date.now();
  const projectResult = await client.callTool({
    name: "project.create",
    arguments: {
      slug: `gateway-stdio-smoke-${unique}`,
      title: `Gateway Stdio Smoke ${unique}`
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
      type: "agent_rule",
      title: "Gateway stdio smoke rule",
      body: "Gateway client should forward MCP stdio calls to the HTTP gateway.",
      tags: ["smoke", "gateway-stdio"]
    }
  });
  assertOk(memoryResult.structuredContent, "memory.create failed.");

  const taskResult = await client.callTool({
    name: "task.create",
    arguments: {
      title: "Verify gateway stdio proxy",
      scope: "Check MCP stdio proxy forwarding through the HTTP gateway.",
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

  console.log(`ok - gateway stdio workflow completed for ${state.taskId}`);
  console.log(`Gateway stdio smoke test passed using ${started.url}`);
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
