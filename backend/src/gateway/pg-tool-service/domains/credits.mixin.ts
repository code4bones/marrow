import { AppError } from "../../../shared/errors.js";
import { createCreditsFacade } from "../../credits.js";
import { boundedInteger } from "../formatters/common.js";
import { creditTransactionOut, leaderboardEntryOut, walletBalanceOut } from "../formatters/credits.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

// D-MEMORY-037 / T-MEMORY-068: read-only credits tools. Write paths
// (award/spend/admin_adjust) stay behind CreditsFacade calls from the
// mixins/facades that actually cause them (auth.ts's signup bonus,
// tasks.mixin.ts's completion/penalty hooks, credit.spend in a later
// task) -- this mixin only ever reads wallets/credit_transactions/streaks.
export function CreditsMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  protected resolveCreditUserId(input: Row, context: NormalizedGatewayRequestContext): string {
    const requested = typeof input.userId === "string" && input.userId.length > 0 ? input.userId : null;
    const userId = requested ?? context.sessionUserId;
    if (!userId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "No userId given and no logged-in session to default to -- pass userId explicitly."
      );
    }
    return userId;
  }

  protected async creditBalance(input: Row, context: NormalizedGatewayRequestContext) {
    const userId = this.resolveCreditUserId(input, context);
    const credits = createCreditsFacade(this.db);
    const wallet = await credits.getWallet(userId);
    const streak = await this.db("streaks").where({ user_id: userId }).first();
    return walletBalanceOut({
      user_id: userId,
      balance: wallet.balance,
      current_streak: streak?.current_streak,
      longest_streak: streak?.longest_streak,
      insurance_banked: streak?.insurance_banked,
      last_credited_date: streak?.last_credited_date
    } as Row);
  }

  protected async creditHistory(input: Row, context: NormalizedGatewayRequestContext) {
    const userId = this.resolveCreditUserId(input, context);
    let query = this.db("credit_transactions").where({ user_id: userId });
    if (input.projectId) {
      query = query.andWhere("project_id", String(input.projectId));
    }
    if (input.reason) {
      query = query.andWhere("reason", String(input.reason));
    }
    const limit = boundedInteger(input.limit, 50, 1, 200);
    const offset = boundedInteger(input.offset, 0, 0, 1_000_000);
    const rows = (await query.orderBy("created_at", "desc").limit(limit).offset(offset)) as Row[];
    return rows.map(creditTransactionOut);
  }

  protected async creditLeaderboard(input: Row) {
    const limit = boundedInteger(input.limit, 20, 1, 100);
    const rows = (await this.db("wallets")
      .join("users", "users.id", "wallets.user_id")
      .leftJoin("streaks", "streaks.user_id", "wallets.user_id")
      .select(
        "wallets.user_id as user_id",
        "wallets.balance as balance",
        "users.email as email",
        "streaks.current_streak as current_streak",
        "streaks.longest_streak as longest_streak"
      )
      .orderBy("wallets.balance", "desc")
      .limit(limit)) as Row[];
    return rows.map(leaderboardEntryOut);
  }
  };
}
