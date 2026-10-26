import type { Api } from "grammy";
import { telegramRequest } from "./request.js";
import type { AppLogger } from "../../shared/logging/logger.js";

export interface TelegramBindingConfirmation {
  chatId: string;
  messageId: number;
  messageThreadId?: number;
  projectTitle: string;
}

// Best-effort post-commit feedback. Delivery failure must not undo the
// binding, rewind the cursor, or escape into the bot's polling loop.
export async function sendBindingConfirmation(
  api: Pick<Api, "sendRichMessage">,
  confirmation: TelegramBindingConfirmation,
  botId: string,
  signal?: AbortSignal,
  logger?: AppLogger
): Promise<void> {
  if (signal?.aborted) return;
  try {
    await telegramRequest(signal, (apiSignal) => api.sendRichMessage(confirmation.chatId, {
      blocks: [
        { type: "heading", size: 3, text: "✅ Чат привязан к Marrow" },
        { type: "paragraph", text: `Проект: ${confirmation.projectTitle}` }
      ]
    }, {
      reply_parameters: { message_id: confirmation.messageId, allow_sending_without_reply: true },
      ...(confirmation.messageThreadId !== undefined ? { message_thread_id: confirmation.messageThreadId } : {})
    }, apiSignal));
  } catch {
    if (!signal?.aborted) logger?.warn({ botId, code: "TELEGRAM_BIND_CONFIRMATION_FAILED" }, "Telegram binding confirmation failed; binding is saved");
  }
}
