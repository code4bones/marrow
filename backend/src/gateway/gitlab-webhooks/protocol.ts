import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import * as z from "zod/v4";
import { AppError } from "../../shared/errors.js";

const id = z.number().int().positive().safe();
const schema = z.object({
  object_kind: z.string(),
  project: z.object({ id }),
  user: z.object({ id }).optional(),
  object_attributes: z.object({
    id, iid: id, project_id: id.optional(), action: z.string(),
    title: z.string().min(1).max(1000), description: z.string().max(500_000).nullable().optional(),
    confidential: z.boolean().optional(), type: z.string().nullable().optional(), author_id: id.optional(),
    assignee_ids: z.array(id).max(100).optional()
  }),
  assignees: z.array(z.object({ id, username: z.string().max(200).optional() })).max(100).optional(),
  labels: z.array(z.object({ title: z.string().max(200) })).max(100).optional()
});

export interface GitlabIssueSnapshot {
  issueId: string; iid: string; title: string; description: string | null;
  authorId: string | null; actorId: string | null; assigneeIds: string[]; labels: string[];
}

export function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  return typeof value === "string" ? value : "";
}

export function verifyGitlabWebhook(raw: Buffer, headers: IncomingHttpHeaders, mode: string, secret: string, now = Date.now()): boolean {
  if (mode === "token") {
    const expected = createHash("sha256").update(secret).digest();
    const actual = createHash("sha256").update(header(headers, "x-gitlab-token")).digest();
    return timingSafeEqual(expected, actual);
  }
  if (mode !== "hmac" || !secret.startsWith("whsec_")) return false;
  const messageId = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  if (!messageId || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${messageId}.${timestamp}.`).update(raw).digest();
  return header(headers, "webhook-signature").split(" ").some((signature) => {
    if (!signature.startsWith("v1,")) return false;
    const actual = Buffer.from(signature.slice(3), "base64");
    return actual.length === expected.length && timingSafeEqual(expected, actual);
  });
}

export function parseGitlabIssue(raw: Buffer, repositoryProjectId: string): GitlabIssueSnapshot | null {
  let json: unknown;
  try { json = JSON.parse(raw.toString("utf8")); } catch { throw new AppError("VALIDATION_ERROR", "Invalid webhook JSON."); }
  const kind = (json as { object_kind?: unknown } | null)?.object_kind;
  if (kind !== "issue") return null;
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AppError("VALIDATION_ERROR", "Invalid GitLab issue payload.");
  const issue = parsed.data.object_attributes;
  if (String(parsed.data.project.id) !== repositoryProjectId || (issue.project_id && String(issue.project_id) !== repositoryProjectId)) {
    throw new AppError("VALIDATION_ERROR", "Webhook repository does not match the configured repository.");
  }
  if (issue.action !== "open" || issue.confidential || (issue.type && issue.type !== "Issue")) return null;
  return {
    issueId: String(issue.id), iid: String(issue.iid), title: issue.title, description: issue.description ?? null,
    authorId: issue.author_id ? String(issue.author_id) : null, actorId: parsed.data.user ? String(parsed.data.user.id) : null,
    assigneeIds: [...new Set((issue.assignee_ids ?? parsed.data.assignees?.map((user) => user.id) ?? []).map(String))],
    labels: parsed.data.labels?.map((label) => label.title) ?? []
  };
}

export function gitlabDeliveryKey(raw: Buffer, headers: IncomingHttpHeaders): string {
  return createHash("sha256").update(
    header(headers, "webhook-id") || header(headers, "idempotency-key") || header(headers, "x-gitlab-event-uuid") || raw
  ).digest("hex");
}
