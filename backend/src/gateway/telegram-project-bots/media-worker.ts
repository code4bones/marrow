import path from "node:path";
import { createHash } from "node:crypto";
import { GrammyError } from "grammy";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { AppLogger } from "../../shared/logging/logger.js";
import { PgToolService } from "../pg-tool-service.js";
import type { Row } from "../pg-tool-service/types.js";
import { decryptBotSecret } from "./remote.js";
import { downloadTelegramFile } from "./media-download.js";

function fileName(value: unknown): string {
  const name = path.posix.basename(String(value).replace(/\\/g, "/")).replace(/[^\p{L}\p{N}_. -]/gu, "_").slice(-180);
  return !name || name === "." || name === ".." ? "attachment.bin" : name;
}
export class TelegramMediaWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private controller = new AbortController();
  constructor(private readonly db: Knex, private readonly logger?: AppLogger,
    private readonly download = downloadTelegramFile,
    private readonly createService = (db: Knex) => new PgToolService(db)) {}
  start() {
    if (this.timer) return;
    this.controller = new AbortController();
    const tick = () => void this.tick().catch(() => this.logger?.warn({ code: "TELEGRAM_FILE_TICK_FAILED" }, "Telegram file processing deferred"));
    this.timer = setInterval(tick, 2000); this.timer.unref(); tick();
  }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.controller.abort(); await this.running?.catch(() => {}); }
  async tick() { if (this.running) return this.running; this.running = this.run(); try { await this.running; } finally { this.running = null; } }
  private async run() {
    for (let n = 0; n < 3 && !this.controller.signal.aborted; n++) {
      const row = await this.claim(); if (!row) return;
      try { await this.process(row); }
      catch (error) {
        const specific = error instanceof AppError && /^TELEGRAM_FILE_[A-Z_]+$/.test(error.message) ? error.message : null;
        const code = specific ?? (error instanceof GrammyError ? `TELEGRAM_FILE_API_${error.error_code}` : "TELEGRAM_FILE_PROCESSING_FAILED");
        const permanent = specific === "TELEGRAM_FILE_TOO_LARGE" || specific === "TELEGRAM_FILE_SOURCE_UNAVAILABLE" || specific === "TELEGRAM_FILE_CONFLICT" || (error instanceof GrammyError && error.error_code >= 400 && error.error_code < 500 && error.error_code !== 429);
        const failed = permanent || Number(row.attempts) >= 5;
        const delay = error instanceof GrammyError ? error.parameters.retry_after ?? 2 ** Number(row.attempts) : 2 ** Number(row.attempts);
        await this.db("telegram_message_files").where({ id: row.id, status: "processing", attempts: row.attempts }).update({ status: failed ? "failed" : "pending", last_error: code, locked_until: null, available_at: new Date(Date.now() + Math.max(1, Math.min(3600, delay)) * 1000).toISOString() });
        this.logger?.warn({ fileId: row.id, code, failed }, "Telegram attachment deferred; task is saved");
      }
    }
  }
  private async claim(): Promise<Row | null> {
    return this.db.transaction(async (trx) => {
      const q = trx("telegram_message_files").where((q) => q.where((q) => q.where({ status: "pending" }).where("available_at", "<=", nowIso())).orWhere((q) => q.where({ status: "processing" }).where("locked_until", "<", nowIso()))).orderBy("received_at");
      if (trx.client.config.client === "pg") q.forUpdate().skipLocked();
      const row = await q.first(); if (!row) return null;
      const attempts = Number(row.attempts) + 1;
      await trx("telegram_message_files").where({ id: row.id }).update({ status: "processing", attempts, locked_until: new Date(Date.now() + 120_000).toISOString() });
      return { ...row, attempts };
    });
  }
  private async process(row: Row) {
    const bot = await this.db("project_telegram_bots").where({ id: row.bot_id, project_id: row.project_id }).first();
    const chat = bot ? await this.db("project_telegram_chats").where({ bot_id: bot.id, chat_id: row.chat_id }).first() : null;
    const project = await this.db("projects").where({ id: row.project_id, status: "active" }).first();
    const task = await this.db("tasks").where({ id: row.task_id, project_id: row.project_id }).first();
    if (!bot || !chat || !project || !task) throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_SOURCE_UNAVAILABLE");
    if (!bot.enabled) {
      await this.db("telegram_message_files").where({ id: row.id, attempts: row.attempts }).update({ status: "pending", attempts: Number(row.attempts) - 1, locked_until: null, available_at: new Date(Date.now() + 5000).toISOString() }); return;
    }
    const configuredLimit = Number(process.env.ARTIFACT_MAX_BYTES ?? 10 * 1024 * 1024);
    const maxBytes = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 10 * 1024 * 1024;
    if (Number(row.size_bytes) > maxBytes) throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_TOO_LARGE");
    const bytes = await this.download(decryptBotSecret(String(bot.token_enc)), String(row.file_id), maxBytes, this.controller.signal);
    if (bytes.length > maxBytes) throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_TOO_LARGE");
    let notifications: PgToolService | null = null;
    await this.db.transaction(async (trx) => {
      const p = await trx("projects").where({ id: row.project_id, status: "active" }).forUpdate().first();
      const b = await trx("project_telegram_bots").where({ id: bot.id }).forUpdate().first();
      const file = await trx("telegram_message_files").where({ id: row.id, status: "processing", attempts: row.attempts }).forUpdate().first();
      if (!file) return;
      if (!p || !b || !await trx("project_telegram_chats").where({ bot_id: bot.id, chat_id: row.chat_id }).first() || !await trx("tasks").where({ id: row.task_id, project_id: row.project_id }).first()) throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_SOURCE_UNAVAILABLE");
      if (!b.enabled) {
        await trx("telegram_message_files").where({ id: file.id }).update({ status: "pending", locked_until: null, attempts: Number(row.attempts) - 1, available_at: new Date(Date.now() + 5000).toISOString() }); return;
      }
      const artifactPath = `telegram/${row.chat_id}/${row.message_id}/${String(row.file_unique_id).replace(/[^a-zA-Z0-9_-]/g, "_")}/${fileName(row.file_name)}`;
      const existing = await trx("artifacts").where({ project_id: row.project_id, path: artifactPath }).first();
      const service = this.createService(trx); service.deferEventNotifications();
      const context = { clientId: `integration:telegram:${bot.id}`, clientLabel: `Telegram @${bot.username}`, metadata: { kind: "integration", source: "telegram" } };
      let artifactId: string;
      if (existing) {
        if (existing.sha256 !== createHash("sha256").update(bytes).digest("hex")) throw new AppError("VALIDATION_ERROR", "TELEGRAM_FILE_CONFLICT");
        artifactId = String(existing.id);
      } else {
        const result = await service.call("artifact.put", { project: p.id, path: artifactPath, title: fileName(row.file_name), contentType: row.content_type,
          description: `Telegram attachment for ${task.id}`, contentBase64: bytes.toString("base64"), tags: ["telegram", "attachment"] }, context);
        if (!result.ok) throw new AppError("GATEWAY_ERROR", "TELEGRAM_FILE_ARTIFACT_FAILED");
        artifactId = String(((result.data as Row).artifact as Row).id);
      }
      if (!await trx("links").where({ from_id: artifactId, to_id: task.id, relation: "attached_to" }).first()) {
        const linked = await service.call("link.create", { project: p.id, fromId: artifactId, toId: task.id, relation: "attached_to" }, context);
        if (!linked.ok) throw new AppError("GATEWAY_ERROR", "TELEGRAM_FILE_LINK_FAILED");
      }
      await trx("telegram_message_files").where({ id: row.id }).update({ status: "done", artifact_id: artifactId, locked_until: null, last_error: null });
      notifications = service;
    });
    (notifications as PgToolService | null)?.flushEventNotifications(this.db);
  }
}
