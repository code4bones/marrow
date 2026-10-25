import { createRequire } from "node:module";
import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthFacade } from "../src/gateway/auth.js";
import { createGitlabIdentities } from "../src/gateway/gitlab-identities.js";

const require = createRequire(import.meta.url);
const migration = require("../migrations/pg/114_gitlab_oauth.cjs") as { up(db: Knex): Promise<void>; down(db: Knex): Promise<void> };
let db: Knex;
const issuer = "https://gitlab.example.test";
const identity = { issuer, subject: "42", username: "alice" };
const issueSession = vi.fn(async () => "session-token");
beforeEach(async () => {
  issueSession.mockClear();
  db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  await db.schema.createTable("users", t => { t.text("id").primary(); t.text("email"); t.text("role"); t.text("status"); t.text("password_hash"); });
  await db.schema.createTable("oauth_login_states", t => {
    for (const key of ["id", "token_hash", "intent", "user_id", "return_to", "code_verifier"]) t.text(key);
    t.timestamp("created_at"); t.timestamp("expires_at");
  });
  for (const table of ["github_identities", "telegram_identities"]) await db.schema.createTable(table, t => { t.text("user_id"); });
  await migration.up(db);
  await db("users").insert([{ id: "one", email: "alice@example.test", role: "member", status: "active", password_hash: "hash" },
    { id: "two", email: "bob@example.test", role: "member", status: "active", password_hash: null }]);
});
afterEach(async () => { await db.destroy(); });

describe("GitLab identity ownership", () => {
  it("requires explicit linking, never creates users, and isolates issuers", async () => {
    const auth = createGitlabIdentities(db, issueSession);
    expect(await auth.loginViaGitlab(identity, {})).toEqual({ status: "not_linked" });
    expect(await db("users")).toHaveLength(2);
    expect(issueSession).not.toHaveBeenCalled();
    await auth.linkGitlabIdentity("one", identity);
    expect(await auth.loginViaGitlab({ ...identity, issuer: "https://other.example.test" }, {})).toEqual({ status: "not_linked" });
    expect(await auth.loginViaGitlab(identity, {})).toMatchObject({ status: "session", user: { id: "one" } });
    expect(issueSession).toHaveBeenCalledOnce();
    expect(Object.keys((await db("gitlab_identities").first()))).not.toContain("access_token");
  });
  it("prevents stealing or silently replacing a link", async () => {
    const auth = createGitlabIdentities(db, issueSession);
    await auth.linkGitlabIdentity("one", identity);
    await expect(auth.linkGitlabIdentity("two", identity)).rejects.toThrow("another Marrow account");
    await expect(auth.linkGitlabIdentity("one", { ...identity, subject: "43" })).rejects.toThrow("Disconnect");
    await auth.linkGitlabIdentity("one", { ...identity, username: "renamed" });
    expect(await auth.gitlabLinkStatus("one", issuer)).toMatchObject({ linked: true, username: "renamed" });
    await expect(db("gitlab_identities").insert({ id: "duplicate", user_id: "two", issuer, subject: "42" })).rejects.toThrow();
  });
  it("enforces active accounts and refuses switching an existing browser account", async () => {
    const auth = createGitlabIdentities(db, issueSession);
    await auth.linkGitlabIdentity("one", identity);
    await expect(auth.loginViaGitlab(identity, {}, "two")).rejects.toThrow("differs");
    await db("users").where({ id: "one" }).update({ status: "disabled" });
    await expect(auth.loginViaGitlab(identity, {})).rejects.toThrow("not active");
    await expect(auth.linkGitlabIdentity("one", identity)).rejects.toThrow("active");
    expect(issueSession).not.toHaveBeenCalled();
  });
  it("allows unlinking only the caller's identity and retains another login method", async () => {
    const auth = createGitlabIdentities(db, issueSession);
    await auth.linkGitlabIdentity("two", identity);
    await auth.unlinkGitlabIdentity("one", issuer);
    expect((await auth.gitlabLinkStatus("two", issuer)).linked).toBe(true);
    await expect(auth.unlinkGitlabIdentity("two", issuer)).rejects.toThrow("another sign-in method");
    await db("telegram_identities").insert({ user_id: "two" });
    await auth.unlinkGitlabIdentity("two", issuer);
    expect((await auth.gitlabLinkStatus("two", issuer)).linked).toBe(false);
  });
});

describe("Provider-bound single-use states", () => {
  it("keeps legacy flows isolated from GitLab, including concurrent callback replay", async () => {
    const auth = createAuthFacade(db);
    const state = await auth.mintOAuthState("link", "one", null, "verifier", "gitlab", issuer);
    await expect(auth.consumeOAuthState(state)).rejects.toThrow();
    const results = await Promise.allSettled([auth.consumeOAuthState(state, "gitlab"), auth.consumeOAuthState(state, "gitlab")]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const success = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<unknown>;
    expect(success.value).toMatchObject({ intent: "link", userId: "one", codeVerifier: "verifier", issuer });
    const legacy = await auth.mintOAuthState("login", null);
    await expect(auth.consumeOAuthState(legacy, "gitlab")).rejects.toThrow();
    expect(await auth.consumeOAuthState(legacy)).toMatchObject({ intent: "login", issuer: null });
  });
  it("rejects expired states and migration rollback preserves old state fields", async () => {
    const auth = createAuthFacade(db);
    const state = await auth.mintOAuthState("login", null, null, "verifier", "gitlab", issuer);
    await db("oauth_login_states").update({ expires_at: new Date(1) });
    await expect(auth.consumeOAuthState(state, "gitlab")).rejects.toThrow();
    await migration.down(db);
    expect(await db.schema.hasTable("gitlab_identities")).toBe(false);
    expect(await db.schema.hasColumn("oauth_login_states", "provider")).toBe(false);
    expect(await db.schema.hasColumn("oauth_login_states", "code_verifier")).toBe(true);
  });
});
