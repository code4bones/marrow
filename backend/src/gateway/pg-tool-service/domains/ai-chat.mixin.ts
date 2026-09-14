import { randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { aiChatMessageOut, aiConversationOut } from "../formatters/ai-chat.js";
import { stringOrNull } from "../formatters/common.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

// "Ask Marrow" conversations (owner's request, 2026-09-14; multi-conversation
// follow-up the same day: "забыли про New Chat & Chat List (+ delete
// chat), перед созданием нового чата нужно ввести его название"). A user
// can have many titled conversations, not one continuous thread -- see
// migration 097_ai_chat_conversations.cjs for the backfill that preserved
// the single-thread v1's already-live-tested messages as one "Chat"
// conversation each, rather than dropping real production data.
//
// The loop itself (askMarrow) is NOT here -- it needs `this.call(...)`,
// which only exists on PgToolService (added on top of the whole composed
// mixin chain in service.ts, same reason artifactDownload/
// gitJobArtifactsDownload are public methods on PgToolService rather than
// mixin methods). This mixin only holds session gating and persisted
// conversation/message CRUD.
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

  protected async createConversation(input: Row, context: NormalizedGatewayRequestContext) {
    const userId = this.requireChatSession(context);
    const title = stringOrNull(input.title);
    if (!title) {
      throw new AppError("VALIDATION_ERROR", "title is required.");
    }
    const now = nowIso();
    const row = { id: randomUUID(), user_id: userId, title, created_at: now, updated_at: now };
    await this.db("ai_conversations").insert(row);
    return aiConversationOut(row);
  }

  protected async listConversations(context: NormalizedGatewayRequestContext) {
    const userId = this.requireChatSession(context);
    const rows = await this.db("ai_conversations").where({ user_id: userId }).orderBy("updated_at", "desc");
    return { conversations: rows.map(aiConversationOut) };
  }

  protected async renameConversation(input: Row, context: NormalizedGatewayRequestContext) {
    const conversation = await this.resolveOwnedConversation(String(input.id), context);
    const title = stringOrNull(input.title);
    if (!title) {
      throw new AppError("VALIDATION_ERROR", "title is required.");
    }
    const [row] = await this.db("ai_conversations")
      .where({ id: conversation.id })
      .update({ title, updated_at: nowIso() })
      .returning("*");
    return aiConversationOut(row);
  }

  protected async deleteConversation(input: Row, context: NormalizedGatewayRequestContext) {
    const conversation = await this.resolveOwnedConversation(String(input.id), context);
    // ai_chat_messages.conversation_id has ON DELETE CASCADE
    // (097_ai_chat_conversations.cjs) -- deleting the conversation row
    // deletes its messages too, no separate cleanup needed.
    await this.db("ai_conversations").where({ id: conversation.id }).del();
    return { deleted: true as const };
  }

  protected async conversationMessages(input: Row, context: NormalizedGatewayRequestContext) {
    const conversation = await this.resolveOwnedConversation(String(input.id), context);
    const rows = await this.db("ai_chat_messages").where({ conversation_id: conversation.id }).orderBy("created_at", "asc");
    return { messages: rows.map(aiChatMessageOut) };
  }

  // Ownership-checked lookup, shared by every conversation-scoped method
  // above and by askMarrow (service.ts) -- not-found-not-forbidden
  // convention (a conversation belonging to a different user is
  // indistinguishable from one that doesn't exist), same as
  // deleteGitCredential/resolveDefaultProviderCredential elsewhere in this
  // codebase. Protected so PgToolService's own askMarrow (which needs
  // `this.call`, so it can't live in this mixin -- see the file header
  // comment) can call it directly, same cross-mixin-to-outer-class pattern
  // as gitJobArtifactsDownload.
  protected async resolveOwnedConversation(id: string, context: NormalizedGatewayRequestContext): Promise<Row> {
    const userId = this.requireChatSession(context);
    const row = await this.db("ai_conversations").where({ id, user_id: userId }).first();
    if (!row) {
      throw new AppError("AI_CONVERSATION_NOT_FOUND", `Conversation ${id} does not exist.`, { id });
    }
    return row;
  }

  protected async recentChatHistory(conversationId: string, limit: number): Promise<Row[]> {
    return this.db("ai_chat_messages").where({ conversation_id: conversationId }).orderBy("created_at", "asc").limit(limit);
  }

  protected async appendChatTurn(conversationId: string, userMessage: string, assistantMessage: string): Promise<{ createdAt: string }> {
    const userCreatedAt = nowIso();
    const assistantCreatedAt = nowIso();
    await this.db("ai_chat_messages").insert([
      { id: randomUUID(), conversation_id: conversationId, role: "user", content: userMessage, created_at: userCreatedAt },
      { id: randomUUID(), conversation_id: conversationId, role: "assistant", content: assistantMessage, created_at: assistantCreatedAt }
    ]);
    await this.db("ai_conversations").where({ id: conversationId }).update({ updated_at: assistantCreatedAt });
    return { createdAt: assistantCreatedAt };
  }
  };
}
