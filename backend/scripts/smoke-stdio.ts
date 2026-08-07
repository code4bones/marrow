import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = resolve("dist/src/index.js");

if (!existsSync(serverPath)) {
  throw new Error("Built server not found at dist/src/index.js. Run npm run build first.");
}

const tempDir = mkdtempSync(join(tmpdir(), "project-memory-mcp-stdio-"));
const dbPath = join(tempDir, "memory.sqlite");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: process.cwd(),
  env: {
    ...process.env,
    PROJECT_MEMORY_DB: dbPath,
    PROJECT_MEMORY_LOG_LEVEL: "silent"
  },
  stderr: "pipe"
});

const client = new Client({
  name: "project-memory-mcp-stdio-smoke",
  version: "0.1.0"
});

try {
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((tool) => tool.name);
  assert(toolNames.includes("project.create"), "project.create tool was not listed.");
  assert(toolNames.includes("memory.create"), "memory.create tool was not listed.");
  assert(toolNames.includes("task.create"), "task.create tool was not listed.");
  assert(toolNames.includes("preflight"), "preflight tool was not listed.");

  const projectResult = await client.callTool({
    name: "project.create",
    arguments: {
      slug: "project-memory-mcp-stdio",
      title: "Project Memory MCP Stdio"
    }
  });
  assertOk(projectResult.structuredContent, "project.create failed.");

  const setCurrentResult = await client.callTool({
    name: "project.set_current",
    arguments: {
      slug: "project-memory-mcp-stdio"
    }
  });
  assertOk(setCurrentResult.structuredContent, "project.set_current failed.");

  const memoryResult = await client.callTool({
    name: "memory.create",
    arguments: {
      type: "agent_rule",
      title: "Always run preflight",
      body: "Run preflight before editing files.",
      tags: ["smoke"]
    }
  });
  assertOk(memoryResult.structuredContent, "memory.create failed.");

  const taskResult = await client.callTool({
    name: "task.create",
    arguments: {
      title: "Verify stdio smoke",
      scope: "Check built server over MCP stdio.",
      acceptance: "Client can create project, memory, task, and run preflight.",
      allowedFiles: ["scripts/smoke-stdio.ts"]
    }
  });
  assertOk(taskResult.structuredContent, "task.create failed.");
  const taskId = readNestedString(taskResult.structuredContent, ["data", "task", "id"]);

  const preflightResult = await client.callTool({
    name: "preflight",
    arguments: {
      taskId
    }
  });
  assertOk(preflightResult.structuredContent, "preflight failed.");

  console.log(`ok - stdio server listed ${toolNames.length} tools`);
  console.log(`ok - stdio workflow completed for ${taskId}`);
  console.log(`Stdio smoke test passed using ${dbPath}`);
} finally {
  await client.close();
  rmSync(tempDir, { recursive: true, force: true });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
