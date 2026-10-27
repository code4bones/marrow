import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TelegramMediaWorker } from "../src/gateway/telegram-project-bots/media-worker.js";
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
import { sendRememberedTelegramReply } from "../src/gateway/telegram-project-bots/outgoing.js";
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
let artifactDir: string;
let rollback = false;
const httpFetch = vi.fn<typeof fetch>();
const remote = { sendRichMessage: vi.fn().mockResolvedValue({}), getMe: vi.fn(), getWebhookInfo: vi.fn(), setWebhook: vi.fn(), deleteWebhook: vi.fn() };

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
async function callOk(name: string, input: Row): Promise<Row> {
  const result = await service.call(name, input, owner);
  if (!result.ok) throw new Error(result.error.message);
  return result.data as Row;
}

beforeEach(async () => {
  artifactDir = mkdtempSync(join(tmpdir(), "marrow-tg-files-"));
  vi.stubEnv("ARTIFACT_DIR", artifactDir);
  vi.stubEnv("PROJECT_MEMORY_PUBLIC_URL", "https://marrow.example.test/api");
  vi.stubEnv("TELEGRAM_BOT_ENC_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("AI_PROVIDER_ENC_KEY", Buffer.alloc(32, 8).toString("base64"));
  vi.stubEnv("TELLYMCP_INBOX_MCP_URL", "");
  vi.stubEnv("TELLYMCP_INBOX_BEARER_TOKEN", "");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
  remote.sendRichMessage.mockReset().mockResolvedValue({});
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
  await db.schema.createTable("telegram_identities", (t) => { t.text("telegram_id").primary(); t.text("user_id"); t.text("telegram_username"); });
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
  await createRequire(import.meta.url)("../migrations/pg/103_integration_outbox.cjs").up(db);
  await migration.up(db);
  await createRequire(import.meta.url)("../migrations/pg/119_telegram_bot_messages.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/121_telegram_chat_mentions.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/126_telegram_observed_senders.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/127_telegram_recipient_tags.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/123_task_assignees.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/138_task_workflow.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/129_telegram_task_feedback_source.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/133_telegram_manual_task.cjs").up(db);
  await createRequire(import.meta.url)("../migrations/pg/132_telegram_outgoing_messages.cjs").up(db);
  for (const name of ["items", "decisions", "skills"]) await db.schema.createTable(name, (t) => { t.text("id").primary(); t.text("project_id"); });
  await db.schema.createTable("artifacts", (t) => {
    t.text("id").primary(); t.integer("version"); t.bigInteger("size_bytes");
    for (const n of ["project_id", "path", "title", "description", "content_type", "sha256", "storage_path", "status", "archived_at", "archived_by", "archive_reason", "tags", "project_version", "created_by", "updated_by", "source_instance_id", "created_at", "updated_at"]) t.text(n);
    t.unique(["project_id", "path"]);
  });
  await db.schema.createTable("links", (t) => { t.text("id").primary(); for (const n of ["project_id", "from_id", "to_id", "relation", "created_by", "source_instance_id", "created_at"]) t.text(n); });
  await createRequire(import.meta.url)("../migrations/pg/135_telegram_message_files.cjs").up(db);
  await db("users").insert(["owner", "member", "pending", "outsider", "disabled"].map((id) => ({ id, email: `${id}@test`, status: id === "disabled" ? "disabled" : "active" })));
  await db("projects").insert([{ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "owner", status: "active" }, { id: "P-OTHER", slug: "other", title: "Other", owner_user_id: "outsider", status: "active" }]);
  await db("project_members").insert(["owner", "member", "pending", "disabled"].map((user_id) => ({ project_id: "P-TEST", user_id, status: user_id === "pending" ? "pending_approval" : "active", role: "developer" })));
  await db("telegram_identities").insert(["owner", "member", "pending", "outsider", "disabled"].map((user_id, index) => ({ user_id, telegram_id: String(11 * (index + 1)), telegram_username: user_id })));
  await db("ai_provider_credentials").insert({ id: "ai-owner", owner_user_id: "owner", provider: "deepseek", model: "owners-model", api_key_enc: encryptProviderKey("owner-ai-key"), is_default: true, created_at: "2026-01-01" });
  await db("project_telegram_bots").insert({ id: botId, project_id: "P-TEST", telegram_bot_id: "123456789", username: "project_bot", filter_tags: '["ошибка","проверка"]', token_enc: encryptBotSecret(token), poll_revision: randomUUID(), enabled: true, created_at: "2026-01-01", updated_at: "2026-01-01" });
  await db("project_telegram_chats").insert({ bot_id: botId, chat_id: "-10012345", title: "Team", created_at: "2026-01-01" });
  service = new TestService(db);
  worker = new TelegramMessageWorker(db, undefined, httpFetch, (trx) => new TestService(trx));
  reply([assignment()]);
});
afterEach(async () => { await worker.stop(); await db.destroy(); rmSync(artifactDir, { recursive: true, force: true }); vi.unstubAllEnvs(); });

describe("Telegram feedback loop exclusion", () => {
  const rich = { blocks: [{ type: "paragraph" as const, text: "#ошибка @member исправь вход · задача передана" }] };
  const text = "#ошибка @member исправь вход · задача передана";
  it("blocks an anonymous channel echo before the send response, then remembers its message ID", async () => {
    await sendRememberedTelegramReply(db, botId, "-10012345", rich, async () => {
      expect((await db("telegram_outgoing_messages").first()).message_id).toBeNull();
      expect(await deliver(payload(text, -10012345, 91))).toMatchObject({ reason: "bot_sender", ignored: true });
      return { message_id: 91 };
    });
    expect((await db("telegram_outgoing_messages").first()).message_id).toBe("91");
    expect(await deliver(payload(text, -10012345, 91, { from: { id: 22, is_bot: false } }))).toMatchObject({ reason: "bot_sender" });
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(0);
    expect(await db("telegram_message_inbox")).toHaveLength(0);
  });
  it("blocks a second project bot, automatic channel forwarding and edited/replayed echoes", async () => {
    const secondId = randomUUID();
    const bot = await db("project_telegram_bots").where({ id: botId }).first();
    await db("project_telegram_bots").insert({ ...bot, id: secondId, telegram_bot_id: "999", username: "second_bot", poll_offset: 0 });
    await db("project_telegram_chats").insert({ bot_id: secondId, chat_id: "-10012345", title: "Same chat", created_at: "2026-01-01" });
    await sendRememberedTelegramReply(db, botId, "-10012345", rich, async () => ({ message_id: 91 }));
    const raw = payload(text, -10012345, 91);
    expect(await deliver(raw, secondId)).toMatchObject({ reason: "bot_sender" });
    expect(await deliver(raw, secondId)).toMatchObject({ duplicate: true });
    expect(await deliver(payload(text, -10012345, 92, { from: { id: 777000, is_bot: false }, is_automatic_forward: true,
      forward_origin: { type: "channel", chat: { id: -10012345 }, message_id: 91 } }))).toMatchObject({ reason: "bot_sender" });
    const edited = JSON.parse(payload(text, -10012345, 91).toString()); edited.edited_channel_post = edited.message; delete edited.message;
    expect(await deliver(Buffer.from(JSON.stringify(edited)))).toMatchObject({ reason: "bot_sender" });
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(0);
  });
  it("does not suppress a real member's tagged reply to a bot or copied text", async () => {
    await sendRememberedTelegramReply(db, botId, "-10012345", rich, async () => ({ message_id: 91 }));
    expect(await deliver(payload(text, -10012345, 92, { from: { id: 22, is_bot: false }, reply_to_message: { message_id: 91, from: { id: 123456789, is_bot: true } } }))).toMatchObject({ status: "queued" });
    await worker.tick(); expect(httpFetch).toHaveBeenCalledOnce(); expect(await db("tasks")).toHaveLength(1);
  });
  it("retains loop protection after an uncertain send and a long polling outage", async () => {
    await expect(sendRememberedTelegramReply(db, botId, "-10012345", rich, async () => { throw new Error("unknown send outcome"); })).rejects.toThrow("unknown");
    await db("telegram_outgoing_messages").update({ created_at: "2000-01-01" });
    const raw = JSON.parse(payload(text, -10012345, 91).toString()); raw.channel_post = { ...raw.message, chat: { ...raw.message.chat, type: "channel" } }; delete raw.message;
    expect(await deliver(Buffer.from(JSON.stringify(raw)))).toMatchObject({ reason: "bot_sender" });
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(0);
  });
  it("never classifies tagged replies from ourselves or another bot", async () => {
    for (const id of [123456789, 999]) {
      expect(await deliver(payload(text, -10012345, 90 + id, { from: { id, is_bot: true } }))).toMatchObject({ reason: "bot_sender" });
    }
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("telegram_message_inbox")).toHaveLength(0);
  });
});

describe("manual Telegram task confirmation", () => {
  async function skipped() {
    reply([]); await deliver(); await worker.tick(); return db("telegram_bot_messages").first();
  }
  const input = (messageId: string) => ({ project: "test", id: botId, messageId, assignees: ["member", "owner"], title: "Investigate the reported bug" });
  it("creates exactly one shared task through the existing pipeline, bypassing AI and offering resolved recipients", async () => {
    const message = await skipped();
    expect(await callOk("project.telegram_bot_message", { project: "test", id: botId, messageId: message.id })).toMatchObject({ canCreateTask: true });
    vi.stubEnv("TELLYMCP_INBOX_MCP_URL", "https://telly.test/mcp"); vi.stubEnv("TELLYMCP_INBOX_BEARER_TOKEN", "test-token");
    expect(await callOk("project.telegram_bot_message_create_task", input(message.id))).toMatchObject({ queued: true });
    const before = await db("telegram_message_inbox").first();
    await callOk("project.telegram_bot_message_create_task", input(message.id));
    expect((await db("telegram_message_inbox").first()).attempts).toBe(before.attempts);
    await worker.tick(); expect(httpFetch).toHaveBeenCalledOnce();
    expect(await db("tasks")).toHaveLength(1); expect(await db("task_assignees")).toHaveLength(2);
    expect(await db("integration_outbox").where({ integration: "tellymcp" })).toHaveLength(2);
    const task = await db("tasks").first();
    expect(task).toMatchObject({ title: input(message.id).title, created_by: `integration:telegram:${botId}` });
    expect(task.notes).toContain("Manually confirmed");
    expect(await callOk("project.telegram_bot_message_create_task", input(message.id))).toMatchObject({ queued: false, taskId: task.id });
    expect(await callOk("project.telegram_bot_message", { project: "test", id: botId, messageId: message.id })).toMatchObject({ canCreateTask: false, manual: true, tasks: [{ id: task.id }] });
  });
  it("rejects unauthorized/inactive recipients, unavailable chats and bot/filtered messages", async () => {
    const message = await skipped();
    expect(await service.call("project.telegram_bot_message_create_task", input(message.id), member)).toMatchObject({ ok: false });
    for (const id of ["disabled", "pending", "outsider"]) expect(await service.call("project.telegram_bot_message_create_task", { ...input(message.id), assignees: [id] }, owner)).toMatchObject({ ok: false });
    await deliver(payload("#ошибка @member исправь вход", -10012345, 99, { from: { id: 123, is_bot: true } }));
    const botMessage = await db("telegram_bot_messages").where({ message_id: "99" }).first();
    expect(await service.call("project.telegram_bot_message_create_task", input(botMessage.id), owner)).toMatchObject({ ok: false });
    await db("project_telegram_chats").del();
    expect(await service.call("project.telegram_bot_message_create_task", input(message.id), owner)).toMatchObject({ ok: false });
    expect(await db("tasks")).toHaveLength(0);
  });
  it("fences an old AI result when manual confirmation arrives during classification", async () => {
    await deliver(); const message = await db("telegram_bot_messages").first();
    httpFetch.mockImplementationOnce(async () => {
      await callOk("project.telegram_bot_message_create_task", input(message.id));
      return Response.json({ choices: [{ message: { content: '{"tasks":[]}' } }] });
    });
    await worker.tick();
    expect(httpFetch).toHaveBeenCalledOnce(); expect(await db("tasks")).toHaveLength(1);
    expect((await db("tasks").first()).title).toBe(input(message.id).title);
  });
  it.each(["valid", "invalid"])("fences an old %s AI result even when a retry has reused its attempt number", async (kind) => {
    await deliver(); const message = await db("telegram_bot_messages").first();
    httpFetch.mockImplementationOnce(async () => {
      await callOk("project.telegram_bot_message_create_task", input(message.id));
      await db("telegram_message_inbox").update({ status: "processing", attempts: 1 });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ tasks: [assignment(kind === "valid" ? "22" : "owner")] }) } }] });
    });
    await worker.tick(); expect(await db("tasks")).toHaveLength(0);
    expect((await db("telegram_message_inbox").first()).classification).toBeNull();
    await db("telegram_message_inbox").update({ status: "pending" }); await worker.tick();
    expect(await db("tasks"), JSON.stringify(await db("telegram_message_inbox").first())).toHaveLength(1);
    expect((await db("tasks").first()).title).toBe(input(message.id).title);
    expect(await db("task_assignees")).toHaveLength(2); expect(httpFetch).toHaveBeenCalledOnce();
  });
});

describe("Telegram media artifacts", () => {
  const document = { file_id: "bot-specific-file", file_unique_id: "stable-file", file_name: "report.pdf", mime_type: "application/pdf", file_size: 8 };
  const download = vi.fn().mockResolvedValue(Buffer.from("%PDFdemo"));
  const mediaWorker = () => new TelegramMediaWorker(db, undefined, download, (trx) => new TestService(trx));
  const fileMessage = (messageId = 100, extra: Row = {}) => payload("", -10012345, messageId, { text: undefined, entities: undefined,
    caption: "#ошибка @member исправь вход", caption_entities: [{ type: "hashtag", offset: 0, length: 7 }, { type: "mention", offset: 8, length: 7 }], document, ...extra });
  it("persists file refs before polling acknowledgement and stores real bytes as one task-linked artifact", async () => {
    download.mockClear(); const raw = fileMessage(); await deliver(raw);
    expect(await db("telegram_message_files").first()).toMatchObject({ file_id: document.file_id, file_unique_id: document.file_unique_id, status: "waiting" });
    await worker.tick(); const task = await db("tasks").first();
    expect(await db("telegram_message_files").first()).toMatchObject({ status: "pending", task_id: task.id });
    await mediaWorker().tick();
    const artifact = await db("artifacts").first();
    expect(artifact).toMatchObject({ content_type: "application/pdf", size_bytes: 8, title: "report.pdf" });
    expect(readFileSync(join(artifactDir, artifact.storage_path))).toEqual(Buffer.from("%PDFdemo"));
    expect(await db("links").where({ relation: "attached_to", from_id: artifact.id, to_id: task.id })).toHaveLength(1);
    expect(await db("telegram_message_files").first()).toMatchObject({ status: "done", artifact_id: artifact.id });
    await deliver(raw); await deliver(fileMessage()); await worker.tick(); await mediaWorker().tick();
    expect(download).toHaveBeenCalledOnce(); expect(await db("tasks")).toHaveLength(1); expect(await db("artifacts")).toHaveLength(1);
  });
  it("collects an entire album and files replying to the original task, without extra tasks", async () => {
    download.mockClear(); await deliver(fileMessage(101, { media_group_id: "album-1" }));
    await deliver(payload("", -10012345, 102, { text: undefined, media_group_id: "album-1", photo: [{ file_id: "low", file_unique_id: "low", width: 10, height: 10 }, { file_id: "high", file_unique_id: "photo-id", width: 100, height: 100 }] }));
    // A second tagged caption in the same album resolves to the first task source.
    await deliver(fileMessage(103, { media_group_id: "album-1", document: { ...document, file_id: "second", file_unique_id: "second-id" } }));
    await worker.tick();
    expect(await db("tasks")).toHaveLength(1); expect(await db("telegram_message_files").where({ status: "pending" })).toHaveLength(3);
    await deliver(payload("", -10012345, 104, { text: undefined, document: { ...document, file_id: "reply-file", file_unique_id: "reply-id" }, reply_to_message: { message_id: 101 } }));
    await mediaWorker().tick(); await mediaWorker().tick();
    expect(await db("artifacts")).toHaveLength(4); expect(await db("tasks")).toHaveLength(1);
    expect(download.mock.calls.some((c) => c[1] === "high")).toBe(true); expect(download.mock.calls.some((c) => c[1] === "low")).toBe(false);
  });
  it.each(["todo", "done", "cancelled"].flatMap((status) => ["request", "bot reply"].map((target) => ({ status, target }))))(
    "classifies a tagged photo replying to a $status task's $target as separate work", async ({ status, target }) => {
      await deliver(); await worker.tick();
      const original = await db("tasks").first();
      await db("tasks").where({ id: original.id }).update({ status });
      await sendRememberedTelegramReply(db, botId, "-10012345", { blocks: [{ type: "paragraph", text: "Task status" }] }, async () => ({ message_id: 200 }), original.id);
      httpFetch.mockClear(); download.mockClear();
      const extra = { document: undefined, photo: [{ file_id: "bug-photo", file_unique_id: "bug-photo-id", width: 800, height: 600 }],
        reply_to_message: { message_id: target === "request" ? 10 : 200 } };
      expect(await deliver(fileMessage(201, extra))).toMatchObject({ status: "queued", matchedTags: ["ошибка"] });
      expect(await db("telegram_message_files").first()).toMatchObject({ status: "waiting", task_id: null, reply_to_message_id: String(extra.reply_to_message.message_id) });
      await worker.tick(); await mediaWorker().tick();
      expect(httpFetch).toHaveBeenCalledOnce();
      const source = await db("telegram_task_sources").where({ message_id: "201" }).first();
      expect(source.task_id).not.toBe(original.id);
      expect(await db("tasks")).toHaveLength(2);
      expect(await db("tasks").where({ id: original.id }).first()).toMatchObject({ status });
      const file = await db("telegram_message_files").first();
      expect(file).toMatchObject({ task_id: source.task_id, status: "done" });
      expect(await db("links").where({ from_id: file.artifact_id, to_id: source.task_id, relation: "attached_to" })).toHaveLength(1);
      expect(await db("links").where({ from_id: file.artifact_id, to_id: original.id })).toHaveLength(0);
      const journal = await db("telegram_bot_messages").where({ message_id: "201" }).first();
      expect(await callOk("project.telegram_bot_message", { project: "test", id: botId, messageId: journal.id }))
        .toMatchObject({ reason: "task_created", classification: { tasks: [expect.any(Object)] }, tasks: [{ id: source.task_id }] });
      await deliver(fileMessage(201, extra)); await worker.tick(); await mediaWorker().tick();
      expect(httpFetch).toHaveBeenCalledOnce(); expect(download).toHaveBeenCalledOnce();
      expect(await db("tasks")).toHaveLength(2); expect(await db("artifacts")).toHaveLength(1);
    });
  it("keeps a pending parent worker from taking files belonging to a tagged reply or its album", async () => {
    await deliver();
    await deliver(fileMessage(201, { media_group_id: "new-bug", reply_to_message: { message_id: 10 } }));
    await deliver(fileMessage(202, { caption: undefined, caption_entities: undefined, media_group_id: "new-bug", reply_to_message: { message_id: 10 } }));
    await deliver(fileMessage(203, { caption: "Additional screenshot", caption_entities: [], reply_to_message: { message_id: 10 } }));
    await worker.tick();
    const parent = await db("telegram_task_sources").where({ message_id: "10" }).first();
    const child = await db("telegram_task_sources").where({ message_id: "201" }).first();
    expect(child.task_id).not.toBe(parent.task_id);
    expect(await db("tasks")).toHaveLength(2);
    for (const messageId of ["201", "202"]) expect(await db("telegram_message_files").where({ message_id: messageId }).first())
      .toMatchObject({ task_id: child.task_id, status: "pending" });
    expect(await db("telegram_message_files").where({ message_id: "203" }).first()).toMatchObject({ task_id: parent.task_id, status: "pending" });
  });
  it.each([false, true])("keeps the new reply album together when classified before the remaining files: %s", async (classifyFirst) => {
    await deliver(); await worker.tick(); const original = await db("tasks").first();
    await db("tasks").where({ id: original.id }).update({ status: "done" });
    httpFetch.mockClear();
    await deliver(fileMessage(201, { media_group_id: "new-bug", reply_to_message: { message_id: 10 } }));
    if (classifyFirst) await worker.tick();
    await deliver(fileMessage(202, { caption: undefined, caption_entities: undefined, media_group_id: "new-bug", reply_to_message: { message_id: 10 } }));
    await deliver(fileMessage(203, { media_group_id: "new-bug", reply_to_message: { message_id: 10 } }));
    await worker.tick(); await mediaWorker().tick();
    const child = await db("telegram_task_sources").where({ message_id: "201" }).first();
    expect(child.task_id).not.toBe(original.id);
    expect(await db("tasks")).toHaveLength(2); expect(httpFetch).toHaveBeenCalledOnce();
    expect(await db("telegram_message_files")).toHaveLength(3);
    for (const file of await db("telegram_message_files")) expect(file).toMatchObject({ task_id: child.task_id, status: "done" });
  });
  it("leaves rejected tagged reply files available for manual confirmation instead of attaching them to the parent", async () => {
    await deliver(); await worker.tick();
    reply([]);
    await deliver(fileMessage(201, { reply_to_message: { message_id: 10 } })); await worker.tick();
    expect(await db("tasks")).toHaveLength(1);
    expect(await db("telegram_message_files").first()).toMatchObject({ task_id: null, status: "waiting" });
    const journal = await db("telegram_bot_messages").where({ message_id: "201" }).first();
    expect(await callOk("project.telegram_bot_message", { project: "test", id: botId, messageId: journal.id })).toMatchObject({ canCreateTask: true, reason: "not_task", tasks: [] });
  });
  it("recovers a historical swallowed reply through the retry button API without losing bytes or duplicating its task", async () => {
    await deliver(); await worker.tick();
    const original = await db("tasks").first();
    await db("tasks").where({ id: original.id }).update({ status: "done" });
    // Emulate an old release: the caption was tagged, but its file was
    // already imported into the closed parent's task before AI admission.
    await deliver(fileMessage(201, { caption: "Additional screenshot", caption_entities: [], reply_to_message: { message_id: 10 } }));
    await mediaWorker().tick();
    const file = await db("telegram_message_files").first();
    const artifact = await db("artifacts").first();
    const originalBytes = readFileSync(join(artifactDir, artifact.storage_path));
    const journal = await db("telegram_bot_messages").where({ message_id: "201" }).first();
    await db("telegram_bot_messages").where({ id: journal.id }).update({ text: "#ошибка @member исправь вход со скриншота" });
    const args = { project: "test", id: botId, messageId: journal.id };
    expect(await callOk("project.telegram_bot_message", args)).toMatchObject({ canCreateTask: false, canRetry: true, tasks: [{ id: original.id }] });
    expect(await service.call("project.telegram_bot_message_retry", args, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    const result = await graphql({ schema: gatewaySchema, contextValue: { service, requestContext: owner }, variableValues: args,
      source: `mutation($project:String!,$id:ID!,$messageId:ID!){retryTelegramBotMessage(project:$project,id:$id,messageId:$messageId){queued taskId}}` });
    expect(result.errors).toBeUndefined(); expect(result.data).toMatchObject({ retryTelegramBotMessage: { queued: true, taskId: null } });
    expect(await callOk("project.telegram_bot_message_retry", args)).toMatchObject({ queued: true });
    expect(await db("telegram_message_inbox").where({ message_id: "201" })).toHaveLength(1);
    expect(await db("events").where({ type: "telegram.message_retry_requested", related_id: journal.id })).toHaveLength(1);
    expect(await db("telegram_message_files").where({ id: file.id }).first()).toMatchObject({ task_id: null, status: "waiting", artifact_id: artifact.id });
    expect(await db("links").where({ from_id: artifact.id, to_id: original.id, relation: "attached_to" })).toHaveLength(0);
    expect(await callOk("project.telegram_bot_message", args)).toMatchObject({ status: "queued", canRetry: false, tasks: [] });
    httpFetch.mockClear(); await worker.tick(); await mediaWorker().tick();
    expect(httpFetch).toHaveBeenCalledOnce();
    const source = await db("telegram_task_sources").where({ message_id: "201" }).first();
    expect(source.task_id).not.toBe(original.id);
    expect(await db("tasks").where({ id: original.id }).first()).toMatchObject({ status: "done" });
    expect(await db("telegram_message_files").where({ id: file.id }).first()).toMatchObject({ task_id: source.task_id, status: "done", artifact_id: artifact.id });
    expect(await db("artifacts")).toHaveLength(1);
    expect(readFileSync(join(artifactDir, artifact.storage_path))).toEqual(originalBytes);
    expect(await db("links").where({ from_id: artifact.id, to_id: source.task_id, relation: "attached_to" })).toHaveLength(1);
    expect(await callOk("project.telegram_bot_message_retry", args)).toMatchObject({ queued: false, taskId: source.task_id });
    await worker.tick(); expect(await db("tasks")).toHaveLength(2); expect(httpFetch).toHaveBeenCalledOnce();
    await db("tasks").where({ id: source.task_id }).del();
    expect(await service.call("project.telegram_bot_message_retry", args, owner)).toMatchObject({ ok: false });
  });
  it("reclassifies one rejected inbox message, clears the saved AI result and remains idempotent while queued", async () => {
    reply([]); await deliver(fileMessage()); await worker.tick();
    const journal = await db("telegram_bot_messages").first();
    const args = { project: "test", id: botId, messageId: journal.id };
    const read = await graphql({ schema: gatewaySchema, contextValue: { service, requestContext: owner }, variableValues: args,
      source: `query($project:String!,$id:ID!,$messageId:ID!){projectTelegramBotMessage(project:$project,id:$id,messageId:$messageId){canRetry canCreateTask}}` });
    expect(read.errors).toBeUndefined(); expect(read.data).toMatchObject({ projectTelegramBotMessage: { canRetry: true, canCreateTask: true } });
    await callOk("project.telegram_bot_message_retry", args);
    const queued = await db("telegram_message_inbox").where({ id: journal.inbox_id }).first();
    expect(queued).toMatchObject({ status: "pending", classification: null, classified_at: null, processed_at: null });
    await callOk("project.telegram_bot_message_retry", args);
    expect((await db("telegram_message_inbox").where({ id: journal.inbox_id }).first()).attempts).toBe(queued.attempts);
    reply([assignment()]); httpFetch.mockClear(); await worker.tick();
    expect(httpFetch).toHaveBeenCalledOnce(); expect(await db("tasks")).toHaveLength(1);
  });
  it("never exposes or executes message retries for bot, private, unbound or untagged messages", async () => {
    await deliver(fileMessage(101, { from: { id: 123, is_bot: true } }));
    await deliver(fileMessage(102, { chat: { id: 22, type: "private" } }));
    await deliver(fileMessage(103, { chat: { id: -999, type: "supergroup" } }));
    await deliver(fileMessage(104, { caption: "ordinary chat", caption_entities: [] }));
    for (const journal of await db("telegram_bot_messages")) {
      const args = { project: "test", id: botId, messageId: journal.id };
      expect(await callOk("project.telegram_bot_message", args)).toMatchObject({ canRetry: false });
      expect(await service.call("project.telegram_bot_message_retry", args, owner)).toMatchObject({ ok: false });
    }
    expect(await db("telegram_message_inbox")).toHaveLength(0); expect(await db("tasks")).toHaveLength(0);
  });
  it("imports files after manual task confirmation and reports oversize without losing the task", async () => {
    reply([]); await deliver(fileMessage()); await worker.tick();
    expect(await db("telegram_message_files").first()).toMatchObject({ status: "waiting" });
    const message = await db("telegram_bot_messages").first();
    await callOk("project.telegram_bot_message_create_task", { project: "test", id: botId, messageId: message.id, assignees: ["member"] });
    await worker.tick();
    vi.stubEnv("ARTIFACT_MAX_BYTES", "4"); download.mockClear(); await mediaWorker().tick();
    expect(download).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(1);
    const file = await db("telegram_message_files").first();
    expect(file).toMatchObject({ status: "failed", last_error: "TELEGRAM_FILE_TOO_LARGE" });
    vi.stubEnv("ARTIFACT_MAX_BYTES", "100");
    expect(await service.call("project.telegram_file_retry", { project: "test", id: botId, fileId: file.id }, member)).toMatchObject({ ok: false });
    await callOk("project.telegram_file_retry", { project: "test", id: botId, fileId: file.id }); await mediaWorker().tick();
    expect(await db("artifacts")).toHaveLength(1); expect((await db("telegram_message_files").first()).status).toBe("done");
  });
  it("isolates download failures and does not download private/unbound/bot media", async () => {
    download.mockClear();
    await deliver(fileMessage(101, { chat: { id: -999, type: "supergroup" } }));
    await deliver(fileMessage(102, { chat: { id: 22, type: "private" } }));
    await deliver(fileMessage(103, { from: { id: 123, is_bot: true } }));
    expect(await db("telegram_message_files")).toHaveLength(0);
    await deliver(fileMessage()); await worker.tick();
    download.mockRejectedValueOnce(new Error("network /botSECRET/file"));
    await mediaWorker().tick();
    expect((await db("telegram_message_files").first()).last_error).toBe("TELEGRAM_FILE_PROCESSING_FAILED");
    expect(await db("tasks")).toHaveLength(1);
    await db("telegram_message_files").update({ available_at: "2000-01-01" }); await mediaWorker().tick();
    expect(await db("artifacts")).toHaveLength(1);
  });
  it("attaches a file replying to Marrow's bot confirmation and defers while that bot is disabled", async () => {
    await deliver(); await worker.tick();
    const task = await db("tasks").first();
    // The real Bot API returns an ID; the general fake confirmation returns {}.
    await sendRememberedTelegramReply(db, botId, "-10012345", { blocks: [{ type: "paragraph", text: "Task created" }] }, async () => ({ message_id: 200 }), task.id);
    expect(await deliver(fileMessage(201, { caption: "Additional attachment", caption_entities: [], reply_to_message: { message_id: 200, from: { id: 123456789, is_bot: true } } }))).toMatchObject({ reason: "attachment_added" });
    await worker.tick(); expect(await db("tasks")).toHaveLength(1);
    expect(await db("telegram_message_files").first()).toMatchObject({ task_id: task.id, status: "pending" });
    await db("project_telegram_bots").update({ enabled: false }); download.mockClear();
    await mediaWorker().tick(); expect(download).not.toHaveBeenCalled();
    await db("project_telegram_bots").update({ enabled: true }); await db("telegram_message_files").update({ available_at: "2000-01-01" });
    await mediaWorker().tick(); expect(await db("artifacts")).toHaveLength(1); expect(await db("tasks")).toHaveLength(1);
  });
});

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
    for (const name of ["project.telegram_bots", "project.telegram_bot_messages", "project.telegram_bot_message", "project.telegram_bot_add", "project.telegram_bot_set_tags", "project.telegram_bot_link_code", "project.telegram_bot_disconnect", "project.telegram_bot_unlink_chat", "project.telegram_bot_retry", "project.telegram_bot_remove"]) {
      expect(await service.call(name, { project: "test", id: botId, messageId: randomUUID(), token, tags: ["ошибка"], chatId: "-10012345" }, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
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
  it("counts every received message but only accepted/completed pipeline entries, with inspectable results", async () => {
    await deliver(payload("hello", 22, 1, { chat: { id: 22, type: "private" } }));
    await deliver(payload("#ошибка @member исправь вход", -100999, 2));
    await deliver(payload("@member исправь вход", -10012345, 3));
    const accepted = payload(undefined, -10012345, 4); await deliver(accepted); await deliver(accepted);
    let bot = await db("project_telegram_bots").first();
    expect(bot).toMatchObject({ received_count: 4, matched_count: 1, processed_count: 0 });
    expect(bot.last_received_at).toBeTruthy(); expect(bot.last_matched_at).toBeTruthy();
    await worker.tick(); bot = await db("project_telegram_bots").first();
    expect(bot).toMatchObject({ received_count: 4, matched_count: 1, processed_count: 1 }); expect(bot.last_processed_at).toBeTruthy();
    const page = await callOk("project.telegram_bot_messages", { project: "test", id: botId });
    expect(page.total).toBe(4);
    const messages = page.messages as Row[];
    expect(messages.map((m) => m.reason).sort()).toEqual(["no_matching_tag", "private_chat", "task_created", "unbound_chat"]);
    const done = messages.find((m) => m.status === "done")!;
    const detail = await callOk("project.telegram_bot_message", { project: "test", id: botId, messageId: done.id });
    expect(detail).toMatchObject({ text: "#ошибка @member исправь вход", matchedTags: ["ошибка"], mentions: ["@member"], classification: { tasks: [{ telegramUserId: "22" }] } });
    expect(detail.classifiedAt).toBeTruthy(); expect(detail.processedAt).toBeTruthy(); expect(detail.tasks).toHaveLength(1);
    const graphqlResult = await graphql({ schema: gatewaySchema, contextValue: { service, requestContext: owner },
      variableValues: { id: botId, messageId: done.id }, source: `query($id: ID!, $messageId: ID!) {
        projectTelegramBots(project:"test") { bots { receivedCount matchedCount processedCount lastReceivedAt lastMatchedAt lastProcessedAt } }
        projectTelegramBotMessages(project:"test", id:$id, limit:1) { total messages { id status reason receivedAt excerpt } }
        projectTelegramBotMessage(project:"test", id:$id, messageId:$messageId) { text matchedTags mentions classification tasks { id title status } }
      }` });
    expect(graphqlResult.errors).toBeUndefined();
    expect(graphqlResult.data).toMatchObject({ projectTelegramBots: { bots: [{ receivedCount: 4, matchedCount: 1, processedCount: 1 }] },
      projectTelegramBotMessages: { total: 4 }, projectTelegramBotMessage: { text: "#ошибка @member исправь вход" } });
    const one = await callOk("project.telegram_bot_messages", { project: "test", id: botId, limit: 1, offset: 1 });
    expect(one.messages).toHaveLength(1); expect(one.total).toBe(4);
    await worker.tick(); expect((await db("project_telegram_bots").first()).processed_count).toBe(1);
  });

  it("redacts binding keys and scopes message details to the correct bot/project", async () => {
    const key = await callOk("project.telegram_bot_link_code", { project: "test", id: botId });
    await deliver(payload(String(key.command)));
    const page = await callOk("project.telegram_bot_messages", { project: "test", id: botId });
    const row = (page.messages as Row[])[0];
    const detail = await callOk("project.telegram_bot_message", { project: "test", id: botId, messageId: row.id });
    expect(detail.status).toBe("bound"); expect(String(detail.text)).toContain("[ключ скрыт]");
    expect(JSON.stringify(detail)).not.toContain(String(key.command).split(" ")[1]);
    expect(await service.call("project.telegram_bot_message", { project: "other", id: botId, messageId: row.id }, { ...owner, sessionRole: "admin" })).toMatchObject({ ok: false });
    const otherId = randomUUID(), bot = await db("project_telegram_bots").first();
    await db("project_telegram_bots").insert({ ...bot, id: otherId, telegram_bot_id: "9999999" });
    expect(await service.call("project.telegram_bot_message", { project: "test", id: otherId, messageId: row.id }, owner)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("keeps only the latest 500 message bodies while retaining lifetime counters", async () => {
    await db("telegram_bot_messages").insert(Array.from({ length: 500 }, (_, i) => ({ id: randomUUID(), bot_id: botId, telegram_update_id: i + 1,
      chat_type: "private", message_kind: "text", text: "old", status: "ignored", reason: "private_chat", matched_tags: "[]", mentions: "[]", received_at: "2000-01-01" })));
    await db("project_telegram_bots").update({ received_count: 500, poll_offset: 501 });
    await deliver(Buffer.from('{"update_id":501,"message":{"message_id":7,"chat":{"id":22,"type":"private"},"text":"new"}}'));
    expect(await db("telegram_bot_messages")).toHaveLength(500);
    expect(await db("telegram_bot_messages").where({ telegram_update_id: 1 }).first()).toBeUndefined();
    expect((await db("project_telegram_bots").first()).received_count).toBe(501);
  });

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

  it("skips unbound chats, messages without mentions and private chats before any AI request", async () => {
    for (const raw of [payload(undefined, -100999), payload("hello"), payload(undefined, 22, 10, { chat: { id: 22, type: "private" } })]) {
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
    expect((await db("tasks")).map((t) => t.assignee_user_id).sort()).toEqual(["owner"]);
    expect((await db("task_assignees")).map((a) => a.user_id).sort()).toEqual(["member", "owner"]);
    expect(await db("telegram_task_sources")).toHaveLength(1);
    expect(remote.sendRichMessage).toHaveBeenCalledOnce();
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
    await deliver(); await worker.tick(); expect(await db("tasks")).toHaveLength(1);
    expect((await db("tasks").first()).assignee_user_id).toBe("owner");
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

describe("chat recipient mappings and task replies", () => {
  const chatInput = () => ({ project: "test", id: botId, chatId: "-10012345" });
  const map = (mentionKey: string, userId: string | null) => callOk("project.telegram_chat_set_mention", { ...chatInput(), mentionKey, userId });

  it("discovers unlinked mentions before tags, maps and clears without globally linking Telegram", async () => {
    await db("telegram_identities").where({ user_id: "member" }).del();
    await deliver(payload("@new_person привет", -10012345, 20));
    const read = () => callOk("project.telegram_chat_mentions", chatInput());
    expect(await read()).toMatchObject({ mentions: [{ key: "username:new_person", userId: null, effectiveUserId: "owner", resolution: "owner" }] });
    expect(httpFetch).not.toHaveBeenCalled();
    await map("username:new_person", "member"); await deliver(payload("@new_person еще привет", -10012345, 21));
    expect(await read()).toMatchObject({ mentions: [{ userId: "member", effectiveUserId: "member", resolution: "manual" }] });
    reply([assignment("username:new_person")]);
    await deliver(payload("#ошибка @new_person исправь вход", -10012345, 22)); await worker.tick();
    expect((await db("tasks").first()).assignee_user_id).toBe("member");
    expect(await db("telegram_identities").where({ user_id: "member" })).toHaveLength(0);
    await map("username:new_person", null);
    expect(await read()).toMatchObject({ mentions: [{ userId: null, effectiveUserId: "owner", resolution: "owner" }] });
    expect(await db("tasks")).toHaveLength(1);
  });

  it("serves GraphQL and rejects unauthorized callers, inactive recipients, wrong projects, bots and chats", async () => {
    await deliver(payload("@new_person привет"));
    const input = { ...chatInput(), mentionKey: "username:new_person", userId: "member" };
    expect(await service.call("project.telegram_chat_set_mention", input, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(await service.call("project.telegram_chat_mentions", chatInput(), member)).toMatchObject({ ok: false });
    for (const userId of ["outsider", "pending", "disabled"]) expect(await service.call("project.telegram_chat_set_mention", { ...input, userId }, owner)).toMatchObject({ ok: false });
    expect(await service.call("project.telegram_chat_set_mention", { ...input, chatId: "-100999" }, owner)).toMatchObject({ ok: false });
    expect(await service.call("project.telegram_chat_set_mention", { ...input, project: "other" }, { ...owner, sessionRole: "admin" })).toMatchObject({ ok: false });
    const otherId = randomUUID();
    await db("project_telegram_bots").insert({ ...await db("project_telegram_bots").first(), id: otherId, telegram_bot_id: "2222222" });
    await db("project_telegram_chats").insert({ bot_id: otherId, chat_id: "-10012345", title: "Team", created_at: "2026-01-01" });
    expect(await service.call("project.telegram_chat_set_mention", { ...input, id: otherId }, owner)).toMatchObject({ ok: false });
    const contextValue = { service, requestContext: owner };
    const result = await graphql({ schema: gatewaySchema, contextValue, variableValues: { id: botId },
      source: `mutation($id:ID!){setProjectTelegramChatMention(project:"test", id:$id, chatId:"-10012345", mentionKey:"username:new_person", userId:"member")}` });
    expect(result.errors).toBeUndefined(); expect(result.data?.setProjectTelegramChatMention).toBe(true);
    const read = await graphql({ schema: gatewaySchema, contextValue, variableValues: { id: botId },
      source: `query($id:ID!){projectTelegramChatMentions(project:"test", id:$id, chatId:"-10012345"){ownerUserId members{id email} mentions{key label userId effectiveUserId resolution lastSeenAt}}}` });
    expect(read.errors).toBeUndefined(); expect(read.data).toMatchObject({ projectTelegramChatMentions: { mentions: [{ userId: "member", resolution: "manual" }] } });
  });

  it("isolates group mappings, falls back for unresolved recipients and keeps several performers on one task", async () => {
    await deliver(payload("@new_person привет")); await map("username:new_person", "member");
    await db("project_telegram_chats").insert({ bot_id: botId, chat_id: "-100999", title: "Other", created_at: "2026-01-01" });
    reply([assignment("username:new_person")]);
    await deliver(payload("#ошибка @new_person исправь вход", -100999, 20)); await worker.tick();
    expect((await db("tasks").first()).assignee_user_id).toBe("owner");
    reply([assignment(), assignment("11")]);
    await deliver(payload("#ошибка @member @owner исправь вход", -10012345, 21)); await worker.tick();
    expect(await db("tasks")).toHaveLength(2);
    const assigned = await db("task_assignees").orderBy("task_id").orderBy("position");
    expect(assigned.map((r) => r.user_id).sort()).toEqual(["member", "owner", "owner"]);
  });

  it("rechecks mappings after AI and removes them with the chat", async () => {
    await deliver(payload("@new_person привет")); await map("username:new_person", "member");
    httpFetch.mockImplementation(async () => {
      await map("username:new_person", "owner");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ tasks: [assignment("username:new_person")] }) } }] });
    });
    await deliver(payload("#ошибка @new_person исправь вход", -10012345, 22)); await worker.tick();
    expect((await db("tasks").first()).assignee_user_id).toBe("owner");
    await callOk("project.telegram_bot_unlink_chat", chatInput()); expect(await db("telegram_chat_mentions")).toHaveLength(0);
  });

  it("replies with actual assignee, URL and forum topic only after commit and only once", async () => {
    remote.sendRichMessage.mockImplementation(async () => {
      expect(await db("tasks")).toHaveLength(1); expect((await db("telegram_message_inbox").first()).status).toBe("done"); return {};
    });
    const raw = payload(undefined, -10012345, 40, { message_thread_id: 7 }); await deliver(raw); await worker.tick();
    const task = await db("tasks").first();
    expect(remote.sendRichMessage).toHaveBeenCalledWith("-10012345", { blocks: [
      { type: "heading", size: 3, text: "✅ Задача создана" },
      { type: "paragraph", text: `${task.id}: Исправить вход` },
      { type: "paragraph", text: ["Исполнитель: ", [{ type: "mention", username: "member", text: "@member" }]] },
      { type: "paragraph", text: { type: "url", text: "Открыть задачу в Marrow →", url: `https://marrow.example.test/projects/test/tasks/${task.id}` } }
    ] }, { reply_parameters: { message_id: 40, allow_sending_without_reply: true }, message_thread_id: 7 }, expect.anything());
    await deliver(raw); await worker.tick(); expect(remote.sendRichMessage).toHaveBeenCalledOnce();
  });

  it("contains send errors without retrying committed tasks or leaking credentials", async () => {
    remote.sendRichMessage.mockRejectedValue(new Error(`request failed /bot${token}/sendRichMessage`));
    const warn = vi.fn();
    const isolated = new TelegramMessageWorker(db, { warn } as unknown as import("../src/shared/logging/logger.js").AppLogger, httpFetch, (trx) => new TestService(trx));
    await deliver(); await isolated.tick(); await isolated.stop();
    expect(await db("tasks")).toHaveLength(1); expect((await db("telegram_message_inbox").first()).status).toBe("done");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token); expect(warn).toHaveBeenCalled();
    await worker.tick(); expect(remote.sendRichMessage).toHaveBeenCalledOnce();
  });

  it("does not reply for conversation or rolled-back tasks", async () => {
    reply([]); await deliver(); await worker.tick(); expect(remote.sendRichMessage).not.toHaveBeenCalled();
    reply([assignment()]); rollback = true; await deliver(payload(undefined, -10012345, 99)); await worker.tick();
    expect(await db("tasks")).toHaveLength(0); expect(remote.sendRichMessage).not.toHaveBeenCalled();
  });
});


describe("Telegram owner fallback without mentions", () => {
  it("reads the owner's changed model for each new call and passes matched configured tags for short bug reports", async () => {
    const text = "#бэк #ошибка\nпри попытке сохранить вопрос";
    reply([assignment("owner", { title: "Разобраться с ошибкой при сохранении вопроса", description: "Исследовать сбой сохранения вопроса; детали ошибки не указаны.", evidence: text })]);
    await db("ai_provider_credentials").update({ model: "deepseek-flash" });
    await deliver(payload(text, -10012345, 96)); await worker.tick();
    const request = JSON.parse(String(httpFetch.mock.calls[0][1]?.body));
    expect(request.model).toBe("deepseek-flash");
    expect(JSON.parse(request.messages[1].content)).toMatchObject({ matchedConfiguredTags: ["ошибка"], message: text });
    expect((await db("tasks").first()).title).toBe("Разобраться с ошибкой при сохранении вопроса");
    await db("ai_provider_credentials").update({ model: "owners-next-model" });
    await deliver(payload(text, -10012345, 97)); await worker.tick();
    expect(JSON.parse(String(httpFetch.mock.calls[1][1]?.body)).model).toBe("owners-next-model");
  });
  it("classifies a tagged actionable message with no named recipient and assigns the owner", async () => {
    reply([assignment("owner")]);
    await deliver(payload("#ошибка исправь вход")); await worker.tick();
    expect(httpFetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(httpFetch.mock.calls[0][1]?.body)).messages[1].content).toContain('"telegramUserId":"owner"');
    expect(await db("tasks")).toHaveLength(1);
    expect((await db("task_assignees")).map((a) => a.user_id)).toEqual(["owner"]);
    expect(remote.sendRichMessage).toHaveBeenCalledOnce();
  });
  it("still skips conversation with a matching tag and no assignee", async () => {
    reply([]); await deliver(payload("#ошибка уже исправлена")); await worker.tick();
    expect(httpFetch).toHaveBeenCalledOnce(); expect(await db("tasks")).toHaveLength(0);
  });
  it("only assigns actual performers, excluding a known observer", async () => {
    reply([assignment()]); await deliver(payload("#ошибка @member исправь вход; @owner к сведению")); await worker.tick();
    expect((await db("task_assignees")).map((a) => a.user_id)).toEqual(["member"]);
  });
});

describe("Telegram recipient tag routing", () => {
  it("observes a media sender, uses their mapping for @mentions and routes a tag without mentions", async () => {
    await deliver(payload("", -10012345, 80, { text: undefined, photo: [{}], from: { id: 77, is_bot: false, username: "new_dev", first_name: "New", last_name: "Developer" } }));
    const read = await callOk("project.telegram_chat_mentions", { project: "test", id: botId, chatId: "-10012345" });
    expect(read).toMatchObject({ availableTags: ["ошибка", "проверка"], mentions: [{ key: "77", label: "New Developer (@new_dev)", sourceType: "sender" }] });
    await callOk("project.telegram_chat_set_mention", { project: "test", id: botId, chatId: "-10012345", mentionKey: "77", userId: "member", tags: ["#ОШИБКА"] });
    reply([assignment("tag:member")]); await deliver(payload("#ошибка исправь вход", -10012345, 81)); await worker.tick();
    expect((await db("task_assignees")).map((a) => a.user_id)).toEqual(["member"]);
    const cleared = await graphql({ schema: gatewaySchema, contextValue: { service, requestContext: owner }, variableValues: { id: botId },
      source: `mutation($id:ID!){setProjectTelegramChatMention(project:"test",id:$id,chatId:"-10012345",mentionKey:"77",tags:[])}` });
    expect(cleared.errors).toBeUndefined();
    expect((await db("telegram_chat_mentions").where({ mention_key: "77" }).first()).user_id).toBe("member");
    reply([assignment("username:new_dev")]); await deliver(payload("#проверка @new_dev исправь вход", -10012345, 82)); await worker.tick();
    expect(await db("tasks")).toHaveLength(2);
    expect((await db("task_assignees")).map((a) => a.user_id)).toEqual(["member", "member"]);
  });

  it("routes a shared tag to every mapped performer in ONE task and rejects invalid tag configuration", async () => {
    await deliver(payload("@member @owner привет", -10012345, 80));
    const base = { project: "test", id: botId, chatId: "-10012345" };
    expect(await service.call("project.telegram_chat_set_mention", { ...base, mentionKey: "username:member", tags: ["ошибка"] }, owner)).toMatchObject({ ok: false });
    expect(await service.call("project.telegram_chat_set_mention", { ...base, mentionKey: "username:member", userId: "member", tags: ["unknown"] }, owner)).toMatchObject({ ok: false });
    for (const userId of ["member", "owner"]) await callOk("project.telegram_chat_set_mention", { ...base, mentionKey: `username:${userId}`, userId, tags: ["ошибка"] });
    reply([assignment("tag:member")]); await deliver(payload("#ошибка исправь вход", -10012345, 81)); await worker.tick();
    expect(await db("tasks")).toHaveLength(1);
    expect((await db("task_assignees")).map((a) => a.user_id).sort()).toEqual(["member", "owner"]);
    const sent = JSON.stringify(remote.sendRichMessage.mock.calls); expect(sent).toContain("Исполнители:"); expect(sent).toContain("@member"); expect(sent).toContain("@owner"); expect(sent).not.toContain("@test");
    await callOk("project.telegram_chat_set_mention", { ...base, mentionKey: "username:member", userId: null });
    expect(JSON.parse((await db("telegram_chat_mentions").where({ mention_key: "username:member" }).first()).assignment_tags)).toEqual([]);
  });

  it("rechecks tag routes after AI and ignores routes for removed bot tags", async () => {
    await deliver(payload("@member привет", -10012345, 80));
    const base = { project: "test", id: botId, chatId: "-10012345", mentionKey: "username:member" };
    await callOk("project.telegram_chat_set_mention", { ...base, userId: "member", tags: ["ошибка"] });
    httpFetch.mockImplementation(async () => {
      await callOk("project.telegram_chat_set_mention", { ...base, userId: "owner" });
      return Response.json({ choices: [{ message: { content: JSON.stringify({ tasks: [assignment("tag:member")] }) } }] });
    });
    await deliver(payload("#ошибка исправь вход", -10012345, 81)); await worker.tick();
    expect((await db("task_assignees")).map((a) => a.user_id)).toEqual(["owner"]);
    await callOk("project.telegram_bot_set_tags", { project: "test", id: botId, tags: ["проверка"] });
    reply([assignment("owner")]); await deliver(payload("#проверка #ошибка исправь вход", -10012345, 82)); await worker.tick();
    expect(await db("tasks")).toHaveLength(2);
  });
});

describe("unified recipients and Telegram /hash", () => {
  const base = () => ({ project: "test", id: botId, chatId: "-10012345" });
  async function observeDuplicate() {
    await deliver(payload("@duplicate привет", -10012345, 80, { from: { id: 77, username: "duplicate", first_name: "A person", is_bot: false } }));
    await db("telegram_chat_mentions").where({ mention_key: "username:duplicate" }).update({ user_id: "member", assignment_tags: '["ошибка"]' });
  }
  it("shows one row, preserves legacy mapping/tags, clears all aliases and never resurrects hidden routes", async () => {
    await observeDuplicate();
    const read = () => callOk("project.telegram_chat_mentions", base());
    expect((await read()).mentions).toMatchObject([{ key: "77", userId: "member", tags: ["ошибка"] }]);
    expect((await read()).mentions).toHaveLength(1);
    await callOk("project.telegram_chat_set_mention", { ...base(), mentionKey: "77", tags: [] });
    expect((await db("telegram_chat_mentions")).every((r) => JSON.parse(r.assignment_tags).length === 0 && r.user_id === "member")).toBe(true);
    await callOk("project.telegram_chat_set_mention", { ...base(), mentionKey: "username:duplicate", tags: ["проверка"] });
    await callOk("project.telegram_chat_set_mention", { ...base(), mentionKey: "77", userId: null });
    expect((await db("telegram_chat_mentions")).every((r) => r.user_id === null && JSON.parse(r.assignment_tags).length === 0)).toBe(true);
    await deliver(payload("@duplicate снова привет", -10012345, 81));
    expect((await read()).mentions).toHaveLength(1); expect((await read()).mentions).toMatchObject([{ userId: null, tags: [] }]);
  });
  it("resolves conflicting legacy mappings with one edit of the unified person", async () => {
    await observeDuplicate(); await db("telegram_chat_mentions").where({ mention_key: "77" }).update({ user_id: "owner" });
    expect((await callOk("project.telegram_chat_mentions", base())).mentions).toMatchObject([{ mappingConflict: true, userId: null, effectiveUserId: "owner" }]);
    await callOk("project.telegram_chat_set_mention", { ...base(), mentionKey: "77", userId: "member" });
    expect((await callOk("project.telegram_chat_mentions", base())).mentions).toMatchObject([{ mappingConflict: false, userId: "member", tags: ["ошибка"] }]);
    expect((await db("telegram_chat_mentions")).every((r) => r.user_id === "member")).toBe(true);
  });
  it("handles /hash only in the bound group, lists configured routes and bypasses AI", async () => {
    await observeDuplicate();
    const raw = payload("/hash@project_bot", -10012345, 90, { message_thread_id: 7 });
    const result = await deliver(raw);
    expect(result).toMatchObject({ status: "command", reason: "hash_command", hashReply: { projectTitle: "Test", chatId: "-10012345", messageId: 90, messageThreadId: 7,
      lines: [["#ошибка → ", [{ type: "mention", username: "duplicate", text: "@duplicate" }]], "#проверка → по упоминаниям; иначе владелец проекта"] } });
    expect(await deliver(raw)).toMatchObject({ duplicate: true });
    expect(await deliver(payload("/hash@project_bot", -10012345, 90))).toMatchObject({ duplicate: true });
    expect(await deliver(payload("/hash@other_bot", -10012345, 91))).toMatchObject({ reason: "command_other_bot" });
    expect(await deliver(payload("/hash", -100999, 92))).toMatchObject({ reason: "unbound_chat" });
    expect(await deliver(payload("/hash", 22, 93, { chat: { id: 22, type: "private" } }))).toMatchObject({ reason: "private_chat" });
    await worker.tick(); expect(httpFetch).not.toHaveBeenCalled(); expect(await db("tasks")).toHaveLength(0);
  });
});


describe("Telegram task offers through the Telly pipe", () => {
  function enable() {
    vi.stubEnv("TELLYMCP_INBOX_MCP_URL", "https://telly.invalid/mcp"); vi.stubEnv("TELLYMCP_INBOX_BEARER_TOKEN", "dedicated-test-credential");
  }
  it("atomically offers one shared task to every explicitly routed participant, including the owner", async () => {
    enable(); await deliver(payload("@member @owner привет", -10012345, 80));
    for (const userId of ["owner", "member"]) await callOk("project.telegram_chat_set_mention", { project: "test", id: botId, chatId: "-10012345", mentionKey: `username:${userId}`, userId, tags: ["ошибка"] });
    reply([assignment("tag:member")]); const raw = payload("#ошибка исправь вход", -10012345, 81);
    await deliver(raw); await worker.tick();
    const task = await db("tasks").first(); const offers = await db("integration_outbox").orderBy("recipient_user_id");
    expect(await db("tasks")).toHaveLength(1); expect(offers.map((o) => o.recipient_user_id)).toEqual(["member", "owner"]);
    expect(task.created_by).toBe(`integration:telegram:${botId}`);
    for (const offer of offers) {
      const data = JSON.parse(offer.payload);
      expect(offer).toMatchObject({ task_id: task.id, actor_user_id: "owner", delivery_status: "pending" });
      expect(data).toMatchObject({ recipient: { externalPrincipal: { namespace: "marrow", subject: offer.recipient_user_id } },
        resource: { kind: "task", id: task.id }, requiresAcceptance: true, route: { namespace: "marrow", key: "P-TEST", slug: "test" }, display: { sender: "Telegram @project_bot" } });
      expect(data.consoleText).not.toContain(task.title); expect(data.consoleText).toContain(task.id);
    }
    expect(new Set(offers.map((o) => o.source_event_id)).size).toBe(2);
    await deliver(raw); await deliver(payload("#ошибка исправь вход", -10012345, 81)); await worker.tick();
    expect(await db("integration_outbox")).toHaveLength(2); expect(await db("tasks")).toHaveLength(1);
  });
  it("does not forward owner fallback or conversation, but forwards a linked explicitly mentioned owner", async () => {
    enable(); reply([assignment("owner")]); await deliver(payload("#ошибка исправь вход", -10012345, 80)); await worker.tick();
    expect(await db("tasks")).toHaveLength(1); expect(await db("integration_outbox")).toHaveLength(0);
    reply([]); await deliver(payload("#ошибка @member привет", -10012345, 81)); await worker.tick();
    expect(await db("integration_outbox")).toHaveLength(0);
    reply([assignment("11")]); await deliver(payload("#ошибка @owner исправь вход", -10012345, 82)); await worker.tick();
    expect(await db("integration_outbox")).toHaveLength(1); expect((await db("integration_outbox").first()).recipient_user_id).toBe("owner");
  });
  it("rolls back task/source/events/offers on outbox failure and retries with the saved classification", async () => {
    enable();
    await db.raw("CREATE TRIGGER reject_telly_offer BEFORE INSERT ON integration_outbox BEGIN SELECT RAISE(ABORT, 'injected outbox failure'); END");
    await deliver(); await worker.tick();
    expect(await db("tasks")).toHaveLength(0); expect(await db("telegram_task_sources")).toHaveLength(0); expect(await db("events")).toHaveLength(0); expect(await db("integration_outbox")).toHaveLength(0);
    expect(notifyTelegram).not.toHaveBeenCalled(); expect(remote.sendRichMessage).not.toHaveBeenCalled();
    await db.raw("DROP TRIGGER reject_telly_offer"); await db("telegram_message_inbox").update({ available_at: "2000-01-01" }); await worker.tick();
    expect(await db("tasks")).toHaveLength(1); expect(await db("integration_outbox")).toHaveLength(1); expect(httpFetch).toHaveBeenCalledOnce();
  });
  it("does not enable ordinary self-assignment forwarding through spoofed integration metadata", async () => {
    enable();
    const result = await service.call("task.create", { project: "test", title: "Self assignment", assignee: "owner" }, { ...owner, metadata: { source: "telegram", kind: "integration" } });
    expect(result.ok).toBe(true); expect(await db("integration_outbox")).toHaveLength(0);
  });
});
