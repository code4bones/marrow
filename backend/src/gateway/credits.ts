import { randomUUID } from "node:crypto";
import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";

// D-MEMORY-037: credits economy. wallets.balance is a cache kept in sync
// with credit_transactions inside the same DB transaction as every ledger
// write -- callers never update one without the other. Lives alongside
// auth.ts rather than under src/features/ because wallets/credits are keyed
// on the hosted-gateway-only `users` table, same as auth/oauth/git
// credentials -- there is no local-first (SQLite) counterpart.
export const CREDIT_REASONS = [
  "signup_bonus",
  "task_completed",
  "task_reopened_penalty",
  "task_cancelled_penalty",
  "failed_attempt_penalty",
  "decision_accepted_bonus",
  "fault_fixed_bonus",
  "streak_bonus",
  "spend_priority_boost",
  "spend_cosmetic_unlock",
  "spend_streak_insurance",
  "wager_stake",
  "wager_payout",
  "wager_refund",
  "admin_adjustment"
] as const;

export type CreditReason = (typeof CREDIT_REASONS)[number];

export const SIGNUP_BONUS_AMOUNT = 1000;
export const TASK_COMPLETED_AWARD = 10;
// Streak-day -> bonus. currentStreak only ever moves by +1 or resets to 1
// (never jumps), so each threshold is crossed at most once per streak run --
// no extra bookkeeping needed to avoid double-firing a bonus.
const STREAK_BONUS_THRESHOLDS: Record<number, number> = { 3: 20, 7: 50, 30: 200 };

export interface CreditTransactionInput {
  userId: string;
  amount: number;
  reason: CreditReason;
  projectId?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
  note?: string | null;
}

export interface CreditTransactionResult {
  id: string;
  balance: number;
}

export interface WalletSnapshot {
  userId: string;
  balance: number;
}

export type CreditExecutor = Knex | Knex.Transaction;

export interface StreakUpdateResult {
  currentStreak: number;
  longestStreak: number;
  insuranceConsumed: boolean;
  streakBonusAwarded: number | null;
}

export type CreditsFacade = ReturnType<typeof createCreditsFacade>;

// A real logged-in session's clientId is "user:<id>" (see http-server.ts's
// context normalization); a static token, agent-only, or anonymous caller's
// clientId never has that shape. Used wherever a credit hook needs to
// attribute a penalty/bonus to a human when there's no sessionUserId to
// hand (e.g. resolving whose task_claims/created_by this is), same
// "user:<id>" convention migration 023 already used to backfill project
// owners.
export function userIdFromClientId(clientId: unknown): string | null {
  return typeof clientId === "string" && clientId.startsWith("user:") ? clientId.slice(5) : null;
}

function isoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnlyUtcMs(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  return Math.round((dateOnlyUtcMs(toDateStr) - dateOnlyUtcMs(fromDateStr)) / 86_400_000);
}

export function createCreditsFacade(db: Knex) {
  // Runs the ledger insert + balance update as one atomic step. `exec` may
  // be the top-level `db` (opens a real transaction) or an existing
  // Knex.Transaction from a caller's own write (e.g. task.complete) -- knex
  // opens a savepoint in the latter case, so this composes safely either
  // way without the caller needing to know which.
  async function writeTransaction(
    exec: CreditExecutor,
    input: CreditTransactionInput
  ): Promise<CreditTransactionResult> {
    return exec.transaction(async (trx) => {
      const now = new Date();
      await trx("wallets")
        .insert({ user_id: input.userId, balance: 0, updated_at: now })
        .onConflict("user_id")
        .ignore();

      const [wallet] = await trx("wallets")
        .where({ user_id: input.userId })
        .update({ balance: trx.raw("balance + ?", [input.amount]), updated_at: now })
        .returning(["balance"]);

      const id = randomUUID();
      await trx("credit_transactions").insert({
        id,
        user_id: input.userId,
        project_id: input.projectId ?? null,
        amount: input.amount,
        balance_after: wallet.balance,
        reason: input.reason,
        related_type: input.relatedType ?? null,
        related_id: input.relatedId ?? null,
        note: input.note ?? null,
        created_at: now
      });

      return { id, balance: Number(wallet.balance) };
    });
  }

  // Earns and penalties: never blocked on balance (a penalty must always
  // apply even if it drives the balance negative -- that's the point).
  async function award(exec: CreditExecutor, input: CreditTransactionInput): Promise<CreditTransactionResult> {
    return writeTransaction(exec, input);
  }

  // A user-chosen spend: rejected up front if it would take the balance
  // below zero, so nothing partial gets written.
  async function spend(exec: CreditExecutor, input: CreditTransactionInput): Promise<CreditTransactionResult> {
    if (input.amount >= 0) {
      throw new AppError("VALIDATION_ERROR", "spend() requires a negative amount.");
    }
    return exec.transaction(async (trx) => {
      const wallet = await trx("wallets").where({ user_id: input.userId }).first();
      const balance = wallet ? Number(wallet.balance) : 0;
      if (balance + input.amount < 0) {
        throw new AppError("INSUFFICIENT_CREDITS", "Not enough credits for this.", {
          userId: input.userId,
          balance,
          requested: -input.amount
        });
      }
      return writeTransaction(trx, input);
    });
  }

  async function grantSignupBonus(exec: CreditExecutor, userId: string): Promise<CreditTransactionResult> {
    return award(exec, { userId, amount: SIGNUP_BONUS_AMOUNT, reason: "signup_bonus" });
  }

  async function getWallet(userId: string): Promise<WalletSnapshot> {
    const wallet = await db("wallets").where({ user_id: userId }).first();
    return { userId, balance: wallet ? Number(wallet.balance) : 0 };
  }

  // Streak day = "at least one task.complete credited today". Multiple
  // completions on the same day never double-increment (last_credited_date
  // already == today is a no-op). A gap of exactly one day extends the
  // streak; a bigger gap resets it to 1 unless insurance_banked covers the
  // gap, in which case one insurance charge is spent and the streak
  // continues as if the gap were a single day.
  async function updateStreak(exec: CreditExecutor, userId: string): Promise<StreakUpdateResult> {
    return exec.transaction(async (trx) => {
      const now = new Date();
      const today = isoDateOnly(now);
      await trx("streaks")
        .insert({ user_id: userId, current_streak: 0, longest_streak: 0, insurance_banked: 0, updated_at: now })
        .onConflict("user_id")
        .ignore();
      const streak = await trx("streaks").where({ user_id: userId }).first();

      // last_credited_date comes back as a raw "YYYY-MM-DD" string (see
      // shared/pg/knex.ts's DATE type-parser override) -- never re-wrap it
      // in `new Date(...)`, which reintroduces the local-timezone shift
      // that override exists to avoid.
      const lastDate = typeof streak.last_credited_date === "string" ? streak.last_credited_date : null;
      let currentStreak = Number(streak.current_streak ?? 0);
      let insuranceBanked = Number(streak.insurance_banked ?? 0);
      let insuranceConsumed = false;
      let alreadyCreditedToday = false;

      if (lastDate === today) {
        alreadyCreditedToday = true;
      } else {
        const gap = lastDate ? daysBetween(lastDate, today) : null;
        if (gap === null || gap === 1) {
          currentStreak += 1;
        } else if (gap > 1 && insuranceBanked > 0) {
          insuranceBanked -= 1;
          insuranceConsumed = true;
          currentStreak += 1;
        } else {
          currentStreak = 1;
        }
      }
      const longestStreak = Math.max(Number(streak.longest_streak ?? 0), currentStreak);

      await trx("streaks").where({ user_id: userId }).update({
        current_streak: currentStreak,
        longest_streak: longestStreak,
        insurance_banked: insuranceBanked,
        last_credited_date: today,
        updated_at: now
      });

      let streakBonusAwarded: number | null = null;
      const bonus = STREAK_BONUS_THRESHOLDS[currentStreak];
      if (!alreadyCreditedToday && bonus) {
        await writeTransaction(trx, {
          userId,
          amount: bonus,
          reason: "streak_bonus",
          note: `${currentStreak}-day streak`
        });
        streakBonusAwarded = bonus;
      }

      return { currentStreak, longestStreak, insuranceConsumed, streakBonusAwarded };
    });
  }

  async function awardTaskCompletion(
    exec: CreditExecutor,
    userId: string,
    opts: { projectId?: string | null; taskId?: string | null } = {}
  ): Promise<{ award: CreditTransactionResult; streak: StreakUpdateResult }> {
    return exec.transaction(async (trx) => {
      const awardResult = await writeTransaction(trx, {
        userId,
        amount: TASK_COMPLETED_AWARD,
        reason: "task_completed",
        projectId: opts.projectId ?? null,
        relatedType: "task",
        relatedId: opts.taskId ?? null
      });
      const streak = await updateStreak(trx, userId);
      return { award: awardResult, streak };
    });
  }

  return { award, spend, grantSignupBonus, getWallet, updateStreak, awardTaskCompletion };
}
