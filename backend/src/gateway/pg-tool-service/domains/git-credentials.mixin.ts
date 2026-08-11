import { randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { decryptGitToken, encryptGitToken, fetchGitlabJobTrace, fetchGitlabPipelineStatus, fetchGitlabRunnersStatus } from "../../git-credentials.js";
import { gitCredentialOut } from "../formatters/git-credentials.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

export function GitCredentialsMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  // T-MEMORY-044: git host credentials + the pipeline-status proxy. Static
  // token and anonymous callers never populate sessionUserId
  // (normalizeContext() below) at all. A personal-API-token bearer
  // (T-MEMORY-047) DOES populate sessionUserId/sessionRole, same as a real
  // browser session -- but management (create/delete, immediately below)
  // additionally requires sessionSource === "cookie", so a personal token
  // still can't manage credentials even though it resolves an owner id; see
  // requireSessionUserId's own comment for why that extra check exists.
  // Since T-MEMORY-052, an OAuth connector's real identity ALSO populates
  // sessionUserId/sessionRole (for project-membership filtering) -- but a
  // git credential can only ever have been created through the trusted
  // browser UI (sessionSource === "cookie"), so an OAuth-authenticated
  // member who has never opened their profile page in a browser has no
  // credential of their own to read; resolveGitCredentialReader below
  // deliberately keeps treating OAuth like "no resolved reader" (falls back
  // to the admin) rather than like a cookie/personal-token session, even
  // though sessionUserId is technically set for it now.
  //
  // Managing the credential itself (create/delete, where a raw secret is
  // typed in or destroyed) stays session-only -- a token should only ever
  // enter the system through the trusted browser profile UI, not be
  // mintable/removable by an agent (including one connected with the same
  // user's own personal token). Using an already-stored credential to
  // answer a read-only question (list which hosts are configured, check a
  // pipeline's status) is different: this is a single-owner/small-team
  // self-host instance, not multi-tenant SaaS, and the whole point of
  // building this was so an agent (Claude Code, an OAuth connector) could
  // check CI status through Marrow instead of the operator SSH-ing in and
  // grepping journalctl by hand. So for the read paths, a caller with no
  // cookie/personal-token identity (static token, OAuth, no auth
  // configured) falls back to the instance's primary admin -- same
  // "earliest-created admin" resolution already used for the static
  // token's own owner_user_id in ensureStaticTokenCredential
  // (T-MEMORY-029). A browser session's or personal token's own user id
  // always takes precedence when present.
  protected requireSessionUserId(context: NormalizedGatewayRequestContext): string {
    // T-MEMORY-047: deliberately checks sessionSource, not just
    // sessionUserId -- a personal-API-token bearer also populates
    // sessionUserId/sessionRole (so scope-tier resolution and
    // project-membership filtering treat it like a session), but a raw git
    // credential must still only ever be typed in or destroyed through the
    // trusted browser profile UI, never by an agent connected with even
    // that user's own personal token. This is the one place that
    // distinction matters; every other sessionUserId consumer in this file
    // does not check sessionSource.
    if (!context.sessionUserId || context.sessionSource !== "cookie") {
      throw new AppError(
        "UNAUTHORIZED",
        "Git credentials require a logged-in session (no static token, OAuth connector, personal API token, or anonymous caller can manage credentials)."
      );
    }
    return context.sessionUserId;
  }

  protected async resolveGitCredentialReader(context: NormalizedGatewayRequestContext): Promise<string> {
    // T-MEMORY-052: sessionSource, not just sessionUserId presence -- an
    // OAuth connector's resolved identity must still fall through to the
    // admin fallback below, same as before that task widened sessionUserId
    // to also cover OAuth for project-membership purposes.
    if (context.sessionUserId && context.sessionSource !== "oauth") {
      return context.sessionUserId;
    }
    const owner = await this.db("users").select("id").where({ role: "admin" }).orderBy("created_at", "asc").first();
    if (!owner) {
      throw new AppError(
        "UNAUTHORIZED",
        "No admin account exists yet to own git credentials -- bootstrap one first."
      );
    }
    return owner.id as string;
  }

  protected async createGitCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireSessionUserId(context);
    const now = nowIso();
    const row = {
      id: randomUUID(),
      owner_user_id: ownerUserId,
      host: String(input.host),
      label: String(input.label),
      token_enc: encryptGitToken(String(input.token)),
      created_at: now,
      updated_at: now,
      last_used_at: null
    };
    await this.db("git_credentials").insert(row);
    await this.recordEventForProject(null, {
      type: "git_credential.created",
      title: `Git credential added: ${row.host} (${row.label})`,
      related_id: row.id
    }, context);
    return gitCredentialOut(row);
  }

  protected async listGitCredentials(context: NormalizedGatewayRequestContext) {
    const ownerUserId = await this.resolveGitCredentialReader(context);
    const rows = await this.db("git_credentials")
      .where({ owner_user_id: ownerUserId })
      .orderBy("created_at", "desc");
    return rows.map((row) => gitCredentialOut(row, { includeHint: true }));
  }

  protected async deleteGitCredential(input: Row, context: NormalizedGatewayRequestContext) {
    const ownerUserId = this.requireSessionUserId(context);
    const id = String(input.id);
    // Ownership is enforced in the WHERE clause, not checked-then-deleted --
    // a credential belonging to a different user is indistinguishable from
    // one that doesn't exist at all, same not-found-not-forbidden
    // convention used elsewhere in this codebase (assertProjectMember, the
    // /auth/login single "Invalid email or password" message).
    const deletedCount = await this.db("git_credentials")
      .where({ id, owner_user_id: ownerUserId })
      .del();
    if (deletedCount === 0) {
      throw new AppError("GIT_CREDENTIAL_NOT_FOUND", `Git credential ${id} does not exist.`, { id });
    }
    await this.recordEventForProject(null, {
      type: "git_credential.deleted",
      title: `Git credential deleted: ${id}`,
      related_id: id
    }, context);
    return { deleted: true as const };
  }

  // Shared by gitPipelineStatus and gitJobTrace below -- resolves and
  // decrypts the caller's stored credential for `host`, or fails clearly
  // if none exists. Most recently created credential wins when more than
  // one row exists for this (owner, host) pair (e.g. mid-rotation) -- see
  // the schema comment in migrations/pg/012_git_credentials.cjs.
  protected async resolveGitCredentialToken(host: string, context: NormalizedGatewayRequestContext): Promise<{ id: string; token: string }> {
    const ownerUserId = await this.resolveGitCredentialReader(context);
    const credentialRow = await this.db("git_credentials")
      .where({ owner_user_id: ownerUserId, host })
      .orderBy("created_at", "desc")
      .first();
    if (!credentialRow) {
      throw new AppError(
        "GIT_CREDENTIAL_REQUIRED",
        `No credential stored for host ${host}, add one in your profile first.`,
        { host }
      );
    }
    return { id: String(credentialRow.id), token: decryptGitToken(String(credentialRow.token_enc)) };
  }

  protected async gitPipelineStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const host = String(input.host);
    const project = String(input.project);
    const ref = typeof input.ref === "string" && input.ref.length > 0 ? input.ref : undefined;

    const credential = await this.resolveGitCredentialToken(host, context);
    const result = await fetchGitlabPipelineStatus({
      host,
      project,
      ref,
      token: credential.token,
      httpFetch: this.gitHttpFetch
    });
    await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
    return {
      status: result.status,
      ref: result.ref,
      sha: result.sha,
      webUrl: result.webUrl,
      jobs: result.jobs
    };
  }

  // I-MEMORY-070: git.pipeline_status alone could tell an agent a job
  // failed but not why -- no job id/trace was ever exposed. Diagnosing a
  // failed CI job otherwise meant the operator SSHing in and grepping logs
  // by hand, exactly the manual step this whole git-credentials proxy
  // exists to replace. Redaction defaults on (see redactTrace's own
  // comment in git-credentials.ts) -- an agent debugging a failure
  // normally wants redact=true; redact=false is there for a human
  // explicitly asking to see the raw trace.
  protected async gitJobTrace(input: Row, context: NormalizedGatewayRequestContext) {
    const host = String(input.host);
    const project = String(input.project);
    const credential = await this.resolveGitCredentialToken(host, context);
    const result = await fetchGitlabJobTrace({
      host,
      project,
      jobId: typeof input.jobId === "number" ? input.jobId : undefined,
      ref: typeof input.ref === "string" && input.ref.length > 0 ? input.ref : undefined,
      jobName: typeof input.jobName === "string" ? input.jobName : undefined,
      tailLines: typeof input.tailLines === "number" ? input.tailLines : undefined,
      redact: input.redact !== false,
      token: credential.token,
      httpFetch: this.gitHttpFetch
    });
    await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
    return result;
  }

  // Runner online/offline visibility -- raised live by an agent (whispers
  // project) that had git.pipeline_status/git.job_trace to see why a job
  // failed but nothing to check whether a job was ever going to start in
  // the first place (e.g. a pipeline stuck in "created"/"pending" because
  // every runner tagged for it is offline). Same credential-resolution and
  // last_used_at bookkeeping as the two tools above.
  protected async gitRunnersStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const host = String(input.host);
    const project = String(input.project);
    const credential = await this.resolveGitCredentialToken(host, context);
    const runners = await fetchGitlabRunnersStatus({
      host,
      project,
      token: credential.token,
      httpFetch: this.gitHttpFetch
    });
    await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
    return { runners };
  }

  };
}
