import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Api } from "grammy";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import type { AppLogger } from "../../shared/logging/logger.js";
import type { Row } from "../pg-tool-service/types.js";
import { acceptTelegramUpdate } from "./receiver.js";
import { decryptBotSecret, projectTelegramApi } from "./remote.js";
import { telegramRequest } from "./request.js";
import { sendBindingConfirmation } from "./confirmation.js";

interface Poller { revision: string; controller: AbortController; done: Promise<void> }
type PollingApi = Pick<Api, "getUpdates" | "sendRichMessage">;

function pollingError(error: unknown): { code: string; retryAfter?: number } {
  const value = error as { error_code?: number; parameters?: { retry_after?: number } } | null;
  const code = value?.error_code;
  if (code === 429) {
    const seconds = value?.parameters?.retry_after;
    return { code: "TELEGRAM_POLL_RATE_LIMIT", retryAfter: typeof seconds === "number" && Number.isFinite(seconds) ? Math.max(1, seconds) : 30 };
  }
  return { code: code === 409 ? "TELEGRAM_POLL_CONFLICT" : code === 401 || code === 403 ? "TELEGRAM_POLL_UNAUTHORIZED" : "TELEGRAM_POLL_FAILED" };
}

export class TelegramProjectPolling {
  private readonly pollers = new Map<string, Poller>();
  private timer: NodeJS.Timeout | null = null;
  private reconciling: Promise<void> | null = null;
  private stopping = false;

  constructor(private readonly db: Knex, private readonly logger?: AppLogger,
    private readonly createApi: (token: string) => PollingApi = projectTelegramApi) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    const reconcile = () => void this.reconcile().catch(() => this.logger?.warn("Project Telegram polling reconciliation failed"));
    this.timer = setInterval(reconcile, 2000); this.timer.unref(); reconcile();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const poller of this.pollers.values()) poller.controller.abort();
    await this.reconciling;
    await Promise.allSettled([...this.pollers.values()].map((poller) => poller.done));
  }

  async reconcile(): Promise<void> {
    if (this.stopping) return;
    if (this.reconciling) return this.reconciling;
    // This supervisor is an optional background integration: failures in
    // bot startup, reconciliation or cleanup must never reject into the
    // gateway lifecycle or become unhandled timer promise rejections.
    this.reconciling = this.reconcileBots()
      .catch(() => this.logger?.warn("Project Telegram polling reconciliation failed; will retry"));
    try { await this.reconciling; } finally { this.reconciling = null; }
  }

  private async reconcileBots(): Promise<void> {
    const bots = await this.db("project_telegram_bots").where({ enabled: true }).select("id", "poll_revision", "token_enc");
    const enabled = new Map(bots.map((bot) => [String(bot.id), bot]));
    const stopping: Promise<void>[] = [];
    for (const [id, poller] of this.pollers) {
      if (!enabled.has(id) || enabled.get(id)?.poll_revision !== poller.revision || this.stopping) {
        poller.controller.abort(); stopping.push(poller.done);
      }
    }
    await Promise.all(stopping);
    if (this.stopping) return;
    for (const bot of bots) {
      const id = String(bot.id);
      if (this.pollers.has(id)) continue;
      const poller: Poller = { revision: String(bot.poll_revision), controller: new AbortController(), done: Promise.resolve() };
      this.pollers.set(id, poller);
      poller.done = this.poll(bot, poller.controller.signal)
        .catch(() => this.logger?.warn({ botId: id }, "Project Telegram polling stopped; will retry"))
        .finally(() => { if (this.pollers.get(id) === poller) this.pollers.delete(id); });
    }
  }

  private async poll(bot: Row, signal: AbortSignal): Promise<void> {
    const id = String(bot.id); const revision = String(bot.poll_revision); const owner = randomUUID();
    let api: PollingApi | null = null;
    let failures = 0;
    try {
      while (!signal.aborted) {
        // A renewable DB lease prevents competing getUpdates consumers in
        // multiple gateway instances, without holding a connection/lock
        // for the duration of Telegram's long poll.
        const [current] = await this.db("project_telegram_bots").where({ id, enabled: true, poll_revision: revision })
          .where((q) => q.whereNull("poll_owner").orWhere("poll_owner", owner).orWhere("poll_lease_until", "<=", nowIso()))
          .where((q) => q.whereNull("poll_retry_at").orWhere("poll_retry_at", "<=", nowIso()))
          .update({ poll_owner: owner, poll_lease_until: new Date(Date.now() + 90_000).toISOString() }).returning("*");
        if (!current || signal.aborted) return;
        try {
          api ??= this.createApi(decryptBotSecret(String(bot.token_enc)));
          const updates = await telegramRequest(signal, (apiSignal) => api!.getUpdates({
            offset: Number(current.poll_offset), timeout: 25, limit: 100, allowed_updates: ["message", "channel_post", "edited_message", "edited_channel_post", "chat_member", "my_chat_member", "chat_join_request"]
          }, apiSignal));
          for (const update of updates) {
            if (signal.aborted) return;
            const result = await acceptTelegramUpdate(this.db, id, Buffer.from(JSON.stringify(update)), { owner, revision });
            if ("stopped" in result && result.stopped) return;
            if ("confirmation" in result && result.confirmation) {
              await sendBindingConfirmation(api, result.confirmation, id, signal, this.logger);
            }
          }
          await this.db("project_telegram_bots").where({ id, poll_owner: owner, poll_revision: revision, enabled: true })
            .update({ last_polled_at: nowIso(), poll_error: null, poll_retry_at: null });
          failures = 0;
          // Avoid a tight loop on a short/empty proxy response. Abortable
          // so disabling/removing a bot does not wait for a retry timer.
          if (updates.length === 0) await delay(250, undefined, { signal });
        } catch (error) {
          if (signal.aborted) return;
          const { code, retryAfter } = pollingError(error);
          await this.db("project_telegram_bots").where({ id, poll_owner: owner, poll_revision: revision, enabled: true })
            .update({ poll_error: code, ...(retryAfter ? { poll_retry_at: new Date(Date.now() + retryAfter * 1000).toISOString() } : {}) });
          this.logger?.warn({ botId: id, code }, "Project Telegram polling failed");
          if (retryAfter) return; // release lease; reconciliation honors retry time
          failures += 1;
          await delay(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), undefined, { signal }).catch(() => {});
        }
      }
    } finally {
      await this.db("project_telegram_bots").where({ id, poll_owner: owner }).update({ poll_owner: null, poll_lease_until: null });
    }
  }
}
