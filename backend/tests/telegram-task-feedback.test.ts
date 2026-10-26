import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { GrammyError, type Api } from "grammy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";
import { TelegramTaskFeedbackDispatcher } from "../src/gateway/telegram-project-bots/feedback-worker.js";
import { encryptBotSecret } from "../src/gateway/telegram-project-bots/remote.js";
import { telegramParticipants } from "../src/gateway/telegram-project-bots/participant-references.js";
import { nowIso } from "../src/shared/dates.js";
const require = createRequire(import.meta.url);
vi.mock("../src/gateway/telegram.js", async (original) => ({ ...await original<typeof import("../src/gateway/telegram.js")>(), notifyTelegram: vi.fn().mockResolvedValue(undefined) }));
const owner: GatewayRequestContext = { clientId: "user:owner", sessionUserId: "owner", sessionRole: "member", sessionSource: "cookie" };
const dev = { ...owner, clientId: "user:dev", sessionUserId: "dev" };
const qa = { ...owner, clientId: "user:qa", sessionUserId: "qa" };
const botId = randomUUID();
let db: Knex;
let service: TestService;
let dispatcher: TelegramTaskFeedbackDispatcher;
let remote: ReturnType<typeof vi.fn>;
class TestService extends PgToolService {
  protected override async touchClient(): Promise<void> {}
  protected override taskSelectWithActiveClaimCount(query: Knex.QueryBuilder) { return query.select("tasks.*"); }
}
async function call(name: string, input: Row, context = owner): Promise<Row> {
  const result = await service.call(name, input, context);
  if (!result.ok) throw new Error(result.error.message);
  return result.data as Row;
}
async function create(source = true) {
  const task = (await call("task.create", { project: "test", title: "Implement and test login", assignees: ["dev"], notes: "Source", })).task as Row;
  if (source) await db("telegram_task_sources").insert({ project_id: "P-TEST", task_id: task.id, bot_id: botId, chat_id: "-100123", message_id: "44", message_thread_id: 7, telegram_user_id: "message", created_at: nowIso() });
  return task;
}
const feedback = () => db("integration_outbox").where({ integration: "telegram_project_bot" }).orderBy("created_at");
const resultText = () => JSON.stringify(remote.mock.calls.map((c) => c[1]));
beforeEach(async () => {
  vi.stubEnv("TELLYMCP_INBOX_MCP_URL", ""); vi.stubEnv("TELLYMCP_INBOX_BEARER_TOKEN", "test-token");
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
  await db.schema.createTable("links", (t) => { for (const n of ["id", "project_id", "from_id", "to_id", "relation", "created_at"]) t.text(n); });
  await db.schema.createTable("gitlab_issue_links", (t) => { t.text("task_id"); });
  await db.schema.createTable("project_repositories", (t) => { t.text("id").primary(); t.text("project_id"); });
  await require("../migrations/pg/112_gitlab_issue_exports.cjs").up(db); await require("../migrations/pg/103_integration_outbox.cjs").up(db);
  await db("users").insert(["owner", "dev", "qa", "outsider", "pending", "disabled"].map((id) => ({ id, email: `${id}@test`, status: id === "disabled" ? "disabled" : "active" })));
  await db("projects").insert({ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "owner", status: "active" });
  await db("project_members").insert(["owner", "dev", "qa", "pending", "disabled"].map((user_id) => ({ project_id: "P-TEST", user_id, role: user_id === "qa" ? "tester" : "developer", status: user_id === "pending" ? "pending_approval" : "active" })));
  await db("tasks").insert({ id: "T-TEST-000", project_id: "P-TEST", title: "Old task", assignee_user_id: "dev", status: "todo", created_by: "user:owner" });
  await require("../migrations/pg/123_task_assignees.cjs").up(db); service = new TestService(db);
  for (const name of ["005_task_claims", "063_telegram_identities", "117_project_telegram_bots", "121_telegram_chat_mentions", "126_telegram_observed_senders", "127_telegram_recipient_tags", "129_telegram_task_feedback_source"])
    await require(`../migrations/pg/${name}.cjs`).up(db);
  await createRequire(import.meta.url)("../migrations/pg/132_telegram_outgoing_messages.cjs").up(db);
  vi.stubEnv("TELEGRAM_BOT_ENC_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("PROJECT_MEMORY_PUBLIC_URL", "https://marrow.test/api");
  await db("project_telegram_bots").insert({ id: botId, project_id: "P-TEST", telegram_bot_id: "123", username: "project_bot", token_enc: encryptBotSecret("123:fake"), filter_tags: "[]", poll_revision: randomUUID(), enabled: true, created_at: nowIso(), updated_at: nowIso() });
  await db("project_telegram_chats").insert({ bot_id: botId, chat_id: "-100123", title: "Team", created_at: nowIso() });
  await db("telegram_identities").insert({ id: "linked-dev", user_id: "dev", telegram_id: "111", telegram_username: "backend_dev", created_at: nowIso() });
  await db("telegram_chat_mentions").insert({ bot_id: botId, chat_id: "-100123", mention_key: "222", username: "frontend_qa", label: "QA", user_id: "qa", last_seen_at: nowIso() });
  remote = vi.fn().mockResolvedValue({ message_id: 333 });
  dispatcher = new TelegramTaskFeedbackDispatcher(db, undefined, () => ({ sendRichMessage: remote }) as unknown as Pick<Api, "sendRichMessage">);
});
afterEach(async () => { await dispatcher?.stop(); await db.destroy(); vi.unstubAllEnvs(); });

describe("Telegram task lifecycle feedback", () => {
  it("commits DONE and one durable reply, preserves source/topic and resolves Telegram users", async () => {
    const task = await create();
    remote.mockImplementation(async () => {
      expect((await db("tasks").where({ id: task.id }).first()).status).toBe("done");
      return { message_id: 333 };
    });
    await call("task.complete", { id: task.id, acceptanceEvidence: "All tests passed" });
    expect(remote).not.toHaveBeenCalled();
    await call("task.complete", { id: task.id, acceptanceEvidence: "Retry" });
    expect(await feedback()).toHaveLength(1);
    await dispatcher.tick(); await dispatcher.tick();
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote.mock.calls[0].slice(0, 3)).toMatchObject(["-100123", { blocks: expect.any(Array) }, { message_thread_id: 7, reply_parameters: { message_id: 44 } }]);
    // The actor has no Telegram identity. Never invent an ID/email for them.
    expect(resultText()).toContain("участник без Telegram-привязки");
    expect(resultText()).not.toContain("owner@test");
    expect((await feedback())[0]).toMatchObject({ delivery_status: "delivered", attempt_count: 1 });
    await call("task.update_status", { id: task.id, status: "doing" });
    await call("task.complete", { id: task.id, acceptanceEvidence: "Retested" });
    expect(await feedback()).toHaveLength(2);
    await dispatcher.tick(); expect(remote).toHaveBeenCalledTimes(2);
  });

  it("requires a CLAR question, deduplicates retries, sends it to the Telegram source and creates no follow-up", async () => {
    const task = await create();
    expect(await service.call("task.update_status", { id: task.id, status: "clar", note: "  " }, dev)).toMatchObject({ ok: false });
    const input = { id: task.id, status: "clar", note: "Какие поля нужны?" };
    expect((await call("task.update_status", input, dev)).task).toMatchObject({ status: "clar" });
    await call("task.update_status", input, dev);
    expect(await feedback()).toHaveLength(1);
    const event = await db("events").where({ related_id: task.id, type: "task.clarification_requested" }).first();
    expect(JSON.parse(event.target_user_ids)).toEqual([]);
    await dispatcher.tick();
    expect(resultText()).toContain("CLAR"); expect(resultText()).toContain("Какие поля нужны?"); expect(resultText()).toContain("@backend_dev");
    expect(await db("tasks")).toHaveLength(2); // seed + this shared task
    expect(await db("events").where({ type: "task.completed" })).toHaveLength(0);
    await call("task.update_status", { ...input, note: "Нужен ли экспорт?" }, qa);
    expect(await feedback()).toHaveLength(2);
  });

  it("uses ordinary creator/assignee notifications for a non-Telegram CLAR task", async () => {
    const task = await create(false);
    await call("task.update_status", { id: task.id, status: "clar", note: "Which format?" }, qa);
    const event = await db("events").where({ related_id: task.id, type: "task.clarification_requested" }).first();
    expect(JSON.parse(event.target_user_ids).sort()).toEqual(["dev", "owner"]);
    expect(await feedback()).toHaveLength(0);
  });

  it("cycles stage handoffs on ONE task, offers each next member through Telly and fences repeated/stale calls", async () => {
    const task = await create();
    vi.stubEnv("TELLYMCP_INBOX_MCP_URL", "https://telly.invalid/mcp");
    const input = { id: task.id, assignees: ["qa"], expectedVersion: Number(task.version), note: "API ready; connect the form" };
    const next = (await call("task.handoff", input, dev)).task as Row;
    expect(next).toMatchObject({ status: "todo", assigneeUserIds: ["qa"] });
    await call("task.handoff", input, dev); // retry after ownership passed
    expect(await feedback()).toHaveLength(1);
    expect(await db("integration_outbox").where({ integration: "tellymcp" })).toHaveLength(1);
    // Make both events ready before dispatch; a later state must not erase history.
    await db("telegram_identities").where({ user_id: "dev" }).del(); // remembered at first handoff
    await call("task.handoff", { id: task.id, assignees: ["dev"], expectedVersion: Number(next.version), note: "Form connected; fix validation" }, qa);
    expect(await db("tasks")).toHaveLength(2);
    expect(await feedback()).toHaveLength(2);
    expect(await service.call("task.handoff", input, dev)).toMatchObject({ ok: false });
    await dispatcher.tick();
    expect(remote).toHaveBeenCalledTimes(2);
    expect(resultText()).toContain("@backend_dev"); expect(resultText()).toContain("@frontend_qa");
    expect(resultText()).not.toContain("dev@test"); expect(resultText()).not.toContain("qa@test");
    const snapshot = JSON.parse((await db("telegram_task_sources").first()).participants);
    expect(snapshot.dev).toMatchObject([{ telegramId: "111", username: "backend_dev" }]);
  });

  it("distinguishes ordinary reassignment from completion and rejects foreign/non-Telegram handoffs", async () => {
    const task = await create();
    expect(await service.call("task.handoff", { id: task.id, assignees: ["qa"], note: "done", expectedVersion: task.version }, qa)).toMatchObject({ ok: false });
    await call("task.update_assignee", { id: task.id, assignees: ["qa"] });
    await dispatcher.tick();
    expect(resultText()).toContain("Исполнители изменены"); expect(resultText()).not.toContain("Этап завершён");
    const ordinary = await create(false);
    expect(await service.call("task.handoff", { id: ordinary.id, assignees: ["qa"], note: "done", expectedVersion: ordinary.version }, dev)).toMatchObject({ ok: false });
  });

  it("defers disabled bots, ignores other integration queues, and resumes after activation", async () => {
    const task = await create(); await call("task.update_status", { id: task.id, status: "clar", note: "Question?" }, dev);
    const row = (await feedback())[0];
    await db("integration_outbox").insert({ ...row, id: randomUUID(), integration: "tellymcp", idempotency_key: "other" });
    await db("project_telegram_bots").update({ enabled: false });
    await dispatcher.tick(); expect(remote).not.toHaveBeenCalled();
    expect((await feedback())[0]).toMatchObject({ delivery_status: "pending", attempt_count: 0 });
    await db("project_telegram_bots").update({ enabled: true }); await feedback().update({ available_at: nowIso() });
    await dispatcher.tick(); expect(remote).toHaveBeenCalledTimes(1);
    expect((await db("integration_outbox").where({ integration: "tellymcp" }).first()).delivery_status).toBe("pending");
  });

  it("never blindly resends an uncertain network result or an expired sending lease", async () => {
    const task = await create(); await call("task.update_status", { id: task.id, status: "clar", note: "Question?" }, dev);
    remote.mockRejectedValue(new Error("Network connection lost after request"));
    await dispatcher.tick(); await dispatcher.tick();
    expect(remote).toHaveBeenCalledTimes(1);
    expect((await feedback())[0]).toMatchObject({ delivery_status: "failed", last_error: "TELEGRAM_FEEDBACK_UNCERTAIN" });
    expect((await db("tasks").where({ id: task.id }).first()).status).toBe("clar");
    await feedback().update({ delivery_status: "sending", locked_until: "2000-01-01T00:00:00Z" });
    await dispatcher.tick(); expect(remote).toHaveBeenCalledTimes(1);
    expect((await feedback())[0].delivery_status).toBe("failed");
  });

  it("respects Telegram retry_after and isolates definitive permanent errors", async () => {
    const task = await create(); await call("task.update_status", { id: task.id, status: "clar", note: "Question?" }, dev);
    remote.mockRejectedValueOnce(new GrammyError("rate", { ok: false, error_code: 429, description: "rate", parameters: { retry_after: 60 } }, "sendRichMessage", {}));
    await dispatcher.tick(); expect((await feedback())[0]).toMatchObject({ delivery_status: "pending", attempt_count: 1 });
    expect(new Date((await feedback())[0].available_at).getTime()).toBeGreaterThan(Date.now() + 55000);
    await dispatcher.tick(); expect(remote).toHaveBeenCalledTimes(1);
    await feedback().update({ available_at: nowIso() });
    remote.mockRejectedValueOnce(new GrammyError("forbidden", { ok: false, error_code: 403, description: "forbidden" }, "sendRichMessage", {}));
    await dispatcher.tick(); expect((await feedback())[0]).toMatchObject({ delivery_status: "failed", last_error: "TELEGRAM_FEEDBACK_API_403" });
  });

  it.each(["unbound", "deleted-bot", "reopened"])("suppresses an unavailable source: %s", async (action) => {
    const task = await create(); await call("task.complete", { id: task.id });
    if (action === "unbound") await db("project_telegram_chats").del();
    if (action === "deleted-bot") await db("project_telegram_bots").del();
    if (action === "reopened") await call("task.update_status", { id: task.id, status: "doing" });
    await dispatcher.tick(); expect(remote).not.toHaveBeenCalled(); expect((await feedback())[0].delivery_status).toBe("failed");
  });

  it("rolls back task/event/queue atomically if outbox insertion fails", async () => {
    const task = await create();
    await db.raw("CREATE TRIGGER reject_feedback BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT, 'injected'); END");
    expect(await service.call("task.update_status", { id: task.id, status: "clar", note: "Question?" }, dev)).toMatchObject({ ok: false });
    expect((await db("tasks").where({ id: task.id }).first()).status).toBe("todo");
    expect(await db("events").where({ type: "task.clarification_requested" })).toHaveLength(0);
    expect(await feedback()).toHaveLength(0); expect(remote).not.toHaveBeenCalled();
  });

  it("serializes concurrent completions and handoffs without duplicate replies", async () => {
    const task = await create();
    const input = { id: task.id, assignees: ["qa"], expectedVersion: task.version, note: "API ready" };
    await Promise.all([call("task.handoff", input, dev), call("task.handoff", input, dev)]);
    expect(await feedback()).toHaveLength(1);
    await Promise.all([call("task.complete", { id: task.id }), call("task.complete", { id: task.id })]);
    expect(await feedback()).toHaveLength(2);
    await dispatcher.tick(); expect(remote).toHaveBeenCalledTimes(2);
  });

  it("backfills bot/thread provenance without importing old tasks or sending notifications", async () => {
    const migration = require("../migrations/pg/129_telegram_task_feedback_source.cjs");
    await migration.down(db);
    await db("telegram_task_sources").insert({ project_id: "P-TEST", task_id: "T-TEST-000", chat_id: "-100123", message_id: "99", telegram_user_id: "111", created_at: nowIso() });
    await db("telegram_message_inbox").insert({ id: randomUUID(), project_id: "P-TEST", bot_id: botId, chat_id: "-100123", message_id: "99", payload: JSON.stringify({ messageThreadId: 19 }), available_at: nowIso(), received_at: nowIso() });
    await migration.up(db);
    expect(await db("telegram_task_sources").first()).toMatchObject({ bot_id: botId, message_thread_id: 19 });
    expect(await feedback()).toHaveLength(0); expect(remote).not.toHaveBeenCalled();
  });

  it("prefers chat-local manual Telegram identities, avoids cross-chat routing and renders numeric IDs", async () => {
    await db("project_telegram_chats").insert({ bot_id: botId, chat_id: "-999", title: "Other", created_at: nowIso() });
    await db("telegram_chat_mentions").insert({ bot_id: botId, chat_id: "-999", mention_key: "333", label: "Wrong chat", user_id: "qa", last_seen_at: nowIso() });
    await db("telegram_identities").insert({ id: "qa-linked", user_id: "qa", telegram_id: "444", telegram_username: "global_qa", created_at: nowIso() });
    expect(await telegramParticipants(db, botId, "-100123", ["qa"])).toMatchObject({ qa: [{ telegramId: "222", username: "frontend_qa" }] });
    await db("telegram_chat_mentions").where({ chat_id: "-100123" }).update({ username: null });
    const task = await create(); await call("task.update_assignee", { id: task.id, assignees: ["qa"] }); await dispatcher.tick();
    expect(resultText()).toContain("tg://user?id=222"); expect(resultText()).not.toContain("@global_qa"); expect(resultText()).not.toContain("333");
  });
});
