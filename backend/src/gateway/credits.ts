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

export type CreditsFacade = ReturnType<typeof createCreditsFacade>;

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

  return { award, spend, grantSignupBonus, getWallet };
}
