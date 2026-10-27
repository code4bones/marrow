import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { gatewaySchema } from "../src/gateway/graphql.js";
import type { GatewayRequestContext, GraphNode, Row } from "../src/gateway/pg-tool-service/types.js";
const { graphql } = createRequire(import.meta.url)("graphql") as Pick<typeof import("graphql"), "graphql">;
const owner: GatewayRequestContext = { clientId: "user:a", sessionUserId: "a", sessionRole: "member", sessionSource: "cookie" };
let db: Knex;
let service: PgToolService;
class TestService extends PgToolService { protected override async touchClient(): Promise<void> {} }

beforeEach(async () => {
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("users", (t) => { t.text("id").primary(); t.text("email"); t.text("status"); });
  await db("users").insert(["a", "b", "pending", "disabled"].map((id) => ({ id, email: `${id}@test`, status: id === "disabled" ? "disabled" : "active" })));
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); for (const name of ["slug", "title", "status", "owner_user_id", "created_by", "created_at"]) t.text(name); });
  await db.schema.createTable("project_members", (t) => { for (const name of ["project_id", "user_id", "status", "role"]) t.text(name); });
  for (const table of ["items", "tasks", "decisions", "artifacts"]) await db.schema.createTable(table, (t) => {
    t.text("id").primary(); for (const name of ["project_id", "title", "status", "type", "path", "created_by", "created_at", "updated_at", "milestone", "assignee_user_id", "depends_on", "supersedes_id"]) t.text(name);
  });
  await db.schema.createTable("task_assignees", (t) => { t.text("task_id"); t.text("user_id"); t.integer("position"); });
  await db.schema.createTable("links", (t) => { for (const name of ["id", "project_id", "from_id", "to_id", "relation", "created_at"]) t.text(name); });
  await db("projects").insert([{ id: "P-TEST", slug: "test", title: "Test", status: "active", owner_user_id: "a" }, { id: "P-FOREIGN", slug: "foreign", title: "Private", status: "active", owner_user_id: "b" }]);
  await db("project_members").insert({ project_id: "P-TEST", user_id: "a", status: "active", role: "developer" });
  const base = { project_id: "P-TEST", status: "todo", created_by: "user:a", created_at: "2026-01-01", updated_at: "2026-01-01" };
  await db("tasks").insert([
    { ...base, id: "T-SHARED", title: "Shared task", assignee_user_id: "b" },
    { ...base, id: "T-LEGACY", title: "Legacy assignment", assignee_user_id: "a" },
    ...Array.from({ length: 7 }, (_, i) => ({ ...base, id: `T-OTHER-${i}`, title: `Other task ${i}`, assignee_user_id: "b", updated_at: "2026-10-27" }))
  ]);
  await db("task_assignees").insert([{ task_id: "T-SHARED", user_id: "b", position: 0 }, { task_id: "T-SHARED", user_id: "a", position: 1 }]);
  await db("decisions").insert([
    { ...base, id: "D-MINE", title: "Assigned decision", status: "accepted", assignee_user_id: "a", supersedes_id: "D-OTHER" },
    { ...base, id: "D-OTHER", title: "Other decision", status: "accepted", assignee_user_id: "b", updated_at: "2026-10-27" },
    { ...base, id: "D-FOREIGN", title: "Do not expose", project_id: "P-FOREIGN", status: "accepted", assignee_user_id: "a" }
  ]);
  await db("items").insert({ ...base, id: "I-TEST", title: "Memory authored by A", type: "knowledge", status: "current" });
  await db("artifacts").insert({ ...base, id: "A-TEST", title: "Artifact authored by A", path: "test.txt", status: "current" });
  await db("links").insert(["D-MINE", "T-OTHER-0", "I-TEST", "A-TEST", "D-FOREIGN"].map((id, index) => ({
    id: `L-${index}`, project_id: "P-TEST", from_id: "T-SHARED", to_id: id, relation: "relates_to", created_at: "2026-01-01"
  })));
  service = new TestService(db);
});
afterEach(async () => { await db.destroy(); });

async function graph(input: Row = {}) { return service.graphqlProjectGraph({ projectId: "test", depth: 5, ...input }, owner); }
const nodeIds = (result: Row) => (result.nodes as GraphNode[]).map((n) => n.id).sort();

describe("Overview participant assignment filter", () => {
  it("lists active participants including an implicit owner, without pending/disabled accounts", async () => {
    await db("project_members").del();
    await db("project_members").insert(["b", "pending", "disabled"].map((user_id) => ({ project_id: "P-TEST", user_id, status: user_id === "pending" ? "pending_approval" : "active", role: "developer" })));
    const result = await service.call("project.members", { project: "test" }, { ...owner, sessionRole: "admin" });
    expect(result).toMatchObject({ ok: true, data: { members: [{ userId: "a", email: "a@test", role: "pm" }, { userId: "b", email: "b@test", role: "developer" }] } });
  });
  it("filters before record limits, includes secondary/legacy assignees and does not restore other assignments through links", async () => {
    const result = await graph({ assignee: "a", maxPerType: 5 });
    expect(nodeIds(result)).toEqual(["D-MINE", "P-TEST", "T-LEGACY", "T-SHARED"]);
    expect((result.nodes as GraphNode[]).find((node) => node.id === "T-SHARED")).toMatchObject({ assigneeUserIds: ["b", "a"] });
    expect(result.edges).toMatchObject([{ from: "T-SHARED", to: "D-MINE" }]);
    expect(result.edges).toHaveLength(1);
  });
  it("retains the unfiltered graph when All participants is selected", async () => {
    const result = await graph();
    expect(nodeIds(result)).toContain("I-TEST"); expect(nodeIds(result)).toContain("A-TEST"); expect(nodeIds(result)).toContain("T-OTHER-0");
    expect(nodeIds(result)).not.toContain("D-FOREIGN");
    expect(nodeIds(await graph({ assignee: null }))).toEqual(nodeIds(result));
  });
  it("returns an empty project graph for a participant without assignments rather than matching the creator", async () => {
    expect(nodeIds(await graph({ assignee: "nobody" }))).toEqual(["P-TEST"]);
    expect((await graph({ assignee: "nobody" })).edges).toEqual([]);
  });
  it("exposes the assignee argument through GraphQL with the existing project membership gate", async () => {
    const source = 'query($assignee:String){projectGraph(projectId:"test",assignee:$assignee,depth:5){nodes{id assigneeUserIds} edges{from to}}}';
    const result = await graphql({ schema: gatewaySchema, source, variableValues: { assignee: "a" }, contextValue: { service, requestContext: owner } });
    expect(result.errors).toBeUndefined(); expect(result.data?.projectGraph).toBeDefined();
    expect(nodeIds(result.data!.projectGraph as Row)).toEqual(["D-MINE", "P-TEST", "T-LEGACY", "T-SHARED"]);
    const denied = await graphql({ schema: gatewaySchema, source, contextValue: { service, requestContext: { ...owner, sessionUserId: "outsider" } } });
    expect(denied.errors?.[0].extensions.code).toBe("PROJECT_NOT_FOUND");
  });
});
