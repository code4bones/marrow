import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Api, GrammyError, HttpError, type ApiClientOptions } from "grammy";
import { HttpsProxyAgent } from "https-proxy-agent";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TelegramProjectPolling } from "../src/gateway/telegram-project-bots/polling.js";
import { encryptBotSecret, projectTelegramApi } from "../src/gateway/telegram-project-bots/remote.js";
import type { AppLogger } from "../src/shared/logging/logger.js";

const migration = createRequire(import.meta.url)("../migrations/pg/117_project_telegram_bots.cjs");
const token = `123456789:${"a".repeat(35)}`;
const botId = randomUUID();
let db: Knex;
let managers: TelegramProjectPolling[];
type GetUpdates = Api["getUpdates"];
function untilAborted(signal: Parameters<GetUpdates>[1]): ReturnType<GetUpdates> {
  return new Promise((_resolve, reject) => {
    if (!signal || signal.aborted) { reject(new Error("aborted")); return; }
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
}
function blockedClient() {
  return { getUpdates: vi.fn<GetUpdates>().mockImplementation((_other, signal) => untilAborted(signal)) };
}
function manager(client: Pick<Api, "getUpdates">, logger?: AppLogger) {
  const result = new TelegramProjectPolling(db, logger, () => client); managers.push(result); return result;
}
beforeEach(async () => {
  vi.stubEnv("TELEGRAM_BOT_ENC_KEY", Buffer.alloc(32, 7).toString("base64"));
  managers = [];
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = ON");
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); });
  await db.schema.createTable("tasks", (t) => { t.text("id").primary(); });
  await migration.up(db);
  await db("projects").insert({ id: "P-TEST" });
  await db("project_telegram_bots").insert({ id: botId, project_id: "P-TEST", telegram_bot_id: "123456789", username: "project_bot",
    token_enc: encryptBotSecret(token), poll_revision: randomUUID(), filter_tags: '["ошибка"]', enabled: true, created_at: "2026-01-01", updated_at: "2026-01-01" });
});
afterEach(async () => { await Promise.all(managers.map((m) => m.stop())); await db.destroy(); vi.unstubAllEnvs(); });

describe("project bot grammY polling", () => {
  it("uses the same HTTP proxy agent as the notification bot with a long-poll-compatible timeout", () => {
    vi.stubEnv("TELEGRAM_BOT_PROXY", "http://proxy.example.test:8080");
    const api = projectTelegramApi(token);
    expect(api).toBeInstanceOf(Api);
    // Inspect grammY's constructor options without making a network call.
    const options = (api as unknown as { options: ApiClientOptions }).options;
    const agent = (options.baseFetchConfig as { agent: HttpsProxyAgent<string> }).agent;
    expect(agent).toBeInstanceOf(HttpsProxyAgent); expect(agent.proxy.hostname).toBe("proxy.example.test");
    expect(options.timeoutSeconds).toBeGreaterThan(25);
  });

  it("persists the cursor before acknowledging a batch and resumes from it after restart", async () => {
    const client = blockedClient(); client.getUpdates.mockResolvedValueOnce([{ update_id: 41 }]);
    const first = manager(client); first.start();
    await vi.waitFor(() => expect(client.getUpdates).toHaveBeenCalledTimes(2));
    expect(client.getUpdates.mock.calls[0][0]).toMatchObject({ offset: 0, timeout: 25, allowed_updates: ["message", "channel_post"] });
    expect(client.getUpdates.mock.calls[1][0]).toMatchObject({ offset: 42 });
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(42);
    expect((await db("project_telegram_bots").first()).last_polled_at).toBeTruthy();
    await first.stop();
    expect(client.getUpdates.mock.calls[1][1]?.aborted).toBe(true);
    const nextClient = blockedClient(); await manager(nextClient).reconcile();
    await vi.waitFor(() => expect(nextClient.getUpdates).toHaveBeenCalledOnce());
    expect(nextClient.getUpdates.mock.calls[0][0]).toMatchObject({ offset: 42 });
  });

  it("runs several bots independently, and aborts polling on disable, token revision change or deletion", async () => {
    const secondId = randomUUID(); const row = await db("project_telegram_bots").first();
    await db("project_telegram_bots").insert({ ...row, id: secondId, telegram_bot_id: "22222222" });
    const client = blockedClient(); const polling = manager(client); await polling.reconcile();
    await vi.waitFor(() => expect(client.getUpdates).toHaveBeenCalledTimes(2));
    await polling.reconcile(); expect(client.getUpdates).toHaveBeenCalledTimes(2);
    await db("project_telegram_bots").where({ id: botId }).update({ enabled: false, poll_revision: randomUUID() });
    await polling.reconcile();
    expect(client.getUpdates.mock.calls.filter((call) => call[1]?.aborted)).toHaveLength(1);
    await db("project_telegram_bots").where({ id: secondId }).update({ poll_revision: randomUUID() }); await polling.reconcile();
    await vi.waitFor(() => expect(client.getUpdates).toHaveBeenCalledTimes(3));
    await db("project_telegram_bots").where({ id: secondId }).del(); await polling.reconcile();
    expect(client.getUpdates.mock.calls.every((call) => call[1]?.aborted)).toBe(true);
  });

  it("leases a bot to one gateway instance and allows takeover after the previous instance stops", async () => {
    const firstClient = blockedClient(); const first = manager(firstClient); await first.reconcile();
    await vi.waitFor(() => expect(firstClient.getUpdates).toHaveBeenCalledOnce());
    const otherClient = blockedClient(); const other = manager(otherClient); await other.reconcile();
    await first.stop();
    await vi.waitFor(async () => { await other.reconcile(); expect(otherClient.getUpdates).toHaveBeenCalledOnce(); });
    expect(firstClient.getUpdates).toHaveBeenCalledOnce();
  });

  it("reports conflicts without recording the bot token or raw transport error", async () => {
    const warn = vi.fn(); const client = blockedClient();
    client.getUpdates.mockRejectedValueOnce(Object.assign(new Error(`https://api.telegram.org/bot${token}/getUpdates`), { error_code: 409 }));
    const polling = manager(client, { warn } as unknown as AppLogger); await polling.reconcile();
    await vi.waitFor(async () => expect((await db("project_telegram_bots").first()).poll_error).toBe("TELEGRAM_POLL_CONFLICT"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    await polling.stop(); expect((await db("project_telegram_bots").first()).poll_owner).toBeNull();
  });

  it("recovers an expired lease left by a crashed gateway", async () => {
    await db("project_telegram_bots").update({ poll_owner: randomUUID(), poll_lease_until: "2000-01-01" });
    const client = blockedClient(); await manager(client).reconcile();
    await vi.waitFor(() => expect(client.getUpdates).toHaveBeenCalledOnce());
  });

  it("honors Telegram retry_after without keeping the polling lease", async () => {
    const client = blockedClient(); client.getUpdates.mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 120 } });
    const polling = manager(client); await polling.reconcile();
    await vi.waitFor(async () => expect(await db("project_telegram_bots").first()).toMatchObject({ poll_error: "TELEGRAM_POLL_RATE_LIMIT", poll_owner: null }));
    await polling.reconcile(); expect(client.getUpdates).toHaveBeenCalledOnce();
    await db("project_telegram_bots").update({ poll_retry_at: "2000-01-01" });
    await vi.waitFor(async () => { await polling.reconcile(); expect(client.getUpdates).toHaveBeenCalledTimes(2); });
  });

  it("does not acknowledge updates after a persistence failure", async () => {
    const client = blockedClient(); client.getUpdates.mockResolvedValueOnce([{ update_id: 8 }]);
    await db.raw("CREATE TRIGGER reject_poll_offset BEFORE UPDATE OF poll_offset ON project_telegram_bots BEGIN SELECT RAISE(ABORT, 'injected DB failure'); END");
    const polling = manager(client); await polling.reconcile();
    await vi.waitFor(async () => expect((await db("project_telegram_bots").first()).poll_error).toBe("TELEGRAM_POLL_FAILED"));
    expect(client.getUpdates).toHaveBeenCalledOnce();
    expect(Number((await db("project_telegram_bots").first()).poll_offset)).toBe(0);
    await polling.stop(); await db.raw("DROP TRIGGER reject_poll_offset");
    const nextClient = blockedClient(); await manager(nextClient).reconcile();
    await vi.waitFor(() => expect(nextClient.getUpdates).toHaveBeenCalledOnce());
    expect(nextClient.getUpdates.mock.calls[0][0]).toMatchObject({ offset: 0 });
  });

  it.each([
    new GrammyError("Telegram rejected the request", { ok: false, error_code: 401, description: "Unauthorized" }, "getUpdates", {}),
    new HttpError("Telegram HTTP request failed", new Error("proxy unavailable")),
    new Error("unexpected receiver failure"),
  ])("isolates a bot's %s while another bot keeps processing", async (failure) => {
    const secondId = randomUUID(); const row = await db("project_telegram_bots").first();
    await db("project_telegram_bots").insert({ ...row, id: secondId, telegram_bot_id: "22222222", token_enc: encryptBotSecret("second-token") });
    const broken = blockedClient(); broken.getUpdates.mockRejectedValue(failure);
    const healthy = blockedClient(); healthy.getUpdates.mockResolvedValueOnce([{ update_id: 17 }]);
    const polling = new TelegramProjectPolling(db, undefined, (credential) => credential === token ? broken : healthy);
    managers.push(polling); await expect(polling.reconcile()).resolves.toBeUndefined();
    await vi.waitFor(async () => {
      expect((await db("project_telegram_bots").where({ id: botId }).first()).poll_error).toBeTruthy();
      expect(Number((await db("project_telegram_bots").where({ id: secondId }).first()).poll_offset)).toBe(18);
    });
    await expect(polling.stop()).resolves.toBeUndefined();
  });

  it("contains client initialization failures and reconciliation errors", async () => {
    const warn = vi.fn(); const factory = vi.fn(() => { throw new Error("could not initialize grammY client"); });
    const polling = new TelegramProjectPolling(db, { warn } as unknown as AppLogger, factory); managers.push(polling);
    await expect(polling.reconcile()).resolves.toBeUndefined();
    await vi.waitFor(async () => expect((await db("project_telegram_bots").first()).poll_error).toBe("TELEGRAM_POLL_FAILED"));
    await expect(polling.stop()).resolves.toBeUndefined();
    await db.schema.dropTable("project_telegram_bots");
    const another = manager(blockedClient(), { warn } as unknown as AppLogger);
    await expect(another.reconcile()).resolves.toBeUndefined();
    await expect(another.stop()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
