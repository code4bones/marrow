import { taskFeedbackMessage } from "./feedback-message.js";
import type { Api } from "grammy";
import { GrammyError } from "grammy";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import type { AppLogger } from "../../shared/logging/logger.js";
import type { Row } from "../pg-tool-service/types.js";
import { marrowWebUrl } from "../telegram.js";
import { decryptBotSecret, projectTelegramApi } from "./remote.js";
import { telegramRequest } from "./request.js";
import { telegramFeedbackIntegration, telegramFeedbackSchema } from "./feedback.js";

export class TelegramTaskFeedbackDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private controller = new AbortController();
  constructor(private readonly db: Knex, private readonly logger?: AppLogger,
    private readonly createApi: (token: string) => Pick<Api, "sendRichMessage"> = projectTelegramApi) {}

  start(): void {
    if (this.timer) return;
    this.controller = new AbortController();
    const tick = () => void this.tick().catch(() => this.logger?.warn({ code: "TELEGRAM_FEEDBACK_TICK_FAILED" }, "Telegram task feedback deferred"));
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.controller.abort(); await this.running?.catch(() => {});
  }
  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run();
    try { await this.running; } finally { this.running = null; }
  }
  private async run(): Promise<void> {
    // An interrupted send may have reached Telegram. Never turn a stale
    // sending lease into permission to send the same notification again.
    await this.db("integration_outbox").where({ integration: telegramFeedbackIntegration, delivery_status: "sending" })
      .where("locked_until", "<", nowIso()).update({ delivery_status: "failed", last_error: "TELEGRAM_FEEDBACK_UNCERTAIN", locked_until: null, updated_at: nowIso() });
    for (let n = 0; n < 5 && !this.controller.signal.aborted; n++) {
      const prepared = await this.prepare();
      if (!prepared) break;
      if (prepared.skip) continue;
      const { row, payload, api } = prepared;
      try {
        const webUrl = marrowWebUrl();
        if (!webUrl) { await this.fail(row, "TELEGRAM_FEEDBACK_WEB_URL_REQUIRED"); continue; }
        const sent = await telegramRequest(this.controller.signal, (s) => api.sendRichMessage(payload.chatId, taskFeedbackMessage(payload, webUrl), { reply_parameters: { message_id: payload.messageId, allow_sending_without_reply: true },
          ...(payload.messageThreadId ? { message_thread_id: payload.messageThreadId } : {}) }, s));
        await this.db("integration_outbox").where({ id: row.id, delivery_status: "sending", attempt_count: row.attempt_count })
          .update({ delivery_status: "delivered", delivered_at: nowIso(), delivery_response: JSON.stringify({ messageId: sent.message_id }), locked_until: null, last_error: null, updated_at: nowIso() });
      } catch (error) {
        const definitive = error instanceof GrammyError;
        const retry = definitive && Number(row.attempt_count) < 5 && (error.error_code === 429 || error.error_code >= 500);
        const code = definitive ? `TELEGRAM_FEEDBACK_API_${error.error_code}` : "TELEGRAM_FEEDBACK_UNCERTAIN";
        if (retry) {
          const delay = error.parameters.retry_after ?? Math.min(300, 2 ** Number(row.attempt_count));
          await this.db("integration_outbox").where({ id: row.id, delivery_status: "sending", attempt_count: row.attempt_count })
            .update({ delivery_status: "pending", last_error: code, available_at: new Date(Date.now() + Math.max(1, delay) * 1000).toISOString(), locked_until: null, updated_at: nowIso() });
        } else await this.fail(row, code);
        this.logger?.warn({ feedbackId: row.id, code }, "Telegram task feedback send failed; task status is saved");
      }
    }
  }
  private async fail(row: Row, code: string): Promise<void> {
    await this.db("integration_outbox").where({ id: row.id }).update({ delivery_status: "failed", last_error: code, locked_until: null, updated_at: nowIso() });
  }
  private async prepare() {
    return this.db.transaction(async (trx) => {
      const q = trx("integration_outbox").where({ integration: telegramFeedbackIntegration, delivery_status: "pending" }).where("available_at", "<=", nowIso()).orderBy("created_at");
      if (trx.client.config.client === "pg") q.forUpdate().skipLocked();
      const row = await q.first();
      if (!row) return null;
      let data: unknown;
      try { data = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; } catch { data = null; }
      const parsed = telegramFeedbackSchema.safeParse(data);
      const fail = async (code: string) => { await trx("integration_outbox").where({ id: row.id }).update({ delivery_status: "failed", last_error: code, updated_at: nowIso() }); return { skip: true as const }; };
      if (!parsed.success) return fail("TELEGRAM_FEEDBACK_INVALID_PAYLOAD");
      const payload = parsed.data;
      const task = await trx("tasks").where({ id: row.task_id, project_id: row.project_id }).first();
      const project = await trx("projects").where({ id: row.project_id, status: "active" }).first();
      const bot = await trx("project_telegram_bots").where({ id: payload.botId, project_id: row.project_id }).first();
      const chat = bot ? await trx("project_telegram_chats").where({ bot_id: bot.id, chat_id: payload.chatId }).first() : null;
      if (!task || !project || !bot || !chat || (payload.status === "done" && task.status !== "done")) return fail("TELEGRAM_FEEDBACK_SOURCE_UNAVAILABLE");
      const earlier = await trx("integration_outbox").where({ integration: telegramFeedbackIntegration, task_id: row.task_id }).whereIn("delivery_status", ["pending", "sending"]).whereNot("id", row.id);
      const hasEarlier = earlier.some((other) => {
        try { const p = typeof other.payload === "string" ? JSON.parse(other.payload) : other.payload; return Number(p.taskVersion) < payload.taskVersion; } catch { return false; }
      });
      if (hasEarlier) {
        await trx("integration_outbox").where({ id: row.id }).update({ available_at: new Date(Date.now() + 1000).toISOString() });
        return { skip: true as const };
      }
      if (!bot.enabled) {
        await trx("integration_outbox").where({ id: row.id }).update({ available_at: new Date(Date.now() + 5000).toISOString(), updated_at: nowIso() });
        return { skip: true as const };
      }
      let api: Pick<Api, "sendRichMessage">;
      try { api = this.createApi(decryptBotSecret(String(bot.token_enc))); }
      catch { return fail("TELEGRAM_FEEDBACK_CONFIG_FAILED"); }
      const attempts = Number(row.attempt_count) + 1;
      await trx("integration_outbox").where({ id: row.id }).update({ delivery_status: "sending", attempt_count: attempts, locked_until: new Date(Date.now() + 120_000).toISOString(), updated_at: nowIso() });
      return { skip: false as const, row: { ...row, attempt_count: attempts }, payload: { ...payload, projectSlug: String(project.slug) }, api };
    });
  }
}
