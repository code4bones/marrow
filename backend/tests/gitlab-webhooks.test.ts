import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptGitToken } from "../src/gateway/git-credentials.js";
import { verifyGitlabWebhook, parseGitlabIssue } from "../src/gateway/gitlab-webhooks/protocol.js";
import { acceptGitlabWebhook, gitlabWebhookStatus } from "../src/gateway/gitlab-webhooks/receiver.js";
import { GitlabIssueWorker } from "../src/gateway/gitlab-webhooks/worker.js";
import { GitlabExportWorker } from "../src/gateway/gitlab-webhooks/export-worker.js";
import { exportMarker } from "../src/gateway/gitlab-webhooks/exports.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { AppError } from "../src/shared/errors.js";
import { fail } from "../src/shared/mcp/tool-response.js";
import { notifyTelegram } from "../src/gateway/telegram.js";
import { startGatewayServer } from "../src/gateway/http-server.js";

vi.mock("../src/gateway/telegram.js", async (original) => ({ ...await original<typeof import("../src/gateway/telegram.js")>(), notifyTelegram: vi.fn().mockResolvedValue(undefined) }));
const require = createRequire(import.meta.url);
const settings = require("../migrations/pg/106_project_gitlab_settings.cjs");
const leadMigration = require("../migrations/pg/110_project_repository_lead.cjs");
const inbox = require("../migrations/pg/108_gitlab_issue_inbox.cjs");
const exportsMigration = require("../migrations/pg/112_gitlab_issue_exports.cjs");
const repoId = randomUUID();
let db: Knex;
let worker: GitlabIssueWorker;
let rollback = false;

class TestService extends PgToolService {
  protected override async touchClient(): Promise<void> {}
  override async call(...args: Parameters<PgToolService["call"]>) {
    const result = await super.call(...args);
    if (args[0] === "task.create" && rollback) return fail(new AppError("GATEWAY_ERROR", "Injected failure after task insert"));
    return result;
  }
}

function payload(overrides: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({ object_kind: "issue", project: { id: 228 }, user: { id: 2 },
    object_attributes: { id: 700, iid: 5, project_id: 228, action: "open", title: "An issue", description: null,
      author_id: 2, assignee_ids: [2], ...overrides } }));
}

beforeEach(async () => {
  rollback = false;
  vi.mocked(notifyTelegram).mockClear();
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.raw("PRAGMA foreign_keys = ON");
  await db.schema.createTable("users", (t) => { t.text("id").primary(); t.text("email"); t.text("status"); });
  await db.schema.createTable("projects", (t) => { for (const name of ["id", "slug", "title", "owner_user_id", "status"]) t.text(name); t.primary(["id"]); });
  await db.schema.createTable("project_members", (t) => { for (const name of ["project_id", "user_id", "status", "role"]) t.text(name); });
  await db.schema.createTable("gateway_clients", (t) => { t.text("id"); t.text("owner_user_id"); });
  await db.schema.createTable("telegram_task_sources", (t) => { for (const name of ["task_id", "project_id", "bot_id"]) t.text(name); });
  await db.schema.createTable("tasks", (t) => {
    t.text("id").primary();
    for (const name of ["project_id", "title", "status", "milestone", "scope", "acceptance", "allowed_files", "forbidden_files", "depends_on", "notes", "assignee_user_id", "project_version", "created_by", "updated_by", "source_instance_id", "created_at", "updated_at"]) t.text(name);
    t.integer("priority"); t.integer("version");
  });
  await db.schema.createTable("events", (t) => {
    t.text("id").primary();
    for (const name of ["project_id", "type", "title", "body", "related_id", "agent_name", "target_user_ids", "created_by", "source_instance_id", "created_at"]) t.text(name);
  });
  await require("../migrations/pg/123_task_assignees.cjs").up(db);
  await settings.up(db); await inbox.up(db); await leadMigration.up(db); await exportsMigration.up(db);
  await require("../migrations/pg/124_gitlab_export_assignees.cjs").up(db);
  await require("../migrations/pg/012_git_credentials.cjs").up(db);
  await require("../migrations/pg/103_integration_outbox.cjs").up(db);
  process.env.GIT_CREDENTIAL_ENC_KEY ??= Buffer.alloc(32, 8).toString("base64");
  await db("users").insert([{ id: "owner", email: "owner@marrow.test", status: "active" }, { id: "removed", email: "removed@test", status: "active" }]);
  await db("projects").insert({ id: "P-SLIFE", slug: "slife", title: "SLIFE", owner_user_id: "owner", status: "active" });
  await db("project_members").insert({ project_id: "P-SLIFE", user_id: "owner", role: "pm", status: "active" });
  await db("project_repositories").insert({ id: repoId, project_id: "P-SLIFE", host: "gitlab.test", gitlab_project_id: "228", path: "group/backend", name: "backend", web_url: "https://gitlab.test/group/backend", created_by: "user:owner", created_at: new Date().toISOString() });
  await db("project_gitlab_members").insert([{ project_id: "P-SLIFE", user_id: "owner", host: "gitlab.test", gitlab_user_id: "2", username: "owner-gitlab", name: "Owner", updated_at: new Date().toISOString() },
    { project_id: "P-SLIFE", user_id: "removed", host: "gitlab.test", gitlab_user_id: "3", username: "former-member", name: "Removed", updated_at: new Date().toISOString() }]);
  await db("gitlab_webhooks").insert({ repository_id: repoId, auth_mode: "token", secret_enc: encryptGitToken("test-secret"), enabled: true, updated_at: new Date().toISOString() });
  worker = new GitlabIssueWorker(db, undefined, (trx) => new TestService(trx));
});
afterEach(async () => { await db.destroy(); });

const headers = { "x-gitlab-token": "test-secret", "x-gitlab-event-uuid": "event-1" };

describe("GitLab issue webhook", () => {
  it("assigns an issue without assignees to the repository lead", async () => {
    await db("project_repositories").where({ id: repoId }).update({ lead_user_id: "owner" });
    await acceptGitlabWebhook(db, repoId, payload({ assignee_ids: [] }), headers);
    await worker.tick();
    const task = await db("tasks").first();
    expect(task.assignee_user_id).toBe("owner");
    expect(task.notes).toContain("repository lead developer");
  });

  it.each(["disabled", "removed"])("ignores a %s lead for an unassigned issue", async (status) => {
    const lead = status === "disabled" ? "owner" : "removed";
    await db("project_repositories").where({ id: repoId }).update({ lead_user_id: lead });
    if (status === "disabled") await db("users").where({ id: lead }).update({ status: "disabled" });
    await acceptGitlabWebhook(db, repoId, payload({ assignee_ids: [] }), headers);
    await worker.tick();
    expect((await db("tasks").first()).assignee_user_id).toBeNull();
  });

  it("preserves an explicit assignee when another repository lead is configured", async () => {
    await db("users").insert({ id: "other", email: "other@test", status: "active" });
    await db("project_members").insert({ project_id: "P-SLIFE", user_id: "other", role: "developer", status: "active" });
    await db("project_gitlab_members").insert({ project_id: "P-SLIFE", user_id: "other", host: "gitlab.test", gitlab_user_id: "4", username: "other", name: "Other", updated_at: new Date().toISOString() });
    await db("project_repositories").where({ id: repoId }).update({ lead_user_id: "owner" });
    await acceptGitlabWebhook(db, repoId, payload({ assignee_ids: [4] }), headers);
    await worker.tick();
    expect((await db("tasks").first()).assignee_user_id).toBe("other");
  });
  it("verifies HMAC body, timestamp and message ID; never downgrades authentication", () => {
    const raw = payload();
    const key = Buffer.alloc(32, 1);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", key).update(`event-1.${timestamp}.`).update(raw).digest("base64");
    const signed = { "webhook-id": "event-1", "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` };
    expect(verifyGitlabWebhook(raw, signed, "hmac", `whsec_${key.toString("base64")}`)).toBe(true);
    expect(verifyGitlabWebhook(Buffer.from("tampered"), signed, "hmac", `whsec_${key.toString("base64")}`)).toBe(false);
    expect(verifyGitlabWebhook(raw, signed, "hmac", `whsec_${key.toString("base64")}`, Date.now() + 301_000)).toBe(false);
    expect(verifyGitlabWebhook(raw, headers, "hmac", "whsec_dGVzdA==")).toBe(false);
  });

  it("rejects mismatched projects and skips confidential/non-open events", () => {
    expect(() => parseGitlabIssue(payload(), "232")).toThrow(/does not match/);
    expect(parseGitlabIssue(payload({ confidential: true }), "228")).toBeNull();
    expect(parseGitlabIssue(payload({ action: "update" }), "228")).toBeNull();
  });

  it("imports a self-assigned issue once, using mapped identities and integration attribution", async () => {
    expect(await acceptGitlabWebhook(db, repoId, payload(), headers)).toMatchObject({ accepted: true, duplicate: false });
    expect(await acceptGitlabWebhook(db, repoId, payload(), headers)).toMatchObject({ duplicate: true });
    await worker.tick();
    const tasks = await db("tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: "An issue", assignee_user_id: "owner", status: "todo", created_by: `integration:gitlab:${repoId}` });
    expect(tasks[0].notes).toContain("https://gitlab.test/group/backend/-/issues/5");
    expect((await db("gitlab_issue_inbox").first()).status).toBe("done");
    expect((await db("gitlab_issue_links").first()).task_id).toBe(tasks[0].id);
    expect(await gitlabWebhookStatus(db, repoId)).toMatchObject({ lastDeliveryStatus: "done", lastTaskId: tasks[0].id });
    expect(vi.mocked(notifyTelegram).mock.calls[0]?.[0]).toBe(db);
    const notices = vi.mocked(notifyTelegram).mock.calls.length;
    await acceptGitlabWebhook(db, repoId, payload(), { ...headers, "x-gitlab-event-uuid": "event-2" });
    await worker.tick();
    expect(await db("tasks")).toHaveLength(1);
    expect(vi.mocked(notifyTelegram).mock.calls).toHaveLength(notices);
  });

  it("rolls back a failed import and emits no premature notifications, then retries cleanly", async () => {
    await acceptGitlabWebhook(db, repoId, payload(), headers);
    rollback = true;
    await worker.tick();
    expect(await db("tasks")).toHaveLength(0);
    expect(await db("events")).toHaveLength(0);
    expect(await db("gitlab_issue_links")).toHaveLength(0);
    expect(notifyTelegram).not.toHaveBeenCalled();
    expect((await db("gitlab_issue_inbox").first()).status).toBe("pending");
    rollback = false;
    await db("gitlab_issue_inbox").update({ available_at: "2000-01-01T00:00:00Z" });
    await worker.tick();
    expect(await db("tasks")).toHaveLength(1);
  });

  it("never assigns an unmapped or removed member", async () => {
    await db("project_repositories").where({ id: repoId }).update({ lead_user_id: "owner" });
    await acceptGitlabWebhook(db, repoId, payload({ assignee_ids: [3] }), headers);
    await worker.tick();
    expect((await db("tasks").first()).assignee_user_id).toBeNull();
  });

  it("keeps a tombstone after task deletion to prevent accidental recreation on replay", async () => {
    await acceptGitlabWebhook(db, repoId, payload(), headers); await worker.tick();
    await db("tasks").del();
    expect(await gitlabWebhookStatus(db, repoId)).toMatchObject({ lastDeliveryStatus: "done", lastTaskId: null });
    await acceptGitlabWebhook(db, repoId, payload(), { ...headers, "x-gitlab-event-uuid": "event-2" });
    await worker.tick();
    expect(await db("tasks")).toHaveLength(0);
  });

  it("exposes a bounded external HTTP receiver independent of the Marrow bearer", async () => {
    const server = await startGatewayServer(new TestService(db), { host: "127.0.0.1", port: 0, token: "marrow-token" });
    try {
      const url = `${server.url}/integrations/gitlab/webhooks/${repoId}`;
      const wrong = await fetch(url, { method: "POST", headers: { "x-gitlab-token": "wrong" }, body: payload() });
      expect(wrong.status).toBe(401);
      const right = await fetch(url, { method: "POST", headers, body: payload() });
      expect(right.status).toBe(202);
      const large = await fetch(url, { method: "POST", headers, body: "x".repeat(1024 * 1024 + 1) });
      expect(large.status).toBe(413);
    } finally { await server.stop(); }
  });
});

const actorContext = { clientId: "user:owner", sessionUserId: "owner", sessionRole: "admin", sessionSource: "oauth" as const };
async function createExportTask() {
  await db("users").insert({ id: "recipient", email: "recipient@test", status: "active" });
  await db("project_members").insert({ project_id: "P-SLIFE", user_id: "recipient", role: "developer", status: "active" });
  await db("project_gitlab_members").insert({ project_id: "P-SLIFE", user_id: "recipient", host: "gitlab.test", gitlab_user_id: "15", username: "recipient", name: "Recipient", updated_at: new Date().toISOString() });
  await db("project_repositories").where({ id: repoId }).update({ lead_user_id: "recipient" });
  const now = new Date().toISOString();
  await db("git_credentials").insert({ id: "actor-token", owner_user_id: "owner", host: "gitlab.test", label: "Test", token_enc: encryptGitToken("actor-secret"), created_at: now, updated_at: now });
  const result = await new TestService(db).call("task.create", { project: "P-SLIFE", title: "Original Marrow task", assignee: "recipient" }, actorContext);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return (await db("tasks").first()).id as string;
}
function remoteIssue(description: string) { return { id: 700, iid: 5, project_id: 228, description, assignees: [{ id: 15 }] }; }
async function dueAgain() { await db("gitlab_issue_exports").whereNot({ status: "done" }).update({ available_at: "2000-01-01T00:00:00Z" }); }

describe("Marrow task to GitLab issue", () => {
  it("correlates a webhook BEFORE the POST response with exactly one task and Telly offer", async () => {
    vi.stubEnv("TELLYMCP_INBOX_MCP_URL", "https://telly.test/mcp"); vi.stubEnv("TELLYMCP_INBOX_BEARER_TOKEN", "test-token");
    try {
      const taskId = await createExportTask();
      const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({ "PRIVATE-TOKEN": "actor-secret" });
        const body = JSON.parse(String(init?.body));
        expect((await db("gitlab_issue_exports").first()).post_attempted_at).toBeTruthy();
        expect(body.assignee_ids).toEqual([15]);
        await acceptGitlabWebhook(db, repoId, payload({ description: body.description, assignee_ids: [15] }), headers);
        await worker.tick();
        expect(await db("tasks")).toHaveLength(1);
        expect((await db("gitlab_issue_links").first()).task_id).toBe(taskId);
        return Response.json(remoteIssue(body.description));
      });
      await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
      expect(fakeFetch).toHaveBeenCalledTimes(1);
      expect((await db("gitlab_issue_exports").first()).status).toBe("done");
      expect(await db("integration_outbox")).toHaveLength(1);
      const events = await db("events");
      expect(events.filter((event) => event.type === "task.created")).toHaveLength(1);
      expect(events.filter((event) => event.type === "task.assigned")).toHaveLength(1);
      await acceptGitlabWebhook(db, repoId, payload({ description: exportMarker((await db("gitlab_issue_exports").first()).id) }), { ...headers, "x-gitlab-event-uuid": "replay" });
      await worker.tick();
      expect(await db("tasks")).toHaveLength(1); expect(await db("integration_outbox")).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });

  it("reconciles a lost response after restart without a second POST", async () => {
    await createExportTask(); let description = "";
    const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") { description = JSON.parse(String(init.body)).description; throw new Error("connection lost after remote commit"); }
      return Response.json([remoteIssue(description)]);
    });
    await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
    expect((await db("gitlab_issue_exports").first()).status).toBe("uncertain");
    await dueAgain(); await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
    expect(fakeFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect((await db("gitlab_issue_exports").first()).status).toBe("done");
  });

  it("never retries an uncertain POST when search is empty or rejects credentials", async () => {
    const taskId = await createExportTask(); let searchStatus = 200;
    const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("timeout");
      return Response.json([], { status: searchStatus });
    });
    const exporter = new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch);
    await exporter.tick(); await dueAgain(); await exporter.tick();
    searchStatus = 403; await dueAgain(); await exporter.tick();
    await new TestService(db).call("task.export_gitlab", { id: taskId }, actorContext);
    searchStatus = 200; await dueAgain(); await exporter.tick();
    expect(fakeFetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect((await db("gitlab_issue_exports").first()).post_attempted_at).toBeTruthy();
  });

  it("keeps a deleted source task as a tombstone even for an early echo", async () => {
    await createExportTask(); const operation = await db("gitlab_issue_exports").first();
    await db("gitlab_issue_exports").update({ post_attempted_at: new Date().toISOString() }); await db("tasks").del();
    await acceptGitlabWebhook(db, repoId, payload({ description: exportMarker(operation.id) }), headers); await worker.tick();
    expect(await db("tasks")).toHaveLength(0);
    expect((await db("gitlab_issue_links").first()).task_id).toBeNull();
    expect((await db("gitlab_issue_exports").first()).status).toBe("done");
  });

  it("requires explicit repository selection when the recipient leads several", async () => {
    const taskId = await createExportTask(); await db("gitlab_issue_exports").del();
    const repo = await db("project_repositories").first(); const secondId = randomUUID();
    await db("project_repositories").insert({ ...repo, id: secondId, gitlab_project_id: "229", path: "group/second" });
    const service = new TestService(db);
    expect((await service.call("task.export_gitlab", { id: taskId }, actorContext)).ok).toBe(true);
    expect((await db("gitlab_issue_exports").first()).last_error).toBe("REPOSITORY_REQUIRED");
    await service.call("task.export_gitlab", { id: taskId, repositoryId: secondId }, actorContext);
    expect(await db("gitlab_issue_exports").first()).toMatchObject({ status: "pending", repository_id: secondId });
    await service.call("task.export_gitlab", { id: taskId }, actorContext);
    expect(await db("gitlab_issue_exports").first()).toMatchObject({ status: "pending", repository_id: secondId });
  });

  it("does not re-export imported tasks after reassignment", async () => {
    await createExportTask(); await db("gitlab_issue_exports").del(); await db("tasks").del();
    await acceptGitlabWebhook(db, repoId, payload(), headers); await worker.tick();
    const task = await db("tasks").first();
    const result = await new TestService(db).call("task.update_assignee", { id: task.id, assignee: "recipient" }, actorContext);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(await db("gitlab_issue_exports")).toHaveLength(0); expect(await db("tasks")).toHaveLength(1);
  });

  it("rolls back task and events atomically if export intent cannot be saved", async () => {
    await createExportTask(); await db("gitlab_issue_exports").del(); await db("tasks").del(); await db("events").del();
    await db.raw("CREATE TRIGGER reject_export BEFORE INSERT ON gitlab_issue_exports BEGIN SELECT RAISE(ABORT, 'injected export failure'); END");
    const result = await new TestService(db).call("task.create", { project: "P-SLIFE", title: "Must roll back", assignee: "recipient" }, actorContext);
    expect(result.ok).toBe(false); expect(await db("tasks")).toHaveLength(0); expect(await db("events")).toHaveLength(0);
  });
});

describe("GitLab export eligibility and retry boundaries", () => {
  it("queues a normal task on reassignment, but not on self assignment", async () => {
    const taskId = await createExportTask(); await db("gitlab_issue_exports").del();
    const service = new TestService(db);
    await service.call("task.update_assignee", { id: taskId, assignee: "owner" }, actorContext);
    expect(await db("gitlab_issue_exports")).toHaveLength(0);
    await service.call("task.update_assignee", { id: taskId, assignee: "recipient" }, actorContext);
    expect(await db("gitlab_issue_exports")).toHaveLength(1);
  });

  it("does not post without a mapping or borrow another user's credential", async () => {
    const taskId = await createExportTask();
    await db("gitlab_issue_exports").del(); await db("project_gitlab_members").where({ user_id: "recipient" }).del();
    await new TestService(db).call("task.export_gitlab", { id: taskId }, actorContext);
    expect((await db("gitlab_issue_exports").first()).last_error).toBe("GITLAB_MAPPING_REQUIRED");
    const fakeFetch = vi.fn(); const exporter = new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch);
    await exporter.tick(); expect(fakeFetch).not.toHaveBeenCalled();
    await db("project_gitlab_members").insert({ project_id: "P-SLIFE", user_id: "recipient", host: "gitlab.test", gitlab_user_id: "15", username: "recipient", name: "Recipient", updated_at: new Date().toISOString() });
    await new TestService(db).call("task.export_gitlab", { id: taskId }, actorContext);
    await db("git_credentials").update({ owner_user_id: "recipient" });
    await exporter.tick(); expect(fakeFetch).not.toHaveBeenCalled();
    expect(await db("gitlab_issue_exports").first()).toMatchObject({ status: "failed", last_error: "GIT_CREDENTIAL_REQUIRED", post_attempted_at: null });
  });

  it("permits safe retry after a definitive POST rejection, returning one link", async () => {
    const taskId = await createExportTask(); let rejected = true;
    const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => rejected
      ? Response.json({}, { status: 403 }) : Response.json(remoteIssue(JSON.parse(String(init?.body)).description)));
    const exporter = new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch);
    await exporter.tick();
    expect(await db("gitlab_issue_exports").first()).toMatchObject({ status: "failed", post_attempted_at: null });
    rejected = false;
    await new TestService(db).call("task.export_gitlab", { id: taskId }, actorContext); await exporter.tick();
    await new TestService(db).call("task.export_gitlab", { id: taskId }, actorContext); await exporter.tick();
    expect(fakeFetch).toHaveBeenCalledTimes(2); expect(await db("gitlab_issue_links")).toHaveLength(1);
  });

  it("reconciles a stale in-flight operation instead of reposting it", async () => {
    await createExportTask(); const operation = await db("gitlab_issue_exports").first();
    await db("gitlab_issue_exports").update({ status: "processing", post_attempted_at: new Date().toISOString(), locked_until: "2000-01-01T00:00:00Z" });
    const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("GET"); return Response.json([remoteIssue(exportMarker(operation.id))]);
    });
    await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
    expect((await db("gitlab_issue_exports").first()).status).toBe("done");
  });

  it("cancels an obsolete assignment before the remote POST", async () => {
    const taskId = await createExportTask(); await new TestService(db).call("task.update_assignee", { id: taskId, assignee: "owner" }, actorContext);
    const fakeFetch = vi.fn(); await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
    expect(fakeFetch).not.toHaveBeenCalled(); expect((await db("gitlab_issue_exports").first()).status).toBe("cancelled");
  });

  it("fails a copied export marker without creating another task", async () => {
    await createExportTask(); const operation = await db("gitlab_issue_exports").first();
    const fakeFetch = vi.fn(async () => Response.json(remoteIssue(exportMarker(operation.id))));
    await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
    await acceptGitlabWebhook(db, repoId, payload({ id: 701, iid: 6, description: exportMarker(operation.id) }), headers);
    await worker.tick();
    expect(await db("tasks")).toHaveLength(1); expect(await db("gitlab_issue_links")).toHaveLength(1);
    expect((await db("gitlab_issue_inbox").first()).last_error).toBe("VALIDATION_ERROR");
  });
});

describe("multiple GitLab task recipients", () => {
  it("exports one issue with every mapped assignee and checks the remote result", async () => {
    const taskId = await createExportTask();
    const changed = await new TestService(db).call("task.update_assignee", { id: taskId, assignees: ["recipient", "owner"] }, actorContext);
    expect(changed.ok).toBe(true);
    const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); expect(body.assignee_ids.sort()).toEqual([15, 2].sort());
      return Response.json({ ...remoteIssue(body.description), assignees: [{ id: 15 }, { id: 2 }] });
    });
    await new GitlabExportWorker(db, undefined, fakeFetch as typeof fetch).tick();
    expect(fakeFetch).toHaveBeenCalledOnce(); expect(await db("tasks")).toHaveLength(1);
    expect(await db("gitlab_issue_exports").first()).toMatchObject({ status: "done", last_error: null });
  });

  it("imports several mapped participants into one task", async () => {
    await db("project_members").insert({ project_id: "P-SLIFE", user_id: "removed", role: "tester", status: "active" });
    await acceptGitlabWebhook(db, repoId, payload({ assignee_ids: [2, 3] }), headers); await worker.tick();
    expect(await db("tasks")).toHaveLength(1);
    expect((await db("task_assignees")).map((a) => a.user_id).sort()).toEqual(["owner", "removed"]);
  });
});
