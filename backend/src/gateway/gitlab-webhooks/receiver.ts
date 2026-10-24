import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Knex } from "knex";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import { decryptGitToken } from "../git-credentials.js";
import { gitlabDeliveryKey, parseGitlabIssue, verifyGitlabWebhook } from "./protocol.js";

export async function acceptGitlabWebhook(db: Knex, repositoryId: string, raw: Buffer, headers: IncomingHttpHeaders) {
  const config = await db("gitlab_webhooks").join("project_repositories", "project_repositories.id", "gitlab_webhooks.repository_id")
    .where({ "gitlab_webhooks.repository_id": repositoryId, "gitlab_webhooks.enabled": true })
    .select("gitlab_webhooks.*", "project_repositories.gitlab_project_id").first();
  if (!config || !verifyGitlabWebhook(raw, headers, String(config.auth_mode), decryptGitToken(String(config.secret_enc)))) {
    throw new AppError("UNAUTHORIZED", "Invalid or disabled GitLab webhook.");
  }
  const issue = parseGitlabIssue(raw, String(config.gitlab_project_id));
  if (!issue) return { accepted: false, ignored: true };
  const now = nowIso();
  const inserted = await db("gitlab_issue_inbox").insert({
    id: randomUUID(), repository_id: repositoryId, delivery_key: gitlabDeliveryKey(raw, headers),
    payload: JSON.stringify(issue), status: "pending", attempts: 0, available_at: now, received_at: now
  }).onConflict(["repository_id", "delivery_key"]).ignore().returning("id");
  return { accepted: true, duplicate: inserted.length === 0 };
}

export async function gitlabWebhookStatus(db: Knex, repositoryId: string) {
  const config = await db("gitlab_webhooks").where({ repository_id: repositoryId }).first();
  const last = await db("gitlab_issue_inbox").where({ repository_id: repositoryId }).orderBy("received_at", "desc").first();
  const failed = await db("gitlab_issue_inbox").where({ repository_id: repositoryId, status: "failed" }).count({ count: "*" }).first();
  return { enabled: Boolean(config?.enabled), hookId: config?.hook_id ?? null,
    failedCount: Number(failed?.count ?? 0),
    authMode: config?.auth_mode ?? null, lastError: config?.last_error ?? last?.last_error ?? null,
    lastDeliveryStatus: last?.status ?? null, lastDeliveryAt: last?.received_at ? new Date(last.received_at).toISOString() : null };
}
