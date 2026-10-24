import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptGitToken } from "../src/gateway/git-credentials.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { eventOut } from "../src/gateway/pg-tool-service/formatters/events.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";

const migration = createRequire(import.meta.url)("../migrations/pg/106_project_gitlab_settings.cjs") as { up: (db: Knex) => Promise<void> };
const leadMigration = createRequire(import.meta.url)("../migrations/pg/110_project_repository_lead.cjs") as { up: (db: Knex) => Promise<void> };
const webhookMigration = createRequire(import.meta.url)("../migrations/pg/108_gitlab_issue_inbox.cjs") as { up: (db: Knex) => Promise<void> };

// Isolated database tests: real service, queries, constraints and migration;
// external GitLab and event delivery are replaced, with no development server.
class TestService extends PgToolService {
  protected override async touchClient(): Promise<void> {}
  protected override async recordEventForProject(projectId: string | null, input: Row) {
    return eventOut({ id: "E-TEST-001", project_id: projectId, ...input });
  }
}

let db: Knex;
let service: TestService;
const owner: GatewayRequestContext = { clientId: "user:owner", sessionUserId: "owner", sessionRole: "member", sessionSource: "cookie" };
const member: GatewayRequestContext = { clientId: "user:member", sessionUserId: "member", sessionRole: "member", sessionSource: "oauth" };
const httpFetch = vi.fn<typeof fetch>();
const hooks = new Map<string, { id: number; url: string }>();

beforeEach(async () => {
  hooks.clear();
  process.env.PROJECT_MEMORY_PUBLIC_URL = "https://marrow.example.test/api";
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("users", (t) => { t.text("id").primary(); t.text("email"); t.text("status"); });
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); t.text("slug"); t.text("title"); t.text("owner_user_id"); });
  await db.schema.createTable("project_members", (t) => {
    t.text("project_id"); t.text("user_id"); t.text("status"); t.text("role"); t.primary(["project_id", "user_id"]);
  });
  await db.schema.createTable("git_credentials", (t) => {
    t.text("id").primary(); t.text("owner_user_id"); t.text("host"); t.text("token_enc"); t.text("created_at"); t.text("last_used_at");
  });
  await migration.up(db);
  await webhookMigration.up(db);
  await leadMigration.up(db);
  await db("users").insert(["owner", "member", "pending", "outsider"].map((id) => ({ id, email: `${id}@example.test`, status: "active" })));
  await db("projects").insert([{ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "owner" }, { id: "P-OTHER", slug: "other", title: "Other", owner_user_id: "outsider" }]);
  await db("project_members").insert(["owner", "member", "pending"].map((id) => ({ project_id: "P-TEST", user_id: id, status: id === "pending" ? "pending_approval" : "active", role: "developer" })));
  process.env.GIT_CREDENTIAL_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
  await db("git_credentials").insert(["gitlab-a.test", "gitlab-b.test"].map((host) => ({ id: host, owner_user_id: "owner", host, token_enc: encryptGitToken("owner-token"), created_at: "2026-01-01" })));
  httpFetch.mockReset().mockImplementation(async (input, init) => {
    expect(init?.headers).toMatchObject({ "PRIVATE-TOKEN": "owner-token" });
    const url = new URL(String(input));
    if (url.pathname === "/api/v4/version") return Response.json({ version: "19.5.1" });
    if (/\/hooks(?:\/\d+)?$/.test(url.pathname)) {
      if (init?.method === "DELETE") { hooks.delete(url.host); return new Response(null, { status: 204 }); }
      if (!init?.method || init.method === "GET") return Response.json(hooks.has(url.host) ? [hooks.get(url.host)] : []);
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ issues_events: true, push_events: false, confidential_issues_events: false, enable_ssl_verification: true });
      expect(body.signing_token).toMatch(/^whsec_/);
      const hook = { id: 12, url: body.url }; hooks.set(url.host, hook); return Response.json(hook);
    }
    if (url.pathname.startsWith("/api/v4/projects/")) {
      const path = decodeURIComponent(url.pathname.slice("/api/v4/projects/".length));
      return Response.json({ id: path.endsWith("front") ? 2 : 1, name: path.split("/").at(-1), path_with_namespace: path, web_url: `https://${url.host}/${path}` });
    }
    return Response.json({ id: 318, username: "ivan-dev", name: "Ivan" });
  });
  service = new TestService(db, httpFetch);
});
afterEach(async () => { await db.destroy(); });

async function add(host = "gitlab-a.test", path = "team/backend") {
  return service.call("project.repository_add", { project: "test", url: `https://${host}/${path}` }, owner);
}
async function map(userId: string, host = "gitlab-a.test") {
  return service.call("project.member_gitlab_set", { project: "test", userId, host, gitlabUserId: "318" }, owner);
}

describe("project GitLab permissions and persistence", () => {
  it("allows only the owner/admin to set or clear an active repository lead", async () => {
    await add();
    const repo = await db("project_repositories").first();
    const input = { project: "test", id: repo.id, userId: "member" };
    expect(await service.call("project.repository_set_lead", input, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    for (const userId of ["pending", "outsider"]) {
      expect(await service.call("project.repository_set_lead", { ...input, userId }, owner)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    }
    await db("users").where({ id: "member" }).update({ status: "disabled" });
    expect(await service.call("project.repository_set_lead", input, owner)).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    await db("users").where({ id: "member" }).update({ status: "active" });
    expect(await service.call("project.repository_set_lead", input, owner)).toMatchObject({ ok: true, data: { leadUserId: "member", leadEmail: "member@example.test" } });
    expect((await db("project_repositories").first()).lead_user_id).toBe("member");
    expect(await service.call("project.repository_set_lead", { ...input, userId: null }, owner)).toMatchObject({ ok: true, data: { leadUserId: null, leadEmail: null } });
    expect(await service.call("project.repository_set_lead", { ...input, userId: "owner" }, owner)).toMatchObject({ ok: true, data: { leadUserId: "owner" } });
  });

  it("does not change a repository in another project when setting its lead", async () => {
    await add();
    const repo = await db("project_repositories").first();
    expect(await service.call("project.repository_set_lead", { project: "other", id: repo.id, userId: "owner" }, { ...owner, sessionRole: "admin" })).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await db("project_repositories").first()).lead_user_id).toBeNull();
  });
  it("registers/repairs one authenticated hook and disables it without exposing secrets", async () => {
    await add();
    const row = await db("project_repositories").first();
    const input = { project: "test", id: row.id };
    const before = httpFetch.mock.calls.length;
    expect(await service.call("project.repository_webhook_connect", input, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(httpFetch.mock.calls).toHaveLength(before);
    const first = await service.call("project.repository_webhook_connect", input, owner);
    expect(first).toMatchObject({ ok: true, data: { enabled: true, hookId: "12", authMode: "hmac" } });
    expect(JSON.stringify(first)).not.toContain("whsec_");
    expect((await service.call("project.repository_webhook_connect", input, owner)).ok).toBe(true);
    expect(hooks.size).toBe(1);
    expect(hooks.get("gitlab-a.test")?.url).toBe(`https://marrow.example.test/api/integrations/gitlab/webhooks/${row.id}`);
    expect(await service.call("project.repository_webhook_disconnect", input, owner)).toMatchObject({ ok: true, data: { enabled: false } });
    expect(hooks.size).toBe(0);
  });
  it("stores several repositories and makes repeated additions idempotent", async () => {
    expect((await add()).ok).toBe(true);
    expect((await add()).ok).toBe(true);
    expect((await add("gitlab-a.test", "team/front")).ok).toBe(true);
    expect((await add("gitlab-b.test")).ok).toBe(true);
    expect(await db("project_repositories")).toHaveLength(3);
    expect((await service.call("project.repositories", { project: "test" }, member)).ok).toBe(true);
  });

  it("rejects a non-owner and an outsider before reaching GitLab", async () => {
    expect(await service.call("project.repository_add", { project: "test", url: "https://gitlab-a.test/team/backend" }, member)).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(await service.call("project.repositories", { project: "other" }, member)).toMatchObject({ ok: false, error: { code: "PROJECT_NOT_FOUND" } });
    expect(httpFetch).not.toHaveBeenCalled();
  });

  it("maps only active members and separates identities by host", async () => {
    await add(); await add("gitlab-b.test");
    expect((await map("member")).ok).toBe(true);
    expect((await map("owner", "gitlab-b.test")).ok).toBe(true);
    expect((await map("pending")).ok).toBe(false);
    expect((await map("outsider")).ok).toBe(false);
    expect((await map("owner")).ok).toBe(false); // 318 already belongs to member on host A.
    expect(await db("project_gitlab_members")).toHaveLength(2);
  });

  it("does not borrow the owner's credential for a different OAuth user", async () => {
    await add();
    const before = httpFetch.mock.calls.length;
    const result = await service.call("project.gitlab_users_search", { project: "test", host: "gitlab-a.test", query: "iv" }, { ...member, sessionRole: "admin" });
    expect(result).toMatchObject({ ok: false, error: { code: "GIT_CREDENTIAL_REQUIRED" } });
    expect(httpFetch.mock.calls).toHaveLength(before);
  });

  it("clears mappings when a member is removed", async () => {
    await add(); await map("member");
    const repo = await db("project_repositories").first();
    await service.call("project.repository_set_lead", { project: "test", id: repo.id, userId: "member" }, owner);
    expect((await service.call("project.remove_member", { project: "test", userId: "member" }, owner)).ok).toBe(true);
    expect(await db("project_gitlab_members")).toHaveLength(0);
    expect((await db("project_repositories").first()).lead_user_id).toBeNull();
  });

  it("does not detach another project's repository by ID", async () => {
    await add();
    const row = await db("project_repositories").first();
    const result = await service.call("project.repository_remove", { project: "other", id: row.id }, { ...owner, sessionRole: "admin" });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await db("project_repositories")).toHaveLength(1);
  });
});
