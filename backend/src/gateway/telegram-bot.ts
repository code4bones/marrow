import { nowIso } from "../shared/dates.js";
import { AppError, toAppError } from "../shared/errors.js";
import type { AppLogger } from "../shared/logging/logger.js";
import { telegramBotToken, telegramClientOptions } from "./telegram.js";
import type { Knex } from "knex";
import { Bot } from "grammy";

export interface TelegramBotHandle {
  stop(): Promise<void>;
}

// T-MEMORY-093: pure announcer, no commands/management -- a single
// catch-all message handler that only ever does one of two things: record
// that this telegram_id has now opened a chat with the bot (which is what
// makes notifyTelegram's sendMessage calls actually deliverable -- Telegram
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

  bot.on("message", async (ctx) => {
    const telegramId = String(ctx.from.id);
    try {
      const identity = await db("telegram_identities").where({ telegram_id: telegramId }).first();
      if (!identity) {
        await ctx.reply("Вы ещё не привязали аккаунт Marrow — сделайте это на странице профиля (Profile → Telegram).");
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
