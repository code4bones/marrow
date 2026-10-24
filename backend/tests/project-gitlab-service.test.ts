import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptGitToken } from "../src/gateway/git-credentials.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { eventOut } from "../src/gateway/pg-tool-service/formatters/events.js";
import type { GatewayRequestContext, Row } from "../src/gateway/pg-tool-service/types.js";

const migration = createRequire(import.meta.url)("../migrations/pg/106_project_gitlab_settings.cjs") as { up: (db: Knex) => Promise<void> };

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

beforeEach(async () => {
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("users", (t) => { t.text("id").primary(); t.text("email"); });
  await db.schema.createTable("projects", (t) => { t.text("id").primary(); t.text("slug"); t.text("title"); t.text("owner_user_id"); });
  await db.schema.createTable("project_members", (t) => {
    t.text("project_id"); t.text("user_id"); t.text("status"); t.text("role"); t.primary(["project_id", "user_id"]);
  });
  await db.schema.createTable("git_credentials", (t) => {
    t.text("id").primary(); t.text("owner_user_id"); t.text("host"); t.text("token_enc"); t.text("created_at"); t.text("last_used_at");
  });
  await migration.up(db);
  await db("users").insert(["owner", "member", "pending", "outsider"].map((id) => ({ id, email: `${id}@example.test` })));
  await db("projects").insert([{ id: "P-TEST", slug: "test", title: "Test", owner_user_id: "owner" }, { id: "P-OTHER", slug: "other", title: "Other", owner_user_id: "outsider" }]);
  await db("project_members").insert(["owner", "member", "pending"].map((id) => ({ project_id: "P-TEST", user_id: id, status: id === "pending" ? "pending_approval" : "active", role: "developer" })));
  process.env.GIT_CREDENTIAL_ENC_KEY ??= Buffer.alloc(32, 7).toString("base64");
  await db("git_credentials").insert(["gitlab-a.test", "gitlab-b.test"].map((host) => ({ id: host, owner_user_id: "owner", host, token_enc: encryptGitToken("owner-token"), created_at: "2026-01-01" })));
  httpFetch.mockReset().mockImplementation(async (input, init) => {
    expect(init?.headers).toMatchObject({ "PRIVATE-TOKEN": "owner-token" });
    const url = new URL(String(input));
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
    expect((await service.call("project.remove_member", { project: "test", userId: "member" }, owner)).ok).toBe(true);
    expect(await db("project_gitlab_members")).toHaveLength(0);
  });

  it("does not detach another project's repository by ID", async () => {
    await add();
    const row = await db("project_repositories").first();
    const result = await service.call("project.repository_remove", { project: "other", id: row.id }, { ...owner, sessionRole: "admin" });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await db("project_repositories")).toHaveLength(1);
  });
});
