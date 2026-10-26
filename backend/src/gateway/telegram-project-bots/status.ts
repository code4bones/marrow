import type { Row } from "../pg-tool-service/types.js";

export type TelegramPollingStatus = "inactive" | "starting" | "active" | "error";

export function telegramPollingStatus(bot: Row, now = Date.now()): TelegramPollingStatus {
  if (!bot.enabled) return "inactive";
  if (bot.poll_error) return "error";
  const leaseUntil = bot.poll_lease_until ? new Date(String(bot.poll_lease_until)).getTime() : 0;
  const lastPoll = bot.last_polled_at ? new Date(String(bot.last_polled_at)).getTime() : 0;
  return bot.poll_owner && leaseUntil > now && lastPoll > now - 90_000 ? "active" : "starting";
}
