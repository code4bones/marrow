import { nowIso } from "../shared/dates.js";
import { AppError, toAppError } from "../shared/errors.js";
import type { AppLogger } from "../shared/logging/logger.js";
import { telegramBotToken, telegramClientOptions } from "./telegram.js";
import { createAuthFacade } from "./auth.js";
import type { Knex } from "knex";
import { Bot } from "grammy";

export interface TelegramBotHandle {
  stop(): Promise<void>;
}

// T-MEMORY-101: our own generated codes are TELEGRAM_LINK_CODE_LENGTH (6)
// characters from a fixed alphabet (auth.ts) -- this is just a cheap filter
// so ordinary conversational messages ("hi", long sentences) never even hit
// the DB as a code-lookup attempt. A false-positive shape match still just
// fails to find a row and falls through to the normal reply below.
const LOOKS_LIKE_LINK_CODE = /^[A-Z0-9]{4,10}$/i;

// T-MEMORY-093: pure announcer, no commands/management -- a single
// catch-all message handler that only ever does one of three things:
// (T-MEMORY-101) consume a code-linking attempt, record that this
// telegram_id has now opened a chat with the bot (which is what makes
// notifyTelegram's sendMessage calls actually deliverable -- Telegram
// forbids a bot from messaging someone who has never done this), or point
// an unlinked sender at the profile page. Optional: returns null if
// TELEGRAM_BOT_TOKEN isn't configured, same "feature absent, not broken"
// convention as oauth/token in gateway.ts's main().
export async function startTelegramBot(db: Knex, logger: AppLogger): Promise<TelegramBotHandle | null> {
  const token = telegramBotToken();
  if (!token) {
    return null;
  }

  const bot = new Bot(token, { client: telegramClientOptions() });
  const auth = createAuthFacade(db);

  bot.on("message", async (ctx) => {
    const telegramId = String(ctx.from.id);
    const username = ctx.from.username ?? null;
    const firstName = ctx.from.first_name ?? null;
    const text = ctx.message.text?.trim();
    try {
      if (text && LOOKS_LIKE_LINK_CODE.test(text)) {
        try {
          const result = await auth.consumeTelegramLinkCode(text, telegramId, username, firstName);
          if (result.ok) {
            await ctx.reply("✅ Marrow: аккаунт привязан — сюда будут дублироваться уведомления, адресованные вам.");
            return;
          }
        } catch (error) {
          if (error instanceof AppError && error.code === "VALIDATION_ERROR") {
            await ctx.reply(`⚠️ ${error.message}`);
            return;
          }
          throw error;
        }
        // Not a valid/unexpired code -- fall through to the normal reply
        // below, same as any other message from this sender would get.
      }

      const identity = await db("telegram_identities").where({ telegram_id: telegramId }).first();
      if (!identity) {
        await ctx.reply(
          "Вы ещё не привязали аккаунт Marrow — сделайте это на странице профиля (Profile → Telegram): войдите через Telegram или отправьте сюда код со страницы профиля."
        );
        return;
      }
      if (!identity.chat_started_at) {
        await db("telegram_identities").where({ telegram_id: telegramId }).update({ chat_started_at: nowIso() });
        await ctx.reply("Marrow: подключено ✅ — сюда будут дублироваться уведомления, адресованные вам.");
      }
    } catch (error) {
      logger.warn({ error: toAppError(error).message, telegramId }, "telegram bot message handler failed");
    }
  });

  bot.catch((error) => {
    logger.warn({ error: error.message }, "telegram bot polling error");
  });

  await new Promise<void>((resolve, reject) => {
    bot
      .start({
        onStart: () => {
          logger.info({ botUsername: bot.botInfo?.username }, "telegram bot polling started");
          resolve();
        }
      })
      .catch((error: unknown) => reject(new AppError("GATEWAY_ERROR", toAppError(error).message)));
  });

  return {
    async stop() {
      await bot.stop();
    }
  };
}
