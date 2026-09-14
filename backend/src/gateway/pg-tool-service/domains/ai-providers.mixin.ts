import { randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { decryptProviderKey, encryptProviderKey } from "../../ai-provider-credentials.js";
import { PROVIDERS, type ProviderId } from "../../llm-providers/index.js";
import { aiProviderCredentialOut } from "../formatters/ai-providers.js";
import { stringOrNull } from "../formatters/common.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

const VALID_PROVIDERS: ProviderId[] = ["claude", "codex", "deepseek"];

// "Ask Marrow" AI provider credentials (owner's request, 2026-09-14),
// modeled directly on GitCredentialsMixin -- a per-user LIST of provider
// credential rows (provider + optional pinned model + encrypted key + a
// default flag), not a single settings form (owner's explicit correction
// to an earlier draft of this design that tried to fold this into
// EnvironmentVariablesMixin + UserPrefsMixin instead).
export function AiProvidersMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  // Mirrors GitCredentialsMixin's requireGitCredentialSession exactly --
  // a raw provider API key (real money, a real external account) should
  // only ever be minted or destroyed through the trusted browser UI, same
  // reasoning as a git host PAT. Deliberately its own name (never
  // requireSessionUserId, requireGitCredentialSession, or
  // requireEnvVariableOwner) -- see I-MEMORY-133 for why a same-named
  // protected method on a differently-composed mixin is a real risk, not
  // pedantry.
  protected requireProviderCredentialSession(context: NormalizedGatewayRequestContext): string {
    if (!context.sessionUserId || context.sessionSource !== "cookie") {
      throw new AppError(
        "UNAUTHORIZED",
        "AI provider credentials require a logged-in session (no static token, OAuth connector, personal API token, or anonymous caller can manage them)."
      );
    }
    return context.sessionUserId;
  }

  // Broader gate for read-only / non-secret-touching actions (list,
  // partial update of label/model/is_default -- never the key itself) --
  // any authenticated identity acting as itself. Deliberately its own
  // name, not shared with ai-chat.mixin.ts's requireChatSession even
  // though the check is identical -- same collision-avoidance discipline.
  protected requireProviderReaderIdentity(context: NormalizedGatewayRequestContext): string {
    if (!context.sessionUserId) {
      throw new AppError(
        "UNAUTHORIZED",
        "AI provider credentials require an authenticated identity (a session, OAuth connector, or personal API token)."
      );
    }
    return context.sessionUserId;
  }

  private validateProvider(provider: unknown): ProviderId {
    const value = String(provider ?? "");
    if (!VALID_PROVIDERS.includes(value as ProviderId)) {
      throw new AppError("VALIDATION_ERROR", `provider must be one of: ${VALID_PROVIDERS.join(", ")}.`);
    }
    return value as ProviderId;
  }

  protected async createProviderCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireProviderCredentialSession(context);
    const provider = this.validateProvider(input.provider);
    const now = nowIso();
    const row = {
      id: randomUUID(),
      owner_user_id: ownerUserId,
      provider,
      label: String(input.label),
      model: stringOrNull(input.model),
      api_key_enc: encryptProviderKey(String(input.apiKey)),
      is_default: input.isDefault === true,
      created_at: now,
      updated_at: now
    };
    if (row.is_default) {
      await this.db.transaction(async (trx) => {
        await trx("ai_provider_credentials").where({ owner_user_id: ownerUserId }).update({ is_default: false });
        await trx("ai_provider_credentials").insert(row);
      });
    } else {
      await this.db("ai_provider_credentials").insert(row);
    }
    await this.recordEventForProject(null, {
      type: "ai_provider_credential.created",
      title: `AI provider credential added: ${provider} (${row.label})`,
      related_id: row.id
    }, context);
    return aiProviderCredentialOut(row);
  }

  protected async listProviderCredentials(context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireProviderReaderIdentity(context);
    const rows = await this.db("ai_provider_credentials")
      .where({ owner_user_id: ownerUserId })
      .orderBy("created_at", "desc");
    return rows.map((row) => aiProviderCredentialOut(row, { includeHint: true }));
  }

  protected async updateProviderCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireProviderReaderIdentity(context);
    const id = String(input.id);
    const existing = await this.db("ai_provider_credentials").where({ id, owner_user_id: ownerUserId }).first();
    if (!existing) {
      throw new AppError("AI_PROVIDER_NOT_FOUND", `AI provider credential ${id} does not exist.`, { id });
    }
    const patch: Row = { updated_at: nowIso() };
    if (typeof input.label === "string") {
      patch.label = input.label;
    }
    if (input.model !== undefined) {
      patch.model = stringOrNull(input.model);
    }
    const makeDefault = input.isDefault === true;
    let row: Row;
    if (makeDefault) {
      [row] = await this.db.transaction(async (trx) => {
        await trx("ai_provider_credentials").where({ owner_user_id: ownerUserId }).update({ is_default: false });
        return trx("ai_provider_credentials").where({ id }).update({ ...patch, is_default: true }).returning("*");
      });
    } else {
      [row] = await this.db("ai_provider_credentials").where({ id }).update(patch).returning("*");
    }
    return aiProviderCredentialOut(row, { includeHint: true });
  }

  protected async deleteProviderCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireProviderCredentialSession(context);
    const id = String(input.id);
    // Ownership enforced in the WHERE clause, not checked-then-deleted --
    // same not-found-not-forbidden convention as deleteGitCredential.
    const deletedCount = await this.db("ai_provider_credentials")
      .where({ id, owner_user_id: ownerUserId })
      .del();
    if (deletedCount === 0) {
      throw new AppError("AI_PROVIDER_NOT_FOUND", `AI provider credential ${id} does not exist.`, { id });
    }
    await this.recordEventForProject(null, {
      type: "ai_provider_credential.deleted",
      title: `AI provider credential deleted: ${id}`,
      related_id: id
    }, context);
    return { deleted: true as const };
  }

  // Shared by ai-chat.mixin.ts's askMarrow -- the caller's is_default=true
  // row, decrypted, or a clear AI_PROVIDER_REQUIRED error. Protected so a
  // sibling mixin composed at the same level in service.ts's chain can
  // call it directly (same cross-mixin pattern as
  // resolveGitCredentialToken/resolveProject elsewhere in this codebase).
  protected async resolveDefaultProviderCredential(
    context: NormalizedGatewayRequestContext
  ): Promise<{ id: string; provider: ProviderId; model: string | null; apiKey: string }> {
    const ownerUserId = this.requireProviderReaderIdentity(context);
    const row = await this.db("ai_provider_credentials")
      .where({ owner_user_id: ownerUserId, is_default: true })
      .first();
    if (!row) {
      throw new AppError(
        "AI_PROVIDER_REQUIRED",
        "No default AI provider configured -- add one and mark it default in your profile first."
      );
    }
    return {
      id: String(row.id),
      provider: row.provider as ProviderId,
      model: row.model ? String(row.model) : null,
      apiKey: decryptProviderKey(String(row.api_key_enc))
    };
  }

  protected async availableModels(input: Row, context: NormalizedGatewayRequestContext) {
    this.requireProviderReaderIdentity(context);
    const provider = this.validateProvider(input.provider);
    const llmProvider = PROVIDERS[provider];
    if (!llmProvider) {
      throw new AppError("VALIDATION_ERROR", `Provider "${provider}" isn't wired up yet -- deepseek is the only supported provider right now.`);
    }
    // Pre-save flow: the caller pastes a fresh key into the create form
    // and wants to see its models BEFORE saving anything. Post-save flow:
    // no apiKey given -- resolve an existing stored credential for this
    // provider instead.
    let apiKey: string;
    if (typeof input.apiKey === "string" && input.apiKey.length > 0) {
      apiKey = input.apiKey;
    } else {
      const ownerUserId = this.requireProviderReaderIdentity(context);
      const existing = await this.db("ai_provider_credentials")
        .where({ owner_user_id: ownerUserId, provider })
        .orderBy("created_at", "desc")
        .first();
      if (!existing) {
        throw new AppError("AI_PROVIDER_REQUIRED", `No stored credential for provider "${provider}" -- paste an API key to preview its models first.`);
      }
      apiKey = decryptProviderKey(String(existing.api_key_enc));
    }
    return { models: await llmProvider.listModels({ apiKey, httpFetch: this.llmHttpFetch }) };
  }
  };
}
