import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createGatewayMcpServer } from "../src/gateway/mcp-server.js";
import { gatewaySchema } from "../src/gateway/graphql.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";

const require = createRequire(import.meta.url);
const { graphql } = require("graphql") as Pick<typeof import("graphql"), "graphql">;
const owner = { clientId: "user:owner", sessionUserId: "owner", sessionRole: "admin" as const };
class TestService extends PgToolService { protected override async touchClient(): Promise<void> {} }
let db: Knex, service: TestService, client: Client, server: McpServer;

beforeEach(async () => {
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("projects", (t) => {
    t.text("id").primary(); t.text("slug").unique(); t.text("title"); t.text("owner_user_id");
  });
  await db("projects").insert({ id: "P-FRAPPE-CICD", slug: "frappe-cicd", title: "Frappe Apps CICD", owner_user_id: "owner" });
  service = new TestService(db);
  server = await createGatewayMcpServer(service, owner);
  client = new Client({ name: "slug-regression", version: "1" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(s), client.connect(c)]);
});

afterEach(async () => { await client.close(); await server.close(); await db.destroy(); });

it.each(["P-FRAPPE-CICD", "p-frappe-cicd"])("rejects the ID prefix over MCP before writing: %s", async (slug) => {
  const result = await client.callTool({ name: "project.create", arguments: { slug, title: "Invalid" } });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).toContain("reserved for project IDs");
  expect(await db("projects").count('* as n').first()).toEqual({ n: 1 });
  const tools = await client.listTools();
  const create = tools.tools.find((tool) => tool.name === "project.create");
  expect(JSON.stringify(create?.inputSchema)).toContain("P-FRAPPE-CICD");
});

it.each(["P-FRAPPE-CICD", "p-frappe-cicd"])("rejects gateway renames without modifying the project: %s", async (slug) => {
  const result = await service.call("project.update", { id: "P-FRAPPE-CICD", slug, title: "Invalid" }, owner);
  expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR", message: expect.stringContaining("reserved for project IDs") } });
  expect(await db("projects").first()).toMatchObject({ slug: "frappe-cicd", title: "Frappe Apps CICD" });
});

it.each(["P-FRAPPE-CICD", "p-frappe-cicd"])("rejects GraphQL create and rename without writing: %s", async (slug) => {
  const result = await graphql({
    schema: gatewaySchema, contextValue: { service, requestContext: owner }, variableValues: { slug },
    source: `mutation($slug:String!){createProject(input:{slug:$slug,title:"Invalid"}){id}}`
  });
  expect(result.errors?.[0]?.extensions).toMatchObject({ code: "VALIDATION_ERROR", details: { issues: [{ path: "slug", message: expect.stringContaining("reserved for project IDs") }] } });
  const renamed = await graphql({
    schema: gatewaySchema, contextValue: { service, requestContext: owner }, variableValues: { slug },
    source: `mutation($slug:String!){updateProject(id:"P-FRAPPE-CICD",slug:$slug){id}}`
  });
  expect(renamed.errors?.[0]?.message).toContain("reserved for project IDs");
  expect(await db("projects")).toEqual([{ id: "P-FRAPPE-CICD", slug: "frappe-cicd", title: "Frappe Apps CICD", owner_user_id: "owner" }]);
});

it("keeps an explicit project ID valid for lookups", async () => {
  expect(await service.call("project.get", { id: "P-FRAPPE-CICD" }, owner)).toMatchObject({ ok: true, data: { project: { slug: "frappe-cicd" } } });
});
