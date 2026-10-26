import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";
import { encryptProviderKey } from "../src/gateway/ai-provider-credentials.js";
import { acceptTelegramUpdate } from "../src/gateway/telegram-project-bots/receiver.js";
import { parseMentionMessage } from "../src/gateway/telegram-project-bots/protocol.js";
import { decryptBotSecret, encryptBotSecret, projectTelegramApi } from "../src/gateway/telegram-project-bots/remote.js";
import { TelegramMessageWorker } from "../src/gateway/telegram-project-bots/worker.js";
import { notifyTelegram } from "../src/gateway/telegram.js";
import { AppError } from "../src/shared/errors.js";
import { fail } from "../src/shared/mcp/tool-response.js";
import { gatewaySchema } from "../src/gateway/graphql.js";
// Match graphql-tools' CJS instance; Vitest otherwise mixes its ESM and CJS realms.
const { graphql } = createRequire(import.meta.url)("graphql") as Pick<typeof import("graphql"), "graphql">;

vi.mock("../src/gateway/telegram-project-bots/remote.js", async (original) => ({
  ...await original<typeof import("../src/gateway/telegram-project-bots/remote.js")>(), projectTelegramApi: vi.fn()
}));
vi.mock("../src/gateway/telegram.js", async (original) => ({
  ...await original<typeof import("../src/gateway/telegram.js")>(), notifyTelegram: vi.fn().mockResolvedValue(undefined)
}));
const migration = createRequire(import.meta.url)("../migrations/pg/117_project_telegram_bots.cjs");
const owner: GatewayRequestContext = { clientId: "user:owner", sessionUserId: "owner", sessionRole: "member", sessionSource: "cookie" };
const member: GatewayRequestContext = { clientId: "user:member", sessionUserId: "member", sessionRole: "member", sessionSource: "cookie" };
const botId = randomUUID();
const token = `123456789:${"a".repeat(35)}`;
let updateId = 0;
let db: Knex;
let service: TestService;
let worker: TelegramMessageWorker;
let rollback = false;
const httpFetch = vi.fn<typeof fetch>();
const remote = { getMe: vi.fn(), getWebhookInfo: vi.fn(), setWebhook: vi.fn(), deleteWebhook: vi.fn() };

class TestService extends PgToolService {
  protected override async touchClient(): Promise<void> {}
  override async call(...args: Parameters<PgToolService["call"]>) {
    const result = await super.call(...args);
    if (args[0] === "task.create" && rollback) return fail(new AppError("GATEWAY_ERROR", "Injected failure after insert"));
    return result;
  }
}
function payload(text = "#ошибка @member исправь вход", chatId = -10012345, messageId = 10, extra: Row = {}) {
  return Buffer.from(JSON.stringify({ update_id: ++updateId, message: { message_id: messageId,
    chat: { id: chatId, type: "supergroup", title: "Team" }, text,
    entities: [...text.matchAll(/@[a-zA-Z0-9_]+/g)].map((m) => ({ type: "mention", offset: m.index, length: m[0].length }))
      .concat([...text.matchAll(/#[\p{L}\p{N}_]+/gu)].map((m) => ({ type: "hashtag", offset: m.index, length: m[0].length }))), ...extra } }));
}
function assignment(telegramUserId = "22", extra: Row = {}) {
  return { telegramUserId, title: "Исправить вход", description: "Исправить вход в приложение.", evidence: "исправь вход", confidence: 0.98, ...extra };
}
function reply(tasks: Row[]) {
  httpFetch.mockImplementation(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ tasks }) } }] }));
}
async function deliver(raw = payload(), id = botId) { return acceptTelegramUpdate(db, id, raw); }

beforeEach(async () => {
  vi.stubEnv("PROJECT_MEMORY_PUBLIC_URL", "https://marrow.example.test/api");
  vi.stubEnv("TELEGRAM_BOT_ENC_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("AI_PROVIDER_ENC_KEY", Buffer.alloc(32, 8).toString("base64"));
  vi.stubEnv("TELLY_INBOX_ENABLED", "false");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  updateId = 0; rollback = false; httpFetch.mockReset(); vi.mocked(notifyTelegram).mockClear();
  remote.getMe.mockReset().mockResolvedValue({ id: 123456789, is_bot: true, username: "project_bot" });
  remote.getWebhookInfo.mockReset().mockResolvedValue({ url: "" });
  remote.setWebhook.mockReset().mockResolvedValue(true); remote.deleteWebhook.mockReset().mockResolvedValue(true);
  vi.mocked(projectTelegramApi).mockReturnValue(remote as unknown as ReturnType<typeof projectTelegramApi>);
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = ON");
  await db.schema.createTable("users", (t) => { t.text("id").primary(); t.text("email"); t.text("status"); });
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); for (const n of ["slug", "title", "owner_user_id", "status"]) t.text(n); });
  await db.schema.createTable("project_members", (t) => { for (const n of ["project_id", "user_id", "status", "role"]) t.text(n); });
  await db.schema.createTable("gateway_clients", (t) => { t.text("id"); t.text("owner_user_id"); });
  await db.schema.createTable("telegram_identities", (t) => { t.text("telegram_id").primary(); t.text("user_id"); t.text("username"); });
  await db.schema.createTable("ai_provider_credentials", (t) => {
    t.text("id").primary(); for (const n of ["owner_user_id", "provider", "model", "api_key_enc", "created_at"]) t.text(n); t.boolean("is_default");
  });
  await db.schema.createTable("tasks", (t) => {
    t.text("id").primary(); t.integer("priority"); t.integer("version");
    for (const n of ["project_id", "title", "status", "milestone", "scope", "acceptance", "allowed_files", "forbidden_files", "depends_on", "notes", "assignee_user_id", "project_version", "created_by", "updated_by", "source_instance_id", "created_at", "updated_at"]) t.text(n);
  });
  await db.schema.createTable("events", (t) => {
    t.text("id").primary(); for (const n of ["project_id", "type", "title", "body", "related_id", "agent_name", "target_user_ids", "created_by", "source_instance_id", "created_at"]) t.text(n);
  });
  await migration.up(db);
  await db("users").insert(["owner", "member", "pending", "outsider", "disabled"].map((id) => ({ id, email: `${id}@test`, status: id === "disabled" ? "disabled" : "active" })));
  await db("projects").insert([{ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "owner", status: "active" }, { id: "P-OTHER", slug: "other", title: "Other", owner_user_id: "outsider", status: "active" }]);
  await db("project_members").insert(["owner", "member", "pending", "disabled"].map((user_id) => ({ project_id: "P-TEST", user_id, status: user_id === "pending" ? "pending_approval" : "active", role: "developer" })));
  await db("telegram_identities").insert(["owner", "member", "pending", "outsider", "disabled"].map((user_id, index) => ({ user_id, telegram_id: String(11 * (index + 1)), username: user_id })));
  await db("ai_provider_credentials").insert({ id: "ai-owner", owner_user_id: "owner", provider: "deepseek", model: "owners-model", api_key_enc: encryptProviderKey("owner-ai-key"), is_default: true, created_at: "2026-01-01" });
  await db("project_telegram_bots").insert({ id: botId, project_id: "P-TEST", telegram_bot_id: "123456789", username: "project_bot", filter_tags: '["ошибка","проверка"]', token_enc: encryptBotSecret(token), poll_revision: randomUUID(), enabled: true, created_at: "2026-01-01", updated_at: "2026-01-01" });
  await db("project_telegram_chats").insert({ bot_id: botId, chat_id: "-10012345", title: "Team", created_at: "2026-01-01" });
  service = new TestService(db);
  worker = new TelegramMessageWorker(db, undefined, httpFetch, (trx) => new TestService(trx));
  reply([assignment()]);
});
afterEach(async () => { await worker.stop(); await db.destroy(); vi.unstubAllEnvs(); });

describe("project bot and chat configuration", () => {
  it("reports configured activity and current Telegram connection separately through GraphQL", async () => {
    const source = '{ projectTelegramBots(project:"test") { bots { enabled pollingStatus } } }';
    const read = async () => {
      const result = await graphql({ schema: gatewaySchema, source, contextValue: { service, requestContext: owner } });
      expect(result.errors).toBeUndefined(); return result.data;
    };
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ enabled: true, pollingStatus: "starting" }] } });
    await db("project_telegram_bots").update({ poll_owner: randomUUID(), poll_lease_until: new Date(Date.now() + 60_000).toISOString(), last_polled_at: new Date().toISOString() });
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ enabled: true, pollingStatus: "active" }] } });
    await db("project_telegram_bots").update({ last_error: "AI_PROVIDER_REQUIRED" });
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ pollingStatus: "active" }] } });
    await db("project_telegram_bots").update({ poll_error: "TELEGRAM_POLL_FAILED" });
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ enabled: true, pollingStatus: "error" }] } });
    await service.call("project.telegram_bot_disconnect", { project: "test", id: botId }, owner);
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ enabled: false, pollingStatus: "inactive" }] } });
    expect(await db("project_telegram_chats")).toHaveLength(1);
    await service.call("project.telegram_bot_connect", { project: "test", id: botId }, owner);
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ enabled: true, pollingStatus: "starting" }] } });
    await db("project_telegram_bots").update({ last_polled_at: new Date().toISOString(), poll_lease_until: "2000-01-01" });
    expect(await read()).toMatchObject({ projectTelegramBots: { bots: [{ pollingStatus: "starting" }] } });
  });

  it("serves the Bots tab's GraphQL queries and key mutation with owner authorization", async () => {
    const source = '{ projectTelegramBots(project:"test") { deepseekReady bots { id username enabled pendingCount failedCount chats { chatId title } } } }';
    const contextValue = { service, requestContext: owner };
    const result = await graphql({ schema: gatewaySchema, source, contextValue });
    expect(result.errors).toBeUndefined();
    expect(result.data).toMatchObject({ projectTelegramBots: { deepseekReady: true, bots: [{ id: botId, username: "project_bot" }] } });
    const code = await graphql({ schema: gatewaySchema, contextValue,
      source: `mutation { projectTelegramBotLinkCode(project:"test", id:"${botId}") { command expiresAt } }` });
    expect(code.errors).toBeUndefined(); expect(code.data?.projectTelegramBotLinkCode).toMatchObject({ command: expect.stringContaining("/marrow_link@project_bot ") });
    const forbidden = await graphql({ schema: gatewaySchema, source, contextValue: { service, requestContext: member } });
    expect(forbidden.errors).toHaveLength(1);
  });

  it("restricts management and keys to the owner/admin, scopes bot IDs and never returns secrets", async () => {
    for (const name of ["project.telegram_bots", "project.telegram_bot_add", "project.telegram_bot_set_tags", "project.telegram_bot_link_code", "project.telegram_bot_disconnect", "project.telegram_bot_unlink_chat", "project.telegram_bot_retry", "project.telegram_bot_remove"]) {
      expect(await service.call(name, { project: "test", id: botId, token, tags: ["ошибка"], chatId: "-10012345" }, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    }
    expect(remote.getMe).not.toHaveBeenCalled();
    expect(await service.call("project.telegram_bot_disconnect", { project: "other", id: botId }, { ...owner, sessionRole: "admin" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const list = await service.call("project.telegram_bots", { project: "test" }, owner);
    expect(list).toMatchObject({ ok: true, data: { deepseekReady: true, bots: [{ username: "project_bot", chats: [{ chatId: "-10012345" }] }] } });
    for (const value of [token, "token_enc", "owner-ai-key"]) expect(JSON.stringify(list)).not.toContain(value);
  });

  it("supports several bots and chat bindings and consumes an expiring link key only once", async () => {
    vi.stubEnv("PROJECT_MEMORY_PUBLIC_URL", ""); // polling needs no public callback
    remote.getMe.mockResolvedValue({ id: 987654321, is_bot: true, username: "second_bot" });
    expect(await service.call("project.telegram_bot_add", { project: "test", token: `987654321:${"b".repeat(35)}`, tags: ["ошибка"] }, owner)).toMatchObject({ ok: true, data: { enabled: true } });
    expect(await db("project_telegram_bots")).toHaveLength(2);
    const second = await db("project_telegram_bots").where({ username: "second_bot" }).first();
    expect(decryptBotSecret(second.token_enc)).toContain("987654321:");
    expect(remote.setWebhook).not.toHaveBeenCalled();
    const key = await service.call("project.telegram_bot_link_code", { project: "test", id: botId }, owner);
    if (!key.ok) throw new Error(key.error.message);
    const command = (key.data as Row).command as string;
    expect(await deliver(payload(command, -100555))).toMatchObject({ bound: true });
    expect(await deliver(payload(command, -100666))).toMatchObject({ ignored: true });
    expect(await db("project_telegram_chats").where({ bot_id: botId })).toHaveLength(2);
    const expired = await service.call("project.telegram_bot_link_code", { project: "test", id: botId }, owner);
    if (!expired.ok) throw new Error(expired.error.message);
    await db("project_telegram_bots").where({ id: botId }).update({ link_code_expires_at: "2000-01-01" });
    expect(await deliver(payload(String((expired.data as Row).command), -100777))).toMatchObject({ ignored: true });
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("refuses foreign webhooks, bots attached to another project and the notification bot", async () => {
    remote.getWebhookInfo.mockResolvedValue({ url: "https://other-app.test/webhook" });
    expect(await service.call("project.telegram_bot_add", { project: "test", token, tags: ["ошибка"] }, owner)).toMatchObject({ ok: false });
    remote.getWebhookInfo.mockResolvedValue({ url: "" });
    expect(await service.call("project.telegram_bot_add", { project: "other", token, tags: ["ошибка"] }, { ...owner, sessionRole: "admin" })).toMatchObject({ ok: false });
    vi.stubEnv("TELEGRAM_BOT_TOKEN", token);
    expect(await service.call("project.telegram_bot_add", { project: "test", token, tags: ["ошибка"] }, owner)).toMatchObject({ ok: false });
  });

  it("disables polling locally during a Telegram outage, and unlinks queued messages", async () => {
    await deliver();
    await service.call("project.telegram_bot_unlink_chat", { project: "test", id: botId, chatId: "-10012345" }, owner);
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled();
    remote.getWebhookInfo.mockRejectedValue(new Error(`secret ${token}`));
    expect(await service.call("project.telegram_bot_disconnect", { project: "test", id: botId }, owner)).toMatchObject({ ok: true, data: { enabled: false } });
    expect(await deliver()).toMatchObject({ stopped: true });
    expect(remote.getWebhookInfo).not.toHaveBeenCalled();
  });

  it("removes a bot and its bindings locally without needing Telegram connectivity", async () => {
    remote.getWebhookInfo.mockRejectedValue(new Error("unreachable"));
    expect(await service.call("project.telegram_bot_remove", { project: "test", id: botId }, owner)).toMatchObject({ ok: true, data: { removed: true } });
    expect(remote.getWebhookInfo).not.toHaveBeenCalled(); expect(remote.deleteWebhook).not.toHaveBeenCalled();
    expect(await db("project_telegram_chats")).toHaveLength(0);
  });

});

describe("Telegram mention pipeline", () => {
  it("applies exact per-bot Unicode hashtag filters before queuing or charging DeepSeek", async () => {
    const changed = await service.call("project.telegram_bot_set_tags", { project: "test", id: botId, tags: ["#ОШИБКА", "ошибка"] }, owner);
    expect(changed).toMatchObject({ ok: true, data: { tags: ["ошибка"] } });
    for (const text of ["@member исправь вход", "#проверка @member исправь вход", "#ошибках @member исправь вход"]) {
      expect(await deliver(payload(text))).toMatchObject({ ignored: true });
    }
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled();
    expect(await deliver(payload("#ОШИБКА @member исправь вход"))).toMatchObject({ accepted: true });
    await worker.tick(); expect(await db("tasks")).toHaveLength(1);
    expect(await service.call("project.telegram_bot_set_tags", { project: "test", id: botId, tags: [] }, owner)).toMatchObject({ ok: false });
    expect(await service.call("project.telegram_bot_set_tags", { project: "test", id: botId, tags: ["bad tag"] }, owner)).toMatchObject({ ok: false });
  });

  it("honors different tags for bots in the same group", async () => {
    await service.call("project.telegram_bot_set_tags", { project: "test", id: botId, tags: ["ошибка"] }, owner);
    const original = await db("project_telegram_bots").first(); const secondId = randomUUID();
    await db("project_telegram_bots").insert({ ...original, id: secondId, telegram_bot_id: "9999999", filter_tags: '["проверка"]' });
    await db("project_telegram_chats").insert({ bot_id: secondId, chat_id: "-10012345", title: "Team", created_at: "2026-01-01" });
    const raw = payload("#проверка @member исправь вход");
    expect(await deliver(raw)).toMatchObject({ ignored: true });
    expect(await deliver(raw, secondId)).toMatchObject({ accepted: true });
    await worker.tick(); expect(await db("tasks")).toHaveLength(1);
  });

  it("rechecks changed tag filters before processing queued messages", async () => {
    await deliver();
    await service.call("project.telegram_bot_set_tags", { project: "test", id: botId, tags: ["проверка"] }, owner);
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(0);
  });

  it("skips unbound chats, nonmembers and private chats before any AI request", async () => {
    for (const raw of [payload(undefined, -100999), payload("#ошибка @outsider исправь вход"), payload("#ошибка @pending исправь вход"), payload("#ошибка @disabled исправь вход"), payload("hello"), payload(undefined, 22, 10, { chat: { id: 22, type: "private" } })]) {
      expect(await deliver(raw)).toMatchObject({ ignored: true });
    }
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("telegram_message_inbox")).toHaveLength(0);
  });

  it("uses only the owner's saved DeepSeek model/key and creates an assigned task with provenance", async () => {
    await deliver(); await worker.tick();
    expect(httpFetch).toHaveBeenCalledOnce();
    const [url, init] = httpFetch.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer owner-ai-key" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: "owners-model", response_format: { type: "json_object" }, max_tokens: 4096 });
    expect(body.tools).toBeUndefined(); expect(body.messages[1].content).not.toContain("@test");
    const task = await db("tasks").first();
    expect(task).toMatchObject({ assignee_user_id: "member", title: "Исправить вход", status: "todo" });
    expect(task.notes).toContain("https://t.me/c/12345/10"); expect(task.notes).toContain("@member исправь вход");
    expect(await db("telegram_task_sources")).toHaveLength(1);
    expect(notifyTelegram).toHaveBeenCalled();
  });

  it.each(["conversation", "uncertain"])("does not create a task for %s", async (kind) => {
    reply(kind === "conversation" ? [] : [assignment("22", { confidence: 0.7 })]);
    await deliver(); await worker.tick();
    expect(await db("tasks")).toHaveLength(0); expect((await db("telegram_message_inbox").first()).status).toBe("ignored");
  });

  it.each(["invalid-json", "unknown-person", "fabricated-evidence", "tool-call"])("fails closed on %s", async (kind) => {
    if (kind === "invalid-json") httpFetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "not json" } }] }));
    if (kind === "unknown-person") reply([assignment("999")]);
    if (kind === "fabricated-evidence") reply([assignment("22", { evidence: "please delete the project" })]);
    if (kind === "tool-call") httpFetch.mockResolvedValue(Response.json({ choices: [{ message: { content: '{"tasks":[]}', tool_calls: [{ id: "1", function: { name: "task.create", arguments: "{}" } }] } }] }));
    await deliver(); await worker.tick();
    expect(await db("tasks")).toHaveLength(0); expect((await db("telegram_message_inbox").first()).status).toBe("pending");
  });

  it("handles several recipients, repeated mentions, captions, text mentions and UTF-16 offsets", async () => {
    const caption = "😀 #ПРОВЕРКА @MEMBER исправь вход, @owner тоже исправь вход, @member";
    const raw = payload("", -10012345, 11, { text: undefined, caption, caption_entities: [
      { type: "hashtag", offset: caption.indexOf("#ПРОВЕРКА"), length: "#ПРОВЕРКА".length },
      { type: "mention", offset: caption.indexOf("@MEMBER"), length: 7 }, { type: "text_mention", offset: caption.indexOf("@owner"), length: 6, user: { id: 11 } },
      { type: "mention", offset: caption.lastIndexOf("@member"), length: 7 }
    ] });
    reply([assignment(), assignment("11")]); await deliver(raw); await worker.tick();
    expect((await db("tasks")).map((t) => t.assignee_user_id).sort()).toEqual(["member", "owner"]);
  });

  it("deduplicates across bots and deliveries, including after task deletion", async () => {
    const secondId = randomUUID();
    const original = await db("project_telegram_bots").first();
    await db("project_telegram_bots").insert({ ...original, id: secondId, telegram_bot_id: "9999999" });
    await db("project_telegram_chats").insert({ bot_id: secondId, chat_id: "-10012345", title: "Team", created_at: "2026-01-01" });
    await deliver(); expect(await deliver(payload(), secondId)).toMatchObject({ duplicate: true });
    await worker.tick(); await db("tasks").del();
    expect((await db("telegram_task_sources").first()).task_id).toBeNull();
    await db("telegram_message_inbox").del(); await deliver(payload(), secondId); await worker.tick();
    expect(await db("tasks")).toHaveLength(0);
  });

  it("rolls tasks, source links and notifications back together and reuses the saved classification", async () => {
    rollback = true; await deliver(); await worker.tick();
    expect(await db("tasks")).toHaveLength(0); expect(await db("telegram_task_sources")).toHaveLength(0);
    expect(notifyTelegram).not.toHaveBeenCalled();
    rollback = false; await db("telegram_message_inbox").update({ available_at: "2000-01-01" }); await worker.tick();
    expect(await db("tasks")).toHaveLength(1); expect(httpFetch).toHaveBeenCalledOnce();
  });

  it("does not use someone else's credential when the owner's DeepSeek is missing, and permits retries", async () => {
    await db("ai_provider_credentials").update({ owner_user_id: "member" });
    await deliver(); await worker.tick();
    expect(httpFetch).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(0);
    await db("telegram_message_inbox").update({ attempts: 4, available_at: "2000-01-01" }); await worker.tick();
    expect((await db("telegram_message_inbox").first()).status).toBe("failed");
    await db("ai_provider_credentials").update({ owner_user_id: "owner" });
    expect(await service.call("project.telegram_bot_retry", { project: "test", id: botId }, owner)).toMatchObject({ ok: true, data: { retried: 1 } });
    await worker.tick(); expect(await db("tasks")).toHaveLength(1);
  });

  it("rechecks chat binding and membership after the AI call", async () => {
    httpFetch.mockImplementation(async () => {
      await db("project_members").where({ user_id: "member" }).del();
      return Response.json({ choices: [{ message: { content: JSON.stringify({ tasks: [assignment()] }) } }] });
    });
    await deliver(); await worker.tick(); expect(await db("tasks")).toHaveLength(0);
  });

  it("does not create tasks when a chat is unlinked during classification", async () => {
    httpFetch.mockImplementation(async () => {
      await service.call("project.telegram_bot_unlink_chat", { project: "test", id: botId, chatId: "-10012345" }, owner);
      return Response.json({ choices: [{ message: { content: JSON.stringify({ tasks: [assignment()] }) } }] });
    });
    await deliver(); await worker.tick(); expect(await db("tasks")).toHaveLength(0);
  });

  it("ignores edited posts and bot/private messages, supports channel posts and public links", () => {
    expect(parseMentionMessage(Buffer.from('{"update_id":2,"edited_message":{}}'))).toBeNull();
    expect(parseMentionMessage(payload(undefined, -10012345, 12, { from: { id: 123, is_bot: true } }))).toBeNull();
    const json = JSON.parse(payload().toString());
    json.channel_post = { ...json.message, chat: { id: -1001, type: "channel", username: "announcements" } }; delete json.message;
    expect(parseMentionMessage(Buffer.from(JSON.stringify(json)))).toMatchObject({ url: "https://t.me/announcements/10", usernames: ["member"] });
  });

  it("commits update offsets atomically with queue insertion and resumes an identical update after a DB failure", async () => {
    const raw = payload();
    await db.raw("CREATE TRIGGER reject_telegram_queue BEFORE INSERT ON telegram_message_inbox BEGIN SELECT RAISE(ABORT, 'injected database failure'); END");
    await expect(deliver(raw)).rejects.toThrow("injected database failure");
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(0);
    await db.raw("DROP TRIGGER reject_telegram_queue");
    await deliver(raw);
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(JSON.parse(raw.toString()).update_id + 1);
    expect(await deliver(raw)).toMatchObject({ duplicate: true });
    expect(await db("telegram_message_inbox")).toHaveLength(1);
  });

  it("advances offsets for unsupported updates and rejects an obsolete polling lease", async () => {
    await deliver(Buffer.from('{"update_id":50,"edited_message":{}}'));
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(51);
    const raw = Buffer.from('{"update_id":51}');
    expect(await acceptTelegramUpdate(db, botId, raw, { owner: randomUUID(), revision: randomUUID() })).toMatchObject({ stopped: true });
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(51);
    await deliver(Buffer.from('{"update_id":51,"message":{"new_unsupported_shape":true}}'));
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(52);
    await expect(deliver(Buffer.from('{"update_id":"invalid"}'))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

});
