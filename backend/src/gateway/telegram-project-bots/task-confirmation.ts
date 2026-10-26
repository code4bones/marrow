import type { Knex } from "knex";
import type { InputRichMessage } from "grammy/types";
import { sendRememberedTelegramReply } from "./outgoing.js";
import { telegramPeopleText, type TelegramPerson } from "./participant-references.js";
import type { Api } from "grammy";
import type { AppLogger } from "../../shared/logging/logger.js";
import { marrowWebUrl } from "../telegram.js";
import type { Row } from "../pg-tool-service/types.js";
import { telegramRequest } from "./request.js";
import { decryptBotSecret, projectTelegramApi } from "./remote.js";

export interface TelegramTaskConfirmation {
  chatId: string; messageId: number; messageThreadId?: number;
  taskId: string; title: string; projectSlug: string; assignees: TelegramPerson[];
}

export async function sendTaskConfirmation(api: Pick<Api, "sendRichMessage">, confirmation: TelegramTaskConfirmation, db?: Knex, botId?: string): Promise<void> {
  const webUrl = marrowWebUrl();
  if (!webUrl) throw new Error("Marrow web URL is not configured");
  const url = `${webUrl}/projects/${encodeURIComponent(confirmation.projectSlug)}/tasks/${encodeURIComponent(confirmation.taskId)}`;
  const rich: InputRichMessage = { blocks: [
    { type: "heading", size: 3, text: "✅ Задача создана" },
    { type: "paragraph", text: `${confirmation.taskId}: ${confirmation.title}` },
    { type: "paragraph", text: [ `${confirmation.assignees.length > 1 ? "Исполнители" : "Исполнитель"}: `, telegramPeopleText(confirmation.assignees) ] },
    { type: "paragraph", text: { type: "url", text: "Открыть задачу в Marrow →", url } }
  ] };
  const send = () => telegramRequest(undefined, (signal) => api.sendRichMessage(confirmation.chatId, rich, {
    reply_parameters: { message_id: confirmation.messageId, allow_sending_without_reply: true },
    ...(confirmation.messageThreadId !== undefined ? { message_thread_id: confirmation.messageThreadId } : {})
  }, signal));
  if (db && botId) await sendRememberedTelegramReply(db, botId, confirmation.chatId, rich, send);
  else await send();
}

// Errors, including decryption/proxy/grammY errors, remain isolated after commit.
export async function notifyCreatedTelegramTask(bot: Row, confirmation: TelegramTaskConfirmation, logger?: AppLogger, db?: Knex): Promise<void> {
  try { await sendTaskConfirmation(projectTelegramApi(decryptBotSecret(String(bot.token_enc))), confirmation, db, String(bot.id)); }
  catch { logger?.warn({ botId: bot.id, code: "TELEGRAM_TASK_CONFIRMATION_FAILED" }, "Telegram task confirmation failed; task is saved"); }
}
