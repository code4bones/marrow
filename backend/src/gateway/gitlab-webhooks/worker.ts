import type { Knex } from "knex";
import { AppError } from "../../shared/errors.js";
import { nowIso } from "../../shared/dates.js";
import type { AppLogger } from "../../shared/logging/logger.js";
import { PgToolService } from "../pg-tool-service.js";
import type { Row } from "../pg-tool-service/types.js";
import type { GitlabIssueSnapshot } from "./protocol.js";
import { correlateExportEcho } from "./exports.js";

export class GitlabIssueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly db: Knex, private readonly logger?: AppLogger,
    private readonly createService: (db: Knex) => PgToolService = (db) => new PgToolService(db)) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(() => this.logger?.error("GitLab inbox tick failed")), 2000);
    this.timer.unref();
    void this.tick().catch(() => this.logger?.error("GitLab inbox startup tick failed"));
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let index = 0; index < 10; index++) {
        const delivery = await this.claim();
        if (!delivery) break;
        try { await this.process(String(delivery.id)); }
        catch (error) {
          const failed = Number(delivery.attempts) >= 8;
          const code = error instanceof AppError ? error.code : "DB_ERROR";
          await this.db("gitlab_issue_inbox").where({ id: delivery.id }).update({
            status: failed ? "failed" : "pending", locked_until: null, last_error: code,
            available_at: new Date(Date.now() + Math.min(300, 2 ** Number(delivery.attempts)) * 1000).toISOString()
          });
          this.logger?.warn({ deliveryId: delivery.id, code, failed }, "GitLab issue import failed");
        }
      }
    } finally { this.running = false; }
  }

  private async claim(): Promise<Row | null> {
    return this.db.transaction(async (trx) => {
      const query = trx("gitlab_issue_inbox").where((query) => query
        .where((pending) => pending.where({ status: "pending" }).andWhere("available_at", "<=", nowIso()))
        .orWhere((stale) => stale.where({ status: "processing" }).andWhere("locked_until", "<", nowIso())))
        .orderBy("received_at");
      if (trx.client.config.client === "pg") query.forUpdate().skipLocked();
      const row = await query.first();
      if (!row) return null;
      const attempts = Number(row.attempts) + 1;
      await trx("gitlab_issue_inbox").where({ id: row.id }).update({ status: "processing", attempts,
        locked_until: new Date(Date.now() + 120_000).toISOString() });
      return { ...row, attempts };
    });
  }

  private async process(id: string): Promise<void> {
    let notifications: PgToolService | null = null;
    await this.db.transaction(async (trx) => {
      const delivery = await trx("gitlab_issue_inbox").where({ id }).forUpdate().first();
      if (!delivery || delivery.status !== "processing") return;
      const repo = await trx("project_repositories").where({ id: delivery.repository_id }).first();
      const hook = await trx("gitlab_webhooks").where({ repository_id: delivery.repository_id, enabled: true }).first();
      const project = repo ? await trx("projects").where({ id: repo.project_id }).forUpdate().first() : null;
      if (!repo || !hook || !project || project.status !== "active") {
        await trx("gitlab_issue_inbox").where({ id }).update({ status: "ignored", locked_until: null, processed_at: nowIso() });
        return;
      }
      const issue = (typeof delivery.payload === "string" ? JSON.parse(delivery.payload) : delivery.payload) as GitlabIssueSnapshot;
      const key = { project_id: project.id, host: repo.host, gitlab_project_id: repo.gitlab_project_id, issue_id: issue.issueId };
      const linked = await trx("gitlab_issue_links").where(key).first();
      if (linked) {
        await trx("gitlab_issue_inbox").where({ id }).update({ status: "done", task_id: linked.task_id, locked_until: null, last_error: null, processed_at: nowIso() });
        return;
      }
      const echo = await correlateExportEcho(trx, repo, issue.description, issue.issueId, issue.iid);
      if (echo) {
        await trx("gitlab_issue_inbox").where({ id }).update({ status: "done", task_id: echo.taskId,
          locked_until: null, last_error: null, processed_at: nowIso() });
        return;
      }
      const mappings = await trx("project_gitlab_members").join("users", "users.id", "project_gitlab_members.user_id")
        .where({ "project_gitlab_members.project_id": project.id, host: repo.host })
        .select("project_gitlab_members.*", "users.status as user_status");
      const activeMembers = await trx("project_members").where({ project_id: project.id, status: "active" }).select("user_id");
      const active = new Set([project.owner_user_id, ...activeMembers.map((row) => row.user_id)]);
      const usable = mappings.filter((row) => row.user_status === "active" && active.has(row.user_id));
      const recipients = [...new Set(usable.filter((row) => issue.assigneeIds.includes(String(row.gitlab_user_id))).map((row) => String(row.user_id)))];
      let assignee = recipients.length === 1 ? recipients[0] : null;
      if (issue.assigneeIds.length === 0 && repo.lead_user_id && active.has(repo.lead_user_id)) {
        const lead = await trx("users").where({ id: repo.lead_user_id, status: "active" }).first();
        if (lead) assignee = String(repo.lead_user_id);
      }
      const actor = usable.find((row) => String(row.gitlab_user_id) === issue.actorId)?.user_id;
      const service = this.createService(trx);
      service.deferEventNotifications();
      const result = await service.call("task.create", {
        project: project.id, title: issue.title, ...(issue.description === null ? {} : { scope: issue.description }),
        milestone: `GitLab: ${repo.host}/${repo.path}`, assignee,
        notes: [`GitLab issue: ${repo.web_url}/-/issues/${issue.iid}`, `Source: ${repo.host}/${repo.path}#${issue.iid}`,
          `Author GitLab ID: ${issue.authorId ?? "unknown"}`, `Assignee GitLab IDs: ${issue.assigneeIds.join(", ") || "none"}`,
          issue.assigneeIds.length === 0 && assignee ? "Assigned to the repository lead developer (issue has no assignee)." : null,
          issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : null,
          recipients.length > 1 ? "Several mapped assignees; assign a single Marrow recipient manually." : null].filter(Boolean).join("\n")
      }, { clientId: `integration:gitlab:${repo.id}`, clientLabel: `GitLab ${repo.host}/${repo.path}`,
        metadata: { kind: "integration", source: "gitlab" }, ...(actor ? { ownerUserId: String(actor) } : {}) });
      if (!result.ok) throw new AppError("GATEWAY_ERROR", `Task import failed: ${result.error.code}`);
      const taskId = String(((result.data as Row).task as Row).id);
      await trx("gitlab_issue_links").insert({ ...key, issue_iid: issue.iid, task_id: taskId, created_at: nowIso() });
      await trx("gitlab_issue_inbox").where({ id }).update({ status: "done", task_id: taskId, locked_until: null, last_error: null, processed_at: nowIso() });
      notifications = service;
    });
    // The transaction's DB handle is closed; side effects use the root pool.
    (notifications as PgToolService | null)?.flushEventNotifications(this.db);
  }
}
