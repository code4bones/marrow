import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { AppLogger } from "../../shared/logging/logger.js";
import { PgToolService } from "../pg-tool-service.js";
import type { Row } from "../pg-tool-service/types.js";
import type { LlmHttpFetch } from "../llm-providers/index.js";
import { classificationSchema, classifyTelegramMessage, type Classification } from "./classifier.js";
import { mentionedProjectMembers } from "./members.js";
import type { TelegramMentionMessage } from "./protocol.js";
import { matchesTelegramTags } from "./tags.js";

function jsonValue(value: unknown): unknown { return typeof value === "string" ? JSON.parse(value) : value; }

export class TelegramMessageWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(private readonly db: Knex, private readonly logger?: AppLogger,
    private readonly httpFetch: LlmHttpFetch = fetch,
    private readonly createService: (db: Knex) => PgToolService = (db) => new PgToolService(db)) {}

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    const tick = () => void this.tick().catch(() => this.logger?.error("Telegram message queue tick failed"));
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick();
  }
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }
  async tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run();
    try { await this.running; } finally { this.running = null; }
  }

  private async run(): Promise<void> {
    for (let index = 0; index < 5 && !this.stopping; index++) {
      const delivery = await this.claim();
      if (!delivery) return;
      try { await this.process(delivery); }
      catch (error) {
        const code = error instanceof AppError ? error.code : "GATEWAY_ERROR";
        const failed = Number(delivery.attempts) >= 5;
        await this.db("telegram_message_inbox").where({ id: delivery.id, status: "processing", attempts: delivery.attempts }).update({
          status: failed ? "failed" : "pending", last_error: code, locked_until: null,
          available_at: new Date(Date.now() + Math.min(300, 2 ** Number(delivery.attempts)) * 1000).toISOString()
        });
        await this.db("project_telegram_bots").where({ id: delivery.bot_id }).update({ last_error: code });
        this.logger?.warn({ deliveryId: delivery.id, code, failed }, "Telegram task classification/import failed");
      }
    }
  }

  private async claim(): Promise<Row | null> {
    return this.db.transaction(async (trx) => {
      const query = trx("telegram_message_inbox").where((q) => q
        .where((q) => q.where({ status: "pending" }).andWhere("available_at", "<=", nowIso()))
        .orWhere((q) => q.where({ status: "processing" }).andWhere("locked_until", "<", nowIso())))
        .orderBy("received_at");
      if (trx.client.config.client === "pg") query.forUpdate().skipLocked();
      const row = await query.first();
      if (!row) return null;
      const attempts = Number(row.attempts) + 1;
      await trx("telegram_message_inbox").where({ id: row.id }).update({ status: "processing", attempts,
        locked_until: new Date(Date.now() + 120_000).toISOString() });
      return { ...row, attempts };
    });
  }

  private async process(delivery: Row): Promise<void> {
    const bot = await this.db("project_telegram_bots").where({ id: delivery.bot_id, enabled: true }).first();
    const project = await this.db("projects").where({ id: delivery.project_id, status: "active" }).first();
    const chat = await this.db("project_telegram_chats").where({ bot_id: delivery.bot_id, chat_id: delivery.chat_id }).first();
    if (!bot || !project || !chat || !project.owner_user_id) { await this.ignore(delivery); return; }
    const message = jsonValue(delivery.payload) as TelegramMentionMessage;
    if (!matchesTelegramTags(bot.filter_tags, message.tags)) { await this.ignore(delivery); return; }
    const members = await mentionedProjectMembers(this.db, String(project.id), project.owner_user_id, message);
    if (!members.length) { await this.ignore(delivery); return; }
    // No transaction/row locks are held across a potentially slow AI call.
    let classification: Classification;
    if (delivery.classification && delivery.classified_owner_id === project.owner_user_id) {
      classification = classificationSchema.parse(jsonValue(delivery.classification));
    } else {
      classification = await classifyTelegramMessage(this.db, String(project.owner_user_id), message.text, members, this.httpFetch);
      await this.db("telegram_message_inbox").where({ id: delivery.id, status: "processing", attempts: delivery.attempts })
        .update({ classification: JSON.stringify(classification), classified_owner_id: project.owner_user_id });
    }
    let notifications: PgToolService | null = null;
    await this.db.transaction(async (trx) => {
      // Serialize IDs and source deduplication within this project, then
      // fence disconnect/unlink and stale workers before any task is made.
      const currentProject = await trx("projects").where({ id: project.id, status: "active" }).forUpdate().first();
      const currentBot = await trx("project_telegram_bots").where({ id: bot.id, enabled: true }).forUpdate().first();
      const current = await trx("telegram_message_inbox").where({ id: delivery.id, status: "processing", attempts: delivery.attempts }).forUpdate().first();
      if (!current) return;
      const currentChat = await trx("project_telegram_chats").where({ bot_id: bot.id, chat_id: message.chatId }).first();
      if (!currentProject || !currentBot || !currentChat || !matchesTelegramTags(currentBot.filter_tags, message.tags)) {
        await trx("telegram_message_inbox").where({ id: delivery.id }).update({ status: "ignored", locked_until: null }); return;
      }
      if (currentProject.owner_user_id !== project.owner_user_id) throw new AppError("GATEWAY_ERROR", "Project owner changed; reclassify with the current owner's DeepSeek.");
      const recipients = await mentionedProjectMembers(trx, String(project.id), currentProject.owner_user_id, message);
      const service = this.createService(trx); service.deferEventNotifications();
      let created = false;
      for (const assignment of classification.tasks) {
        const member = recipients.find((m) => m.telegramId === assignment.telegramUserId);
        if (!member || assignment.confidence < 0.9) continue;
        const key = { project_id: project.id, chat_id: message.chatId, message_id: message.messageId, telegram_user_id: member.telegramId };
        if (await trx("telegram_task_sources").where(key).first()) continue;
        const result = await service.call("task.create", {
          project: project.id, title: assignment.title, scope: assignment.description, assignee: member.userId,
          milestone: `Telegram: ${message.chatTitle}`,
          notes: [`Telegram: ${message.url ?? `chat ${message.chatId}, message ${message.messageId}`}`,
            `Chat: ${message.chatTitle}`, `DeepSeek evidence: ${assignment.evidence}`, "", "Original message:", message.text].join("\n")
        }, { clientId: `integration:telegram:${bot.id}`, clientLabel: `Telegram @${bot.username}`,
          metadata: { kind: "integration", source: "telegram" } });
        if (!result.ok) throw new AppError("GATEWAY_ERROR", `Telegram task import failed: ${result.error.code}`);
        const taskId = String(((result.data as Row).task as Row).id);
        await trx("telegram_task_sources").insert({ ...key, task_id: taskId, created_at: nowIso() });
        created = true;
      }
      await trx("telegram_message_inbox").where({ id: delivery.id }).update({ status: created || classification.tasks.length ? "done" : "ignored", locked_until: null, last_error: null });
      await trx("project_telegram_bots").where({ id: bot.id }).update({ last_error: null });
      notifications = service;
    });
    (notifications as PgToolService | null)?.flushEventNotifications(this.db);
  }

  private async ignore(delivery: Row): Promise<void> {
    await this.db("telegram_message_inbox").where({ id: delivery.id, status: "processing", attempts: delivery.attempts })
      .update({ status: "ignored", locked_until: null });
  }
}
