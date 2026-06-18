import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type AppContext } from "../src/app/bootstrap.js";

let tempDir: string;
let app: AppContext;
let client: Client;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "project-memory-mcp-smoke-"));
  app = bootstrap({
    dbPath: join(tempDir, "memory.sqlite"),
    migrationsDir: resolve("migrations"),
    logLevel: "silent"
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([app.server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await app.server.close();
  app.db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("MCP server", () => {
  it("lists and calls tools through the protocol", async () => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);

    expect(toolNames).toContain("project.create");
    expect(toolNames).toContain("memory.search");
    expect(toolNames).toContain("preflight");
    expect(toolNames).toContain("link.create");

    const result = await client.callTool({
      name: "project.create",
      arguments: {
        slug: "project-memory-mcp",
        title: "Project Memory MCP"
      }
    });

    expect(result.structuredContent).toMatchObject({
      ok: true,
      data: {
        project: {
          id: "P-MEMORY"
        }
      }
    });
  });
});
