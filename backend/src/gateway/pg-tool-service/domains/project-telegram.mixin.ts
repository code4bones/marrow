import { queueManualTelegramTask } from "../../telegram-project-bots/manual.js";
import { queueTelegramMessageRetry, telegramMessageRetryState } from "../../telegram-project-bots/retry.js";
import { chatRecipients, recipientKeys } from "../../telegram-project-bots/recipients.js";
import { randomBytes, randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { telegramBotToken } from "../../telegram.js";
import { decryptBotSecret, encryptBotSecret, projectTelegramApi } from "../../telegram-project-bots/remote.js";
import { linkCodeHash } from "../../telegram-project-bots/receiver.js";
import { telegramBotTags } from "../../telegram-project-bots/tags.js";
import { telegramPollingStatus } from "../../telegram-project-bots/status.js";
import { activeProjectUsers, resolveTelegramRecipient } from "../../telegram-project-bots/members.js";
import { botMessageOut, botMessageSelect } from "../../telegram-project-bots/messages.js";
import type { Constructor } from "../base.js";
import type { Tier1Instance } from "../core/links-core.mixin.js";
import { dateStringOrNull } from "../formatters/common.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";

export function ProjectTelegramMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
    private async telegramBotOut(row: Row) {
      const chats = await this.db("project_telegram_chats").where({ bot_id: row.id }).orderBy("created_at");
      const failed = await this.db("telegram_message_inbox").where({ bot_id: row.id, status: "failed" }).count({ count: "*" }).first();
      const pending = await this.db("telegram_message_inbox").where({ bot_id: row.id }).whereIn("status", ["pending", "processing"]).count({ count: "*" }).first();
      return { id: row.id, username: row.username, tags: telegramBotTags(row.filter_tags), enabled: Boolean(row.enabled), lastError: row.poll_error ?? row.last_error ?? null,
        pollingStatus: telegramPollingStatus(row),
        receivedCount: Number(row.received_count ?? 0), matchedCount: Number(row.matched_count ?? 0), processedCount: Number(row.processed_count ?? 0),
        lastMatchedAt: dateStringOrNull(row.last_matched_at), lastProcessedAt: dateStringOrNull(row.last_processed_at),
        lastPolledAt: dateStringOrNull(row.last_polled_at),
        lastReceivedAt: dateStringOrNull(row.last_received_at), lastChatTitle: row.last_chat_title ?? null,
        failedCount: Number(failed?.count ?? 0), pendingCount: Number(pending?.count ?? 0),
        chats: chats.map((chat) => ({ chatId: chat.chat_id, title: chat.title })) };
    }

    private async managedTelegramProject(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      return project;
    }

    protected async projectTelegramBots(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      const bots = await this.db("project_telegram_bots").where({ project_id: project.id }).orderBy("created_at");
      const provider = project.ownerUserId ? await this.db("ai_provider_credentials")
        .where({ owner_user_id: project.ownerUserId, provider: "deepseek" }).whereNotNull("model").whereNot("model", "").first() : null;
      return { bots: await Promise.all(bots.map((bot) => this.telegramBotOut(bot))), deepseekReady: Boolean(provider) };
    }

    private async managedTelegramBot(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      const bot = await this.db("project_telegram_bots").where({ id: input.id, project_id: project.id }).first();
      if (!bot) throw new AppError("NOT_FOUND", "Bot not found in this project.");
      return { bot, project };
    }

    protected async projectTelegramBotMessages(input: Row, context: NormalizedGatewayRequestContext) {
      const { bot } = await this.managedTelegramBot(input, context);
      const rows = await botMessageSelect(this.db, String(bot.id)).orderBy("m.received_at", "desc").orderBy("m.telegram_update_id", "desc")
        .limit(Number(input.limit ?? 25)).offset(Number(input.offset ?? 0));
      const total = await this.db("telegram_bot_messages").where({ bot_id: bot.id }).count({ count: "*" }).first();
      return { messages: rows.map((row) => botMessageOut(row)), total: Number(total?.count ?? 0) };
    }

    protected async projectTelegramBotMessage(input: Row, context: NormalizedGatewayRequestContext) {
      const { bot, project } = await this.managedTelegramBot(input, context);
      const row = await botMessageSelect(this.db, String(bot.id)).where("m.id", String(input.messageId)).first();
      if (!row) throw new AppError("NOT_FOUND", "Message not found for this project's bot.");
      let tasks = row.chat_id && row.message_id ? await this.db("telegram_task_sources as s").join("tasks as t", "t.id", "s.task_id")
        .where({ "s.project_id": project.id, "s.chat_id": row.chat_id, "s.message_id": row.message_id })
        .select("t.id", "t.title", "t.status") : [];
      const inbox = row.inbox_id ? await this.db("telegram_message_inbox").where({ id: row.inbox_id }).first() : null;
      const source = await this.db("telegram_task_sources").where({ project_id: project.id, chat_id: row.chat_id, message_id: row.message_id }).first();
      const bound = await this.db("project_telegram_chats").where({ bot_id: bot.id, chat_id: row.chat_id }).first();
      const attachments = await this.db("telegram_message_files").where({ project_id: project.id, chat_id: row.chat_id })
        .andWhere((q) => { q.where("message_id", row.message_id); if (tasks.length) q.orWhereIn("task_id", tasks.map((t) => String(t.id))); });
      const extraTaskIds = [...new Set(attachments.filter((a) => a.task_id).map((a) => String(a.task_id)))].filter((id) => !tasks.some((t) => t.id === id));
      if (extraTaskIds.length) tasks = [...tasks, ...await this.db("tasks").where({ project_id: project.id }).whereIn("id", extraTaskIds).select("id", "title", "status")];
      const canCreateTask = Boolean(!tasks.length && inbox && bot.enabled && project.status === "active" && bound && !source && !["pending", "processing"].includes(String(inbox.status)));
      const assignableMembers = canCreateTask ? await activeProjectUsers(this.db, project.id, project.ownerUserId).select("u.id", "u.email") : [];
      const { canRetry } = await telegramMessageRetryState(this.db, project, bot, row, inbox);
      return { ...botMessageOut(row, true), tasks, canCreateTask, canRetry, assignableMembers, manual: Boolean(inbox?.manual_override), attachments: attachments.map((a) => ({ id: a.id, name: a.file_name, kind: a.kind, contentType: a.content_type, sizeBytes: a.size_bytes === null ? null : Number(a.size_bytes), status: a.status, artifactId: a.artifact_id, lastError: a.last_error })) };
    }


    protected async retryTelegramMessageFile(input: Row, context: NormalizedGatewayRequestContext) {
      const { project } = await this.managedTelegramBot(input, context);
      const row = await this.db("telegram_message_files").where({ id: input.fileId, project_id: project.id }).first();
      if (!row) throw new AppError("NOT_FOUND", "Attachment not found in this project.");
      if (row.status !== "failed" || !row.task_id) return { queued: false };
      await this.db("telegram_message_files").where({ id: row.id, status: "failed", attempts: row.attempts }).update({ status: "pending", attempts: Number(row.attempts) + 1, available_at: nowIso(), locked_until: null, last_error: null });
      return { queued: true };
    }

    protected async manuallyCreateTelegramTask(input: Row, context: NormalizedGatewayRequestContext) {
      const { bot, project } = await this.managedTelegramBot(input, context);
      return queueManualTelegramTask(this.db, project, String(bot.id), String(input.messageId), input.assignees as string[], input.title as string | undefined, context.sessionUserId ?? String(project.ownerUserId));
    }

    protected async retryTelegramBotMessage(input: Row, context: NormalizedGatewayRequestContext) {
      const { bot, project } = await this.managedTelegramBot(input, context);
      const { changed, ...result } = await queueTelegramMessageRetry(this.db, project, String(bot.id), String(input.messageId));
      if (changed) await this.recordEventForProject(project.id, { type: "telegram.message_retry_requested", title: "Telegram message queued for classification", related_id: String(input.messageId) }, context);
      return result;
    }

    protected async projectTelegramChatMentions(input: Row, context: NormalizedGatewayRequestContext) {
      const { bot, project } = await this.managedTelegramBot(input, context);
      if (!await this.db("project_telegram_chats").where({ bot_id: bot.id, chat_id: input.chatId }).first())
        throw new AppError("NOT_FOUND", "Chat not bound to this project's bot.");
      const rows = chatRecipients(await this.db("telegram_chat_mentions").where({ bot_id: bot.id, chat_id: input.chatId }));
      const members = await activeProjectUsers(this.db, project.id, project.ownerUserId).select("u.id", "u.email");
      const identities = await this.db("telegram_identities").whereIn("user_id", members.map((m) => m.id));
      const allowed = new Set(members.map((m) => String(m.id)));
      return { ownerUserId: project.ownerUserId, members, availableTags: telegramBotTags(bot.filter_tags), mentions: rows.map((row) => {
        const username = String(row.mention_key).startsWith("username:") ? String(row.mention_key).slice(9) : null;
        const recipient = resolveTelegramRecipient(String(row.mention_key), username, rows, identities, allowed, String(project.ownerUserId));
        return { key: row.mention_key, label: row.label, sourceType: row.source_type ?? "mention", mappingConflict: Boolean(row.mapping_conflict), tags: telegramBotTags(row.assignment_tags), userId: row.user_id ?? null,
          effectiveUserId: recipient.userId, resolution: recipient.resolution, lastSeenAt: dateStringOrNull(row.last_seen_at) };
      }) };
    }

    protected async setProjectTelegramChatMention(input: Row, context: NormalizedGatewayRequestContext) {
      const { bot, project } = await this.managedTelegramBot(input, context);
      await this.db.transaction(async (trx) => {
        // Same bot lock as ingestion/import/unlink: changes cannot race task creation.
        const currentBot = await trx("project_telegram_bots").where({ id: bot.id, project_id: project.id }).forUpdate().first();
        if (!currentBot) throw new AppError("NOT_FOUND", "Bot not found in this project.");
        if (!await trx("project_telegram_chats").where({ bot_id: bot.id, chat_id: input.chatId }).first())
          throw new AppError("NOT_FOUND", "Chat not bound to this project's bot.");
        if (input.userId && !await activeProjectUsers(trx, project.id, project.ownerUserId).where("u.id", input.userId).first())
          throw new AppError("VALIDATION_ERROR", "Choose an active project member.");
        const key = { bot_id: bot.id, chat_id: input.chatId };
        const current = chatRecipients(await trx("telegram_chat_mentions").where(key)).find((row) => recipientKeys(row).includes(String(input.mentionKey)));
        if (!current) throw new AppError("NOT_FOUND", "Person not observed in this bound chat.");
        if (current.mapping_conflict && input.userId === undefined) throw new AppError("VALIDATION_ERROR", "Choose one participant to resolve conflicting recipient mappings.");
        const update: Row = { user_id: input.userId === undefined ? current.user_id : input.userId, assignment_tags: JSON.stringify(telegramBotTags(current.assignment_tags)) };
        if (input.tags !== undefined) {
          const tags = telegramBotTags(input.tags);
          if (tags.some((tag) => !telegramBotTags(currentBot.filter_tags).includes(tag))) throw new AppError("VALIDATION_ERROR", "Choose routing tags from this bot's configured tags.");
          const recipientId = input.userId === undefined ? current.user_id : input.userId;
          if (tags.length && (!recipientId || !await activeProjectUsers(trx, project.id, project.ownerUserId).where("u.id", recipientId).first()))
            throw new AppError("VALIDATION_ERROR", "Map this person to an active project participant before choosing routing tags.");
          update.assignment_tags = JSON.stringify(tags);
        }
        if (input.userId === null) update.assignment_tags = "[]";
        await trx("telegram_chat_mentions").where(key).whereIn("mention_key", recipientKeys(current)).update(update);
      });
      await this.recordEventForProject(project.id, { type: "project.telegram_mention_mapped", title: "Telegram recipient settings updated", related_id: project.id }, context);
      return { saved: true };
    }

    protected async addProjectTelegramBot(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      const token = String(input.token);
      const api = projectTelegramApi(token);
      let me;
      try { me = await api.getMe(); }
      catch { throw new AppError("GATEWAY_ERROR", "Could not verify Telegram bot token. Check the token and Telegram connectivity."); }
      if (!me.is_bot || !me.username) throw new AppError("VALIDATION_ERROR", "A Telegram bot with a username is required.");
      if (String(me.id) === telegramBotToken()?.split(":")[0]) throw new AppError("VALIDATION_ERROR", "Use a dedicated project bot; the Marrow notification bot is reserved.");
      const existing = await this.db("project_telegram_bots").where({ telegram_bot_id: String(me.id) }).first();
      if (existing && existing.project_id !== project.id) throw new AppError("VALIDATION_ERROR", "This Telegram bot is already attached to another project.");
      const id = existing?.id ?? randomUUID();
      let remote;
      try { remote = await api.getWebhookInfo(); }
      catch { throw new AppError("GATEWAY_ERROR", "Could not check the Telegram bot webhook."); }
      if (remote.url) throw new AppError("VALIDATION_ERROR", "This bot already has a webhook. Remove it in its current application before using Marrow polling.");
      const now = nowIso();
      // Encrypt before the first write; never store plaintext on bad config.
      const tokenEnc = encryptBotSecret(token);
      const inserted = await this.db("project_telegram_bots").insert({ id, project_id: project.id, telegram_bot_id: String(me.id),
        username: me.username, filter_tags: JSON.stringify(telegramBotTags(input.tags)), token_enc: tokenEnc, poll_revision: randomUUID(),
        enabled: false, created_at: now, updated_at: now }).onConflict("telegram_bot_id").ignore().returning("id");
      if (!inserted.length) {
        const stored = await this.db("project_telegram_bots").where({ telegram_bot_id: String(me.id) }).first();
        if (!stored || stored.project_id !== project.id || stored.id !== id) throw new AppError("VALIDATION_ERROR", "This Telegram bot was attached elsewhere. Refresh and retry.");
        await this.db("project_telegram_bots").where({ id, project_id: project.id }).update({ token_enc: tokenEnc, username: me.username, filter_tags: JSON.stringify(telegramBotTags(input.tags)), updated_at: now });
      }
      return this.configureProjectTelegramBot({ ...input, id }, context, "connect");
    }

    protected async configureProjectTelegramBot(input: Row, context: NormalizedGatewayRequestContext, action: "connect" | "disconnect" | "remove") {
      const project = await this.managedTelegramProject(input, context);
      const row = await this.db.transaction(async (trx) => {
        const bot = await trx("project_telegram_bots").where({ id: input.id, project_id: project.id }).forUpdate().first();
        if (!bot) throw new AppError("NOT_FOUND", "Bot not found in this project.");
        let pollError: string | null = null;
        if (action === "connect") {
          try {
            const api = projectTelegramApi(decryptBotSecret(String(bot.token_enc)));
            const me = await api.getMe();
            if (String(me.id) !== String(bot.telegram_bot_id)) throw new Error("Bot token identity changed");
            const current = await api.getWebhookInfo();
            if (current.url) pollError = "TELEGRAM_WEBHOOK_PRESENT";
          } catch { pollError = "TELEGRAM_CONNECT_FAILED"; }
        }
        // Disable/remove are local operations and work during a Telegram
        // outage. Revision changes fence and cancel the previous poller.
        if (action === "remove") { await trx("project_telegram_bots").where({ id: bot.id }).del(); return null; }
        const [updated] = await trx("project_telegram_bots").where({ id: bot.id }).update({ enabled: action === "connect" && !pollError,
          poll_error: pollError, poll_revision: randomUUID(), poll_retry_at: null,
          ...(action === "connect" ? { last_polled_at: null } : {}),
          ...(action !== "connect" ? { link_code_hash: null, link_code_expires_at: null } : {}), updated_at: nowIso() }).returning("*");
        return updated;
      });
      await this.recordEventForProject(project.id, { type: `project.telegram_bot_${action}`, title: `Telegram bot ${action}`, related_id: project.id }, context);
      return row ? this.telegramBotOut(row) : { removed: true };
    }

    protected async projectTelegramBotLinkCode(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      const code = randomBytes(24).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
      const rows = await this.db("project_telegram_bots").where({ id: input.id, project_id: project.id, enabled: true })
        .update({ link_code_hash: linkCodeHash(code), link_code_expires_at: expiresAt }).returning("username");
      if (!rows.length) throw new AppError("VALIDATION_ERROR", "Connect this project's bot before generating a chat link key.");
      return { command: `/marrow_link@${rows[0].username} ${code}`, expiresAt };
    }

    protected async setProjectTelegramBotTags(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      const rows = await this.db("project_telegram_bots").where({ id: input.id, project_id: project.id })
        .update({ filter_tags: JSON.stringify(telegramBotTags(input.tags)), updated_at: nowIso() }).returning("*");
      if (!rows.length) throw new AppError("NOT_FOUND", "Bot not found in this project.");
      return this.telegramBotOut(rows[0]);
    }

    protected async unlinkProjectTelegramChat(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      await this.db.transaction(async (trx) => {
        const bot = await trx("project_telegram_bots").where({ id: input.id, project_id: project.id }).forUpdate().first();
        if (!bot) throw new AppError("NOT_FOUND", "Bot not found in this project.");
        await trx("project_telegram_chats").where({ bot_id: bot.id, chat_id: input.chatId }).del();
        const now = nowIso();
        const ignored = await trx("telegram_message_inbox").where({ bot_id: bot.id, chat_id: input.chatId }).whereIn("status", ["pending", "processing", "failed"])
          .update({ status: "ignored", locked_until: null, result_reason: "chat_unlinked", processed_at: now }).returning("id");
        if (ignored.length) await trx("project_telegram_bots").where({ id: bot.id })
          .update({ processed_count: trx.raw("processed_count + ?", [ignored.length]), last_processed_at: now });
      });
      return { removed: true };
    }

    protected async retryProjectTelegramImports(input: Row, context: NormalizedGatewayRequestContext) {
      const project = await this.managedTelegramProject(input, context);
      if (!await this.db("project_telegram_bots").where({ id: input.id, project_id: project.id }).first()) throw new AppError("NOT_FOUND", "Bot not found in this project.");
      const retried = await this.db("telegram_message_inbox").where({ bot_id: input.id, status: "failed" })
        .update({ status: "pending", attempts: 0, available_at: nowIso(), locked_until: null, last_error: null });
      return { retried };
    }
  };
}
