import { getTaskAssigneeIds } from "../task-assignees.js";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import type { AppLogger } from "../../shared/logging/logger.js";
import { decryptGitToken, gitlabRequest, type GitHttpFetch } from "../git-credentials.js";
import type { Row } from "../pg-tool-service/types.js";
import { marrowWebUrl } from "../telegram.js";
import { exportMarker, linkExport, exportRecipients, exportGitlabUsers, sameUsers } from "./exports.js";

interface RemoteIssue { id: number; iid: number; project_id: number; description: string | null; assignees?: Array<{ id: number }> }

export class GitlabExportWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly db: Knex, private readonly logger?: AppLogger, private readonly httpFetch: GitHttpFetch = fetch) {}
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => this.logger?.error("GitLab export tick failed")), 2000);
    this.timer.unref();
    void this.tick().catch(() => this.logger?.error("GitLab export startup tick failed"));
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < 10; index++) {
        const operation = await this.claim();
        if (!operation) break;
        try { await this.process(operation); }
        catch (error) {
          // The database flag, rather than the in-memory result, decides if a
          // POST might have happened (also covers process death / lost response).
          const current = await this.db("gitlab_issue_exports").where({ id: operation.id }).first();
          if (!current || current.status === "done") continue;
          const code = error instanceof AppError ? error.code : "GATEWAY_ERROR";
          const uncertain = Boolean(current.post_attempted_at);
          await this.db("gitlab_issue_exports").where({ id: operation.id }).whereNot({ status: "done" }).update({
            status: uncertain ? "uncertain" : "failed", last_error: code, locked_until: null,
            available_at: new Date(Date.now() + Math.min(300, 2 ** Math.min(Number(current.attempts), 9)) * 1000).toISOString(), updated_at: nowIso()
          });
          this.logger?.warn({ exportId: operation.id, code, uncertain }, "GitLab issue export deferred");
        }
      }
    } finally { this.running = false; }
  }

  private async claim(): Promise<Row | null> {
    return this.db.transaction(async (trx) => {
      const query = trx("gitlab_issue_exports").where((q) => q
        .where((ready) => ready.whereIn("status", ["pending", "uncertain"]).andWhere("available_at", "<=", nowIso()))
        .orWhere((stale) => stale.where({ status: "processing" }).andWhere("locked_until", "<", nowIso())))
        .orderBy("created_at");
      if (trx.client.config.client === "pg") query.forUpdate().skipLocked();
      const row = await query.first();
      if (!row) return null;
      await trx("gitlab_issue_exports").where({ id: row.id }).update({ status: "processing", attempts: Number(row.attempts) + 1,
        locked_until: new Date(Date.now() + 120_000).toISOString(), updated_at: nowIso() });
      return row;
    });
  }

  private async process(operation: Row): Promise<void> {
    const project = await this.db("projects").where({ id: operation.project_id, status: "active" }).first();
    const actor = await this.db("users").where({ id: operation.actor_user_id, status: "active" }).first();
    const member = project && (project.owner_user_id === operation.actor_user_id || await this.db("project_members").where({
      project_id: project.id, user_id: operation.actor_user_id, status: "active" }).first());
    if (!actor || !member) throw new AppError("UNAUTHORIZED", "The exporting user must remain an active project member.");
    const credential = await this.db("git_credentials").where({ owner_user_id: operation.actor_user_id, host: operation.host }).orderBy("created_at", "desc").first();
    if (!credential) throw new AppError("GIT_CREDENTIAL_REQUIRED", "The exporting user needs a GitLab credential.");
    const token = decryptGitToken(String(credential.token_enc));
    const base = `https://${operation.host}/api/v4/projects/${encodeURIComponent(String(operation.gitlab_project_id))}/issues`;
    if (operation.post_attempted_at) {
      // Never infer that a missing search result permits another POST. GitLab
      // search can lag, permissions can change, or the marker can be edited.
      const issue = await this.reconcile(operation, base, token);
      if (issue) await this.finish(operation, issue);
      else await this.db("gitlab_issue_exports").where({ id: operation.id }).whereNot({ status: "done" }).update({
        status: "uncertain", last_error: "AWAITING_ISSUE_RECONCILIATION", locked_until: null,
        available_at: new Date(Date.now() + 60_000).toISOString(), updated_at: nowIso() });
      return;
    }

    const prepared = await this.db.transaction(async (trx) => {
      // Same lock ordering as the webhook: project -> operation.
      await trx("projects").where({ id: operation.project_id }).forUpdate().first();
      const current = await trx("gitlab_issue_exports").where({ id: operation.id }).forUpdate().first();
      if (!current || current.status !== "processing" || current.post_attempted_at ||
        current.repository_id !== operation.repository_id || current.actor_user_id !== operation.actor_user_id || !sameUsers(exportRecipients(current), exportRecipients(operation))) return null;
      const task = current.task_id ? await trx("tasks").where({ id: current.task_id }).first() : null;
      const repo = await trx("project_repositories").where({ id: current.repository_id }).first();
      const recipientIds = exportRecipients(current);
      const recipients = await trx("users").whereIn("id", recipientIds).where({ status: "active" });
      const activeMembers = await trx("project_members").where({ project_id: current.project_id, status: "active" }).whereIn("user_id", recipientIds);
      const allowed = new Set([String(project.owner_user_id), ...activeMembers.map((m) => String(m.user_id))]);
      const mappings = await trx("project_gitlab_members").where({ project_id: current.project_id, host: current.host }).whereIn("user_id", recipientIds);
      if (!task || !repo || ["done", "cancelled"].includes(String(task.status)) ||
          !sameUsers(await getTaskAssigneeIds(trx, task), recipientIds) || recipients.length !== recipientIds.length || recipientIds.some((id) => !allowed.has(id))) {
        await trx("gitlab_issue_exports").where({ id: current.id }).update({ status: "cancelled", last_error: "ASSIGNMENT_NO_LONGER_ELIGIBLE", locked_until: null, updated_at: nowIso() });
        return null;
      }
      if (mappings.length !== recipientIds.length || !sameUsers([...new Set(mappings.map((m) => String(m.gitlab_user_id)))], exportGitlabUsers(current)))
        throw new AppError("VALIDATION_ERROR", "GitLab assignee mappings changed; retry the export.");
      const webUrl = marrowWebUrl();
      const taskUrl = webUrl ? `${webUrl}/projects/${encodeURIComponent(String(project.slug))}/tasks/${encodeURIComponent(String(task.id))}` : null;
      const description = [exportMarker(String(current.id)), taskUrl ? `Marrow task: [${task.id}](${taskUrl})` : `Marrow task: ${task.id}`, task.scope,
        task.acceptance ? `## Acceptance\n${task.acceptance}` : null,
        task.notes ? `## Notes\n${task.notes}` : null,
        task.milestone ? `Milestone: ${task.milestone}` : null].filter(Boolean).join("\n\n");
      if (description.length > 450_000) throw new AppError("VALIDATION_ERROR", "Task content is too large for GitLab export.");
      await trx("gitlab_issue_exports").where({ id: current.id }).update({ post_attempted_at: nowIso(), updated_at: nowIso() });
      return { title: String(task.title).slice(0, 255), description, assignee_ids: exportGitlabUsers(current).map(Number) };
    });
    if (!prepared) return;
    let issue: RemoteIssue;
    try {
      const response = await gitlabRequest(new URL(base), token, this.httpFetch, String(operation.host), { method: "POST", body: prepared, timeoutMs: 30_000 });
      issue = await response.json() as RemoteIssue;
    } catch (error) {
      // Only a definitive rejection of THIS POST makes a later POST safe.
      // In particular, a 403/404 during reconciliation must never reset it.
      const status = Number(error instanceof AppError ? error.details?.status : 0);
      if (status >= 400 && status < 500 && status !== 408) {
        await this.db("gitlab_issue_exports").where({ id: operation.id }).whereNot({ status: "done" }).update({ post_attempted_at: null });
      }
      throw error;
    }
    await this.finish(operation, issue);
    await this.db("git_credentials").where({ id: credential.id }).update({ last_used_at: nowIso() });
  }

  private async reconcile(operation: Row, base: string, token: string): Promise<RemoteIssue | null> {
    let match: RemoteIssue | null = null;
    for (let page = 1; page <= 10; page++) {
      const url = new URL(base);
      url.search = new URLSearchParams({ scope: "all", state: "all", search: String(operation.id), in: "description", per_page: "100", page: String(page) }).toString();
      const response = await gitlabRequest(url, token, this.httpFetch, String(operation.host), { method: "GET", timeoutMs: 30_000 });
      const issues = await response.json() as RemoteIssue[];
      if (!Array.isArray(issues)) throw new AppError("GATEWAY_ERROR", "Invalid issue search response.");
      for (const issue of issues) if (issue.description?.includes(exportMarker(String(operation.id)))) {
        if (match && match.id !== issue.id) throw new AppError("VALIDATION_ERROR", "Several issues contain this export marker; manual reconciliation required.");
        match = issue;
      }
      if (issues.length < 100) return match;
    }
    throw new AppError("GATEWAY_ERROR", "Issue search exceeded its page limit.");
  }

  private async finish(operation: Row, issue: RemoteIssue): Promise<void> {
    if (!Number.isSafeInteger(issue.id) || issue.id < 1 || !Number.isSafeInteger(issue.iid) || issue.iid < 1 || String(issue.project_id) !== operation.gitlab_project_id) {
      throw new AppError("GATEWAY_ERROR", "Invalid GitLab issue response; reconciliation required.");
    }
    await this.db.transaction(async (trx) => {
      await trx("projects").where({ id: operation.project_id }).forUpdate().first();
      const current = await trx("gitlab_issue_exports").where({ id: operation.id }).forUpdate().first();
      if (current) {
        await linkExport(trx, current, String(issue.id), String(issue.iid));
        if (exportGitlabUsers(current).some((id) => !issue.assignees?.some((user) => String(user.id) === id))) {
          await trx("gitlab_issue_exports").where({ id: current.id }).update({ last_error: "GITLAB_ASSIGNEE_NOT_APPLIED" });
        }
      }
    });
  }
}
