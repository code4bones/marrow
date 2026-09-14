import { randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

// "Ask Marrow" conversation history (owner's request, 2026-09-14). The
// loop itself (askMarrow) is NOT here -- it needs `this.call(...)`, which
// only exists on PgToolService (added on top of the whole composed mixin
// chain in service.ts, same reason artifactDownload/gitJobArtifactsDownload
// are public methods on PgToolService rather than mixin methods). This
// mixin only holds the pieces that don't need that: session gating and
// persisted-history CRUD.
export function AiChatMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  // Deliberately its own name -- see ai-providers.mixin.ts's identical
  // reasoning on requireProviderReaderIdentity; never reuse
  // requireSessionUserId/requireGitCredentialSession/requireEnvVariableOwner/
  // requireProviderReaderIdentity across mixins (I-MEMORY-133).
  protected requireChatSession(context: NormalizedGatewayRequestContext): string {
    if (!context.sessionUserId) {
      throw new AppError(
        "UNAUTHORIZED",
        "Ask Marrow requires an authenticated identity (a session, OAuth connector, or personal API token)."
      );
    }
    return context.sessionUserId;
  }

  protected async appendChatTurn(userId: string, userMessage: string, assistantMessage: string): Promise<{ createdAt: string }> {
    const userCreatedAt = nowIso();
    const assistantCreatedAt = nowIso();
    await this.db("ai_chat_messages").insert([
      { id: randomUUID(), user_id: userId, role: "user", content: userMessage, created_at: userCreatedAt },
      { id: randomUUID(), user_id: userId, role: "assistant", content: assistantMessage, created_at: assistantCreatedAt }
    ]);
    return { createdAt: assistantCreatedAt };
  }

  protected async recentChatHistory(userId: string, limit: number): Promise<Row[]> {
    return this.db("ai_chat_messages").where({ user_id: userId }).orderBy("created_at", "asc").limit(limit);
  }

  protected async listConversation(context: NormalizedGatewayRequestContext) {
    const userId = this.requireChatSession(context);
    const rows = await this.db("ai_chat_messages").where({ user_id: userId }).orderBy("created_at", "asc");
    return {
      messages: rows.map((row) => ({
        role: row.role as "user" | "assistant",
        content: String(row.content),
        createdAt: row.created_at
      }))
    };
  }

  protected async clearConversation(context: NormalizedGatewayRequestContext) {
    const userId = this.requireChatSession(context);
    await this.db("ai_chat_messages").where({ user_id: userId }).del();
    return { cleared: true as const };
  }
  };
}
