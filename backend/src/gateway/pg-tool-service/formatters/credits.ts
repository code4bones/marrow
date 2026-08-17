import { dateStringOrNull, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function creditTransactionOut(row: Row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    projectId: stringOrNull(row.project_id),
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    reason: String(row.reason),
    relatedType: stringOrNull(row.related_type),
    relatedId: stringOrNull(row.related_id),
    note: stringOrNull(row.note),
    createdAt: dateStringOrNull(row.created_at)
  };
}

export function walletBalanceOut(row: Row) {
  return {
    userId: String(row.user_id),
    balance: Number(row.balance),
    currentStreak: Number(row.current_streak ?? 0),
    longestStreak: Number(row.longest_streak ?? 0),
    insuranceBanked: Number(row.insurance_banked ?? 0),
    lastCreditedDate: dateStringOrNull(row.last_credited_date)
  };
}

export function leaderboardEntryOut(row: Row) {
  return {
    userId: String(row.user_id),
    email: stringOrNull(row.email),
    balance: Number(row.balance),
    currentStreak: Number(row.current_streak ?? 0),
    longestStreak: Number(row.longest_streak ?? 0)
  };
}
