import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
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
const endpoint = new URL(`${started.url}/mcp`);
endpoint.searchParams.set("client_id", clientId);
endpoint.searchParams.set("client_label", "Gateway MCP HTTP Smoke");
endpoint.searchParams.set("client_kind", "mcp-http");

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: {
    headers: {
      authorization: `Bearer ${token}`
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
  artifactId?: string;
  artifactPath?: string;
} = {};

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert(toolNames.includes("gateway.about"), "gateway.about tool was not listed.");
  assert(toolNames.includes("gateway.manuals"), "gateway.manuals tool was not listed.");
  assert(toolNames.includes("gateway.status"), "gateway.status tool was not listed.");
  assert(toolNames.includes("gateway.clients"), "gateway.clients tool was not listed.");
  assert(toolNames.includes("project.create"), "project.create tool was not listed.");
  assert(toolNames.includes("memory.search"), "memory.search tool was not listed.");
  assert(toolNames.includes("preflight"), "preflight tool was not listed.");
  console.log(`ok - gateway MCP HTTP listed ${toolNames.length} tools`);

  const aboutResult = await client.callTool({
    name: "gateway.about",
    arguments: {}
  });
  assertOk(aboutResult.structuredContent, "gateway.about failed.");
  assert(
    readNestedString(aboutResult.structuredContent, ["data", "about", "shortName"]) === "pmem",
    "gateway.about did not describe pmem."
  );
  assert(
    readNestedString(aboutResult.structuredContent, ["data", "about", "manuals", "tool"]) === "gateway.manuals",
    "gateway.about did not point at gateway.manuals."
  );

  const manualsResult = await client.callTool({
    name: "gateway.manuals",
    arguments: {
      audience: "all",
      includeContent: true
    }
  });
  assertOk(manualsResult.structuredContent, "gateway.manuals failed.");
  const manuals = readNestedArray(manualsResult.structuredContent, ["data", "manuals"]);
  assert(manuals.length >= 2, "gateway.manuals did not return both manuals.");
  assert(
    manuals.some(
      (manual) =>
        isRecord(manual) &&
        manual.id === "developer" &&
        typeof manual.content === "string" &&
        manual.content.includes("Developer Manual")
    ),
    "gateway.manuals did not return developer Markdown content."
  );
  assert(
    manuals.some(
      (manual) =>
        isRecord(manual) &&
        manual.id === "agent" &&
        typeof manual.content === "string" &&
        manual.content.includes("Agent Guide")
    ),
    "gateway.manuals did not return agent Markdown content."
  );

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

  state.artifactPath = `gateway-smoke/AGENTS-${unique}.md`;
  const artifactContent = "# Gateway Smoke AGENTS\n\nUse preflight before editing files.\n";
  const artifactResult = await client.callTool({
    name: "artifact.put",
    arguments: {
      common: true,
      path: state.artifactPath,
      title: "Gateway smoke AGENTS template",
      description: "Smoke test artifact for gateway file storage.",
      contentType: "text/markdown; charset=utf-8",
      contentBase64: Buffer.from(artifactContent, "utf8").toString("base64"),
      tags: ["smoke", "agents-template"],
      overwrite: true
    }
  });
  assertOk(artifactResult.structuredContent, "artifact.put failed.");
  state.artifactId = readNestedString(artifactResult.structuredContent, ["data", "artifact", "id"]);

  const artifactSearchResult = await client.callTool({
    name: "artifact.search",
    arguments: {
      query: "Gateway Smoke AGENTS",
      includeCommon: true,
      limit: 5
    }
  });
  assertOk(artifactSearchResult.structuredContent, "artifact.search failed.");
  const artifactIds = readNestedArray(artifactSearchResult.structuredContent, ["data", "results"]).map((item) =>
    isRecord(item) ? item.id : undefined
  );
  assert(artifactIds.includes(state.artifactId), "artifact.search did not include smoke artifact.");

  const artifactGetResult = await client.callTool({
    name: "artifact.get",
    arguments: {
      id: state.artifactId,
      includeContent: true
    }
  });
  assertOk(artifactGetResult.structuredContent, "artifact.get failed.");
  assert(
    readNestedString(artifactGetResult.structuredContent, ["data", "artifact", "contentBase64"]) ===
      Buffer.from(artifactContent, "utf8").toString("base64"),
    "artifact.get did not return expected inline content."
  );

  const downloadPath = readNestedString(artifactGetResult.structuredContent, ["data", "artifact", "downloadPath"]);
  const downloadResponse = await fetch(`${started.url}${downloadPath}`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  assert(downloadResponse.ok, `artifact download failed with ${downloadResponse.status}`);
  assert((await downloadResponse.text()) === artifactContent, "artifact download content mismatch.");

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
  if (state.artifactId) {
    await db("artifacts").where({ id: state.artifactId }).del();
  }
  if (state.artifactPath) {
    await rm(resolve(process.env.ARTIFACT_DIR ?? "artifacts", "common", state.artifactPath), { force: true });
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
