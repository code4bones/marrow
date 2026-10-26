import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { gatewaySchema } from "../src/gateway/graphql.js";
import { getTaskAssigneeIds, loadTaskAssignees, setTaskAssignees } from "../src/gateway/task-assignees.js";
import { graphNodeOut } from "../src/gateway/pg-tool-service/formatters/graph.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";
const require = createRequire(import.meta.url);
const { graphql } = require("graphql") as Pick<typeof import("graphql"), "graphql">;
vi.mock("../src/gateway/telegram.js", async (original) => ({ ...await original<typeof import("../src/gateway/telegram.js")>(), notifyTelegram: vi.fn().mockResolvedValue(undefined) }));
const owner: GatewayRequestContext = { clientId: "user:owner", sessionUserId: "owner", sessionRole: "member", sessionSource: "cookie" };
let db: Knex;
let service: TestService;
class TestService extends PgToolService {
  protected override async touchClient(): Promise<void> {}
  protected override taskSelectWithActiveClaimCount(query: Knex.QueryBuilder) { return query.select("tasks.*"); }
}
async function call(name: string, input: Row, context = owner): Promise<Row> {
  const result = await service.call(name, input, context);
  if (!result.ok) throw new Error(result.error.message);
  return result.data as Row;
}
async function create(assignees = ["dev", "qa"]) { return (await call("task.create", { project: "test", title: "Implement and test login", assignees })).task as Row; }
beforeEach(async () => {
  vi.stubEnv("TELLYMCP_INBOX_MCP_URL", "https://telly.invalid/mcp"); vi.stubEnv("TELLYMCP_INBOX_BEARER_TOKEN", "test-token");
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = ON");
  await db.schema.createTable("users", (t) => { t.text("id").primary(); t.text("email"); t.text("status"); });
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); for (const n of ["slug", "title", "owner_user_id", "status"]) t.text(n); });
  await db.schema.createTable("project_members", (t) => { for (const n of ["project_id", "user_id", "status", "role"]) t.text(n); });
  await db.schema.createTable("gateway_clients", (t) => { t.text("id"); t.text("owner_user_id"); });
  await db.schema.createTable("tasks", (t) => {
    t.text("id").primary(); t.integer("priority"); t.integer("version").defaultTo(1);
    for (const n of ["project_id", "title", "status", "milestone", "scope", "acceptance", "allowed_files", "forbidden_files", "depends_on", "notes", "project_version", "created_by", "updated_by", "source_instance_id", "created_at", "updated_at"]) t.text(n);
  });
  await db.schema.alterTable("tasks", (t) => t.text("assignee_user_id").references("id").inTable("users").onDelete("SET NULL"));
  await db.schema.createTable("events", (t) => { t.text("id").primary(); for (const n of ["project_id", "type", "title", "body", "related_id", "agent_name", "target_user_ids", "created_by", "source_instance_id", "created_at"]) t.text(n); });
  await db.schema.createTable("telegram_task_sources", (t) => { for (const n of ["task_id", "project_id", "bot_id"]) t.text(n); });
  await db.schema.createTable("links", (t) => { for (const n of ["id", "project_id", "from_id", "to_id", "relation", "created_at"]) t.text(n); });
  await db.schema.createTable("gitlab_issue_links", (t) => { t.text("task_id"); });
  await db.schema.createTable("project_repositories", (t) => { t.text("project_id"); });
  await require("../migrations/pg/112_gitlab_issue_exports.cjs").up(db); await require("../migrations/pg/103_integration_outbox.cjs").up(db);
  await db("users").insert(["owner", "dev", "qa", "outsider", "pending", "disabled"].map((id) => ({ id, email: `${id}@test`, status: id === "disabled" ? "disabled" : "active" })));
  await db("projects").insert({ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "owner", status: "active" });
  await db("project_members").insert(["owner", "dev", "qa", "pending", "disabled"].map((user_id) => ({ project_id: "P-TEST", user_id, role: user_id === "qa" ? "tester" : "developer", status: user_id === "pending" ? "pending_approval" : "active" })));
  await db("tasks").insert({ id: "T-TEST-000", project_id: "P-TEST", title: "Old task", assignee_user_id: "dev", status: "todo", created_by: "user:owner" });
  await require("../migrations/pg/123_task_assignees.cjs").up(db); await require("../migrations/pg/138_task_workflow.cjs").up(db); service = new TestService(db);
});
afterEach(async () => { await db.destroy(); vi.unstubAllEnvs(); });

describe("shared task assignees", () => {
  it("backfills, resolves/deduplicates members and fans out notifications and durable offers without repeat offers", async () => {
    expect(await getTaskAssigneeIds(db, await db("tasks").first())).toEqual(["dev"]);
    const task = await create(["dev", "qa@test", "dev@test"]);
    expect(task).toMatchObject({ assigneeUserIds: ["dev", "qa"], assigneeUserId: "dev" });
    const events = await db("events").where({ related_id: task.id, type: "task.assigned" });
    expect(events.map((e) => JSON.parse(String(e.target_user_ids)))).toEqual([["dev"], ["qa"]]);
    const offers = await db("integration_outbox").where({ task_id: task.id });
    expect(offers.map((o) => o.recipient_user_id).sort()).toEqual(["dev", "qa"]); expect(new Set(offers.map((o) => o.idempotency_key)).size).toBe(2);
    await call("task.update_assignee", { id: task.id, assignees: ["dev", "qa"] });
    expect(await db("integration_outbox").where({ task_id: task.id })).toHaveLength(2);
  });

  it("supports GraphQL/record/me filters, legacy single/clear inputs and implicit project owner", async () => {
    const task = await create();
    const result = await graphql({ schema: gatewaySchema, contextValue: { service, requestContext: owner }, variableValues: { id: task.id }, source: `query($id:ID!){
      task(id:$id){id assigneeUserIds assigneeUserId} record(id:$id){record{...on Task{assigneeUserIds}}}
      tasksPage(project:"test",assignee:"qa"){items{id assigneeUserIds} pageInfo{totalCount}}
    }` });
    expect(result.errors).toBeUndefined();
    expect(result.data).toMatchObject({ task: { assigneeUserIds: ["dev", "qa"] }, record: { record: { assigneeUserIds: ["dev", "qa"] } }, tasksPage: { items: [{ id: task.id }], pageInfo: { totalCount: 1 } } });
    const me = await call("task.list", { project: "test", assignee: "me" }, { ...owner, clientId: "user:qa", sessionUserId: "qa" });
    expect((me.tasks as Row[]).map((t) => t.id)).toContain(task.id);
    expect((await call("task.update_assignee", { id: task.id, assignee: "qa" })).task).toMatchObject({ assigneeUserIds: ["qa"] });
    expect((await call("task.update_assignee", { id: task.id, assignee: null })).task).toMatchObject({ assigneeUserIds: [], assigneeUserId: null });
    expect((await call("task.create", { project: "test", title: "Implicit owner" })).task).toMatchObject({ assigneeUserIds: ["owner"] });
  });

  it("rejects inactive/nonmembers, conflicting fields and unauthorized assignment atomically", async () => {
    const task = await create();
    for (const id of ["outsider", "pending", "disabled", "missing"]) {
      expect(await service.call("task.update_assignee", { id: task.id, assignees: ["dev", id] }, owner)).toMatchObject({ ok: false });
      expect(await getTaskAssigneeIds(db, await db("tasks").where({ id: task.id }).first())).toEqual(["dev", "qa"]);
    }
    expect(await service.call("task.create", { project: "test", title: "Invalid", assignee: "dev", assignees: ["qa"] }, owner)).toMatchObject({ ok: false });
    expect(await service.call("task.update_assignee", { id: task.id }, owner)).toMatchObject({ ok: false });
    expect(await service.call("task.update_assignee", { id: task.id, assignees: [] }, { ...owner, sessionUserId: "dev", clientId: "user:dev" })).toMatchObject({ ok: false });
  });

  it("preserves graph/status/follow-up recipients and cleans deleted user relations", async () => {
    const task = await create();
    const row = (await loadTaskAssignees(db, [await db("tasks").where({ id: task.id }).first()]))[0];
    expect(graphNodeOut("TASK", row).assigneeUserIds).toEqual(["dev", "qa"]);
    await call("task.update_status", { id: task.id, status: "review" });
    const event = await db("events").where({ related_id: task.id }).orderBy("id", "desc").first();
    expect(JSON.parse(String(event.target_user_ids)).sort()).toEqual(["dev", "qa"]);
    const changed = await call("task.update_status", { id: task.id, status: "changes_requested", note: "Fix validation" });
    expect(changed.followUpTask).toMatchObject({ assigneeUserIds: ["dev", "qa"] });
    await db("users").where({ id: "dev" }).del(); expect(await getTaskAssigneeIds(db, await db("tasks").where({ id: task.id }).first())).toEqual(["qa"]);
    expect((await call("task.get", { id: task.id })).task).toMatchObject({ assigneeUserId: "qa", assigneeUserIds: ["qa"] });
    await setTaskAssignees(db, String(task.id), []); expect(await getTaskAssigneeIds(db, await db("tasks").where({ id: task.id }).first())).toEqual([]);
  });
});
