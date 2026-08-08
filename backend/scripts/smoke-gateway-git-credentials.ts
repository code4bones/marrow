// T-MEMORY-044: git host credentials (CRUD) + the pipeline-status proxy,
// end to end against the real gateway (ephemeral local instance, real
// Postgres) -- same style as scripts/smoke-gateway-scopes.ts (session
// login) and scripts/smoke-gateway-elevation.ts (OAuth bearer minting).
//
// Deliberately does NOT call a real GitLab instance: PgToolService takes an
// injectable `gitHttpFetch` (see its constructor in pg-tool-service.ts) and
// this script passes a fake that serves canned pipelines/jobs payloads from
// an in-memory map, keyed by URL. This covers the acceptance criteria
// ("mock/stub the outbound HTTP call... test only credential-resolution and
// encryption") without any outbound network dependency.
//
// Covers: credential create/list/delete round trip, the token never
// appearing in ANY tool/GraphQL response (create, list, or the raw DB
// row's ciphertext), encryption actually happening (decrypting the stored
// ciphertext recovers the original token; the ciphertext itself never
// contains the raw token as a substring), ownership enforcement (one
// member cannot delete another member's credential), the "no credential
// for this host" error path, the "GitLab rejected the token" (401) error
// path, session-required enforcement for credential *management*
// (create/delete) across non-session callers (static token, OAuth), and
// the admin-fallback for credential *reads* (list, pipeline_status) that
// same non-session callers get instead -- the actual point of this task,
// letting an agent connected over OAuth or the static token check CI
// status through PMem.
import { createHash, randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword, hashToken } from "../src/gateway/auth.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { decryptGitToken, encryptGitToken } from "../src/gateway/git-credentials.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

// Both TOTP_ENC_KEY (used by the OAuth-mint helper's password/2FA-free
// login path is not needed here, but createAuthFacade's other TOTP-adjacent
// codepaths are still imported transitively) and GIT_CREDENTIAL_ENC_KEY
// (this task's own encryption key) must be set before any credential-
// touching code runs -- same pattern as scripts/smoke-gateway-elevation.ts.
if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}
if (!process.env.GIT_CREDENTIAL_ENC_KEY) {
  process.env.GIT_CREDENTIAL_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const unique = Date.now();

// --- Fake GitLab HTTP client -------------------------------------------
// Keyed by hostname so different (fake) GitLab instances can return
// different canned data or error behavior, matching the task's "PAT is
// bound to a specific instance" scenario.
const GOOD_HOST = `gitlab-smoke-good-${unique}.example.test`;
const REJECTING_HOST = `gitlab-smoke-rejecting-${unique}.example.test`; // simulates a revoked/expired token (401)
const NO_CRED_HOST = `gitlab-smoke-no-credential-${unique}.example.test`; // never gets a stored credential

let gitlabRequestCount = 0;
// Comparing through a helper (parameterized, not a literal) rather than
// `assert(gitlabRequestCount === 0, ...)` inline at each call site --
// TS's control-flow narrowing otherwise pins this closure-captured counter
// to whichever literal it was last compared against, then flags the next
// comparison against a different literal as having no overlap, even though
// the variable is genuinely mutated (by fakeGitHttpFetch, called
// indirectly through the awaited gateway calls) in between.
function assertGitlabRequestCount(expected: number, message: string): void {
  assert(gitlabRequestCount === expected, message);
}
const fakeGitHttpFetch: typeof fetch = async (input) => {
  gitlabRequestCount += 1;
  const url = new URL(String(input));
  if (url.hostname === REJECTING_HOST) {
    return new Response(JSON.stringify({ message: "401 Unauthorized" }), { status: 401 });
  }
  if (url.hostname === GOOD_HOST) {
    if (url.pathname.endsWith("/jobs")) {
      return new Response(
        JSON.stringify([
          { name: "build", status: "success" },
          { name: "test", status: "success" },
          { name: "deploy", status: "running" }
        ]),
        { status: 200 }
      );
    }
    if (url.pathname.includes("/pipelines")) {
      return new Response(
        JSON.stringify([
          {
            id: 4242,
            status: "running",
            ref: url.searchParams.get("ref") ?? "main",
            sha: "abc123def456",
            web_url: `https://${GOOD_HOST}/group/project/-/pipelines/4242`
          }
        ]),
        { status: 200 }
      );
    }
  }
  throw new Error(`fakeGitHttpFetch: unexpected request to ${url.toString()}`);
};

const db = createPgKnex();
const service = new PgToolService(db, fakeGitHttpFetch);
const staticToken = `gateway-git-credentials-smoke-static-${unique}`;
const auth = createAuthFacade(db);
const publicUrl = "https://pmem-git-credentials-smoke.example/api";
const redirectUri = "https://claude.ai/connector/oauth/pmem-git-credentials-smoke";
const oauthClientId = `git-credentials-smoke-oauth-client-${unique}`;
const oauthClientSecret = `git-credentials-smoke-oauth-secret-${unique}`;

// PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET are gone -- oauth.ts no longer
// reads them at all. oauthClientId/oauthClientSecret below are instead
// seeded as a real oauth_clients row (owned by the admin user seeded
// below) once that user exists, same as scripts/smoke-oauth.ts.
const oauth = createOAuthFacadeFromEnv({
  ...process.env,
  PROJECT_MEMORY_PUBLIC_URL: publicUrl,
  PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
  PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl,
  PROJECT_MEMORY_ALLOWED_REDIRECT_URIS: redirectUri,
  PROJECT_MEMORY_AUTH_CODE_TTL_SECONDS: "300"
}, db);
assert(oauth, "OAuth facade was not created.");

const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken,
  oauth,
  auth
});
const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;

const memberAEmail = `git-credentials-smoke-member-a-${unique}@example.test`;
const memberAPassword = "smoke-git-cred-member-a-password-1";
const memberBEmail = `git-credentials-smoke-member-b-${unique}@example.test`;
const memberBPassword = "smoke-git-cred-member-b-password-1";
const adminEmail = `git-credentials-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-git-cred-admin-password-1";

let memberAUserId: string | undefined;
let memberBUserId: string | undefined;
let adminUserId: string | undefined;
let credentialId: string | undefined;

try {
  const now = new Date();
  memberAUserId = randomUUID();
  await db("users").insert({
    id: memberAUserId,
    email: memberAEmail,
    password_hash: await hashPassword(memberAPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  memberBUserId = randomUUID();
  await db("users").insert({
    id: memberBUserId,
    email: memberBEmail,
    password_hash: await hashPassword(memberBPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });
  adminUserId = randomUUID();
  await db("users").insert({
    id: adminUserId,
    email: adminEmail,
    password_hash: await hashPassword(adminPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "admin",
    status: "active",
    created_at: now,
    updated_at: now
  });
  console.log("ok - two role=member accounts and one role=admin account seeded");

  // Per-user OAuth connector credential (replaces the old static,
  // PROJECT_MEMORY_OAUTH_CLIENT_ID/_SECRET pair) -- owned by the admin user
  // seeded above; mintOAuthAccessToken below authorizes with it using
  // member A's session, exactly as the design intends (the app credential
  // and the logged-in identity are independent).
  await db("oauth_clients").insert({
    id: randomUUID(),
    owner_user_id: adminUserId,
    client_id: oauthClientId,
    client_secret_hash: hashToken(oauthClientSecret),
    client_secret_hint: oauthClientSecret.slice(-4),
    created_at: now,
    last_used_at: null
  });
  console.log("ok - oauth_clients row seeded for the admin user (replaces the old static client env vars)");

  const memberACookie = await login(memberAEmail, memberAPassword);
  const memberBCookie = await login(memberBEmail, memberBPassword);
  const adminCookie = await login(adminEmail, adminPassword);
  console.log("ok - sessions established for both members and the admin");

  // T-MEMORY-0xx SSO: OAuth connectors now authenticate through a real
  // Marrow login (session cookie), not a shared magic token -- member A's
  // own session mints this OAuth bearer, same as a real Claude Code/ChatGPT
  // connector would after the user signs in through the frontend.
  const oauthAccessToken = await mintOAuthAccessToken(memberACookie);
  console.log("ok - minted a read+write OAuth bearer token (same shape a Claude Code/ChatGPT connector would carry)");

  // --- Session-required enforcement: static token, OAuth, and the
  // no-token/"none" dev mode all lack sessionUserId and hit the exact same
  // requireSessionUserId() branch in pg-tool-service.ts -- exercising it via
  // the static token and via OAuth covers that shared code path for all
  // three non-session caller classes the task calls out. ----------------
  const staticCreateAttempt = await callTool(
    "git.credential_create",
    { host: GOOD_HOST, label: "should not be created", token: "glpat-should-not-be-stored" },
    staticHeaders()
  );
  assert(staticCreateAttempt.status === 200, `Expected a normal tool-response envelope, not an HTTP error. Status: ${staticCreateAttempt.status}`);
  const staticCreateBody = staticCreateAttempt.json as ToolResponse<unknown>;
  assert(staticCreateBody.ok === false, "git.credential_create over the static token should fail, not silently succeed for nobody's account.");
  assert(
    staticCreateBody.ok === false && staticCreateBody.error.code === "UNAUTHORIZED",
    `Expected UNAUTHORIZED, got: ${JSON.stringify(staticCreateBody)}`
  );
  assert(
    staticCreateBody.ok === false && /logged-in session/i.test(staticCreateBody.error.message),
    `Error message should clearly explain the session requirement, got: ${staticCreateBody.ok === false ? staticCreateBody.error.message : ""}`
  );
  console.log('ok - git.credential_create over the static token fails clearly ("requires a logged-in session"), not a silent no-op');

  const oauthCreateAttempt = await callTool(
    "git.credential_create",
    { host: GOOD_HOST, label: "should not be created", token: "glpat-should-not-be-stored" },
    oauthHeaders(oauthAccessToken)
  );
  const oauthCreateBody = oauthCreateAttempt.json as ToolResponse<unknown>;
  assert(
    oauthCreateBody.ok === false && oauthCreateBody.error.code === "UNAUTHORIZED",
    `OAuth-sourced git.credential_create should fail with UNAUTHORIZED (no session), got: ${JSON.stringify(oauthCreateBody)}`
  );
  console.log("ok - git.credential_create over an OAuth bearer (read+write scope, but no session) is denied the same way -- scope is not the gate here, session is");

  // Scoped to GOOD_HOST + this run's `unique` timestamp, not a global
  // count -- this smoke test runs against the real shared dev Postgres
  // (same convention as every other smoke-gateway-*.ts script), which can
  // already hold unrelated git_credentials rows from real usage (e.g. an
  // operator's own credential added through the actual profile UI). A bare
  // `count(*) === 0` assertion would be a false failure the moment any real
  // row exists, unrelated to whether these two denied attempts were true
  // no-ops.
  const noCredCount = await db("git_credentials").where({ host: GOOD_HOST }).count<{ count: string }[]>("id as count").first();
  assert(Number(noCredCount?.count ?? 0) === 0, "No git_credentials row for GOOD_HOST should exist yet -- both denied attempts above must be true no-ops.");
  console.log("ok - the two denied create attempts above wrote nothing to git_credentials");

  // --- Credential create (member A), token never in the response --------
  const rawToken = "glpat-SmokeTestToken8899";
  const createResult = await callTool(
    "git.credential_create",
    { host: GOOD_HOST, label: "CI runner PAT", token: rawToken },
    sessionHeaders(memberACookie)
  );
  const createBody = expectData<{ id: string; host: string; label: string; createdAt: string }>(unwrap(createResult));
  credentialId = createBody.id;
  assert(createBody.host === GOOD_HOST, "Created credential has the wrong host.");
  assert(createBody.label === "CI runner PAT", "Created credential has the wrong label.");
  assert(typeof createBody.createdAt === "string" && createBody.createdAt.length > 0, "Created credential is missing createdAt.");
  assert(!JSON.stringify(createResult.json).includes(rawToken), "git.credential_create response must never include the raw token.");
  assert(!("token" in createBody), "git.credential_create response must not have a token field at all.");
  console.log("ok - git.credential_create (member session) returns {id, host, label, createdAt} and never the token");

  // --- Encryption actually happened --------------------------------------
  const dbRow = await db("git_credentials").where({ id: credentialId }).first();
  assert(dbRow, "Created credential row not found in git_credentials.");
  assert(dbRow!.owner_user_id === memberAUserId, "Credential row's owner_user_id should be member A.");
  assert(dbRow!.token_enc !== rawToken, "token_enc must not equal the raw token (i.e. must actually be encrypted).");
  assert(!String(dbRow!.token_enc).includes(rawToken), "token_enc ciphertext must not contain the raw token as a substring.");
  assert(decryptGitToken(String(dbRow!.token_enc)) === rawToken, "Decrypting token_enc must recover the exact original token (round trip).");
  console.log("ok - the stored token_enc is genuine AES-256-GCM ciphertext, not the raw token, and round-trips correctly");

  // --- List: token never present, hint is last-4-only --------------------
  const listResult = await callTool("git.credential_list", {}, sessionHeaders(memberACookie));
  const listBody = expectData<{ credentials: Array<{ id: string; host: string; label: string; lastUsedAt: string | null; tokenHint?: string }> }>(unwrap(listResult));
  assert(listBody.credentials.length === 1, `Member A should see exactly one credential. Got: ${listBody.credentials.length}`);
  const listed = listBody.credentials[0]!;
  assert(listed.id === credentialId, "Listed credential id does not match the created one.");
  assert(listed.lastUsedAt === null, "A never-used credential should have lastUsedAt=null.");
  assert(listed.tokenHint === rawToken.slice(-4), `tokenHint should be the last 4 characters of the token. Got: ${listed.tokenHint}`);
  assert(!JSON.stringify(listResult.json).includes(rawToken), "git.credential_list response must never include the raw token.");
  console.log("ok - git.credential_list returns host/label/dates and at most a last-4 hint -- never the token value");

  // --- Member B sees none of member A's credentials ----------------------
  const memberBList = expectData<{ credentials: unknown[] }>(unwrap(await callTool("git.credential_list", {}, sessionHeaders(memberBCookie))));
  assert(memberBList.credentials.length === 0, "Member B must not see member A's credentials.");
  console.log("ok - git.credential_list is scoped to the calling session's own credentials, not every user's");

  // --- Ownership enforcement: member B cannot delete member A's credential
  const crossDelete = await callTool("git.credential_delete", { id: credentialId }, sessionHeaders(memberBCookie));
  const crossDeleteBody = crossDelete.json as ToolResponse<unknown>;
  assert(
    crossDeleteBody.ok === false && crossDeleteBody.error.code === "GIT_CREDENTIAL_NOT_FOUND",
    `Cross-owner delete should fail with GIT_CREDENTIAL_NOT_FOUND (not leak that it belongs to someone else), got: ${JSON.stringify(crossDeleteBody)}`
  );
  const stillThere = await db("git_credentials").where({ id: credentialId }).first();
  assert(stillThere, "Credential must survive a denied cross-owner delete attempt.");
  console.log("ok - a different member's session cannot delete another user's credential (ownership-scoped, not just id-scoped)");

  // --- git.pipeline_status: no credential for host -----------------------
  const noCredResult = await callTool("git.pipeline_status", { host: NO_CRED_HOST, project: "group/project" }, sessionHeaders(memberACookie));
  const noCredBody = noCredResult.json as ToolResponse<unknown>;
  assert(
    noCredBody.ok === false && noCredBody.error.code === "GIT_CREDENTIAL_REQUIRED",
    `Missing-credential pipeline_status should fail with GIT_CREDENTIAL_REQUIRED, got: ${JSON.stringify(noCredBody)}`
  );
  assert(
    noCredBody.ok === false && new RegExp(`No credential stored for host ${escapeRegExp(NO_CRED_HOST)}`, "i").test(noCredBody.error.message) && /profile/i.test(noCredBody.error.message),
    `Error message should be the clear, specific one the task requires, got: ${noCredBody.ok === false ? noCredBody.error.message : ""}`
  );
  console.log('ok - git.pipeline_status for a host with no stored credential fails clearly ("add one in your profile first"), not a silent failure');
  assertGitlabRequestCount(0, "No credential means git.pipeline_status must never even attempt an outbound GitLab call.");

  // --- git.pipeline_status: real (faked) success path ---------------------
  const pipelineResult = await callTool(
    "git.pipeline_status",
    { host: GOOD_HOST, project: "group/project", ref: "main" },
    sessionHeaders(memberACookie)
  );
  const pipelineBody = expectData<{ status: string; ref: string; sha: string; webUrl: string; jobs: Array<{ name: string; status: string }> }>(unwrap(pipelineResult));
  assert(pipelineBody.status === "running", `Unexpected pipeline status. Got: ${JSON.stringify(pipelineBody)}`);
  assert(pipelineBody.ref === "main", "Unexpected pipeline ref.");
  assert(pipelineBody.sha === "abc123def456", "Unexpected pipeline sha.");
  assert(pipelineBody.webUrl.includes(GOOD_HOST), "webUrl should point at the resolved host.");
  assert(pipelineBody.jobs.length === 3, `Expected 3 jobs from the fake GitLab jobs endpoint. Got: ${pipelineBody.jobs.length}`);
  assert(pipelineBody.jobs.some((job) => job.name === "deploy" && job.status === "running"), "Missing expected job in pipeline_status result.");
  assertGitlabRequestCount(2, `Expected exactly 2 outbound calls (pipelines list + jobs list) to the fake GitLab client. Got: ${gitlabRequestCount}`);
  console.log("ok - git.pipeline_status resolves the caller's own credential server-side and returns a structured result, without ever exposing the token");

  const usedRow = await db("git_credentials").where({ id: credentialId }).first();
  assert(usedRow!.last_used_at !== null, "last_used_at should be stamped after a successful pipeline_status call.");
  console.log("ok - git.pipeline_status updates last_used_at on the resolved credential");

  // --- git.pipeline_status: GitLab itself rejects the token (401) --------
  const rejectingCreate = expectData<{ id: string }>(
    unwrap(await callTool("git.credential_create", { host: REJECTING_HOST, label: "stale token", token: "glpat-stale-000000" }, sessionHeaders(memberACookie)))
  );
  const rejectingResult = await callTool("git.pipeline_status", { host: REJECTING_HOST, project: "group/project" }, sessionHeaders(memberACookie));
  const rejectingBody = rejectingResult.json as ToolResponse<unknown>;
  assert(
    rejectingBody.ok === false && rejectingBody.error.code === "UNAUTHORIZED",
    `A GitLab-side 401 should surface as a clear UNAUTHORIZED, not a generic/opaque failure. Got: ${JSON.stringify(rejectingBody)}`
  );
  assert(
    rejectingBody.ok === false && /expired or revoked/i.test(rejectingBody.error.message),
    `Error message should explain the token may be stale, got: ${rejectingBody.ok === false ? rejectingBody.error.message : ""}`
  );
  await db("git_credentials").where({ id: rejectingCreate.id }).del();
  console.log("ok - a GitLab-side 401 (revoked/expired stored token) surfaces as a clear, distinct error");

  // --- Delete: owner can delete their own credential ----------------------
  const deleteResult = await callTool("git.credential_delete", { id: credentialId }, sessionHeaders(memberACookie));
  const deleteBody = expectData<{ deleted: boolean }>(unwrap(deleteResult));
  assert(deleteBody.deleted === true, "git.credential_delete should report deleted: true.");
  const deletedRow = await db("git_credentials").where({ id: credentialId }).first();
  assert(!deletedRow, "git.credential_delete must actually hard-delete the row.");
  const listAfterDelete = expectData<{ credentials: unknown[] }>(unwrap(await callTool("git.credential_list", {}, sessionHeaders(memberACookie))));
  assert(listAfterDelete.credentials.length === 0, "Deleted credential must no longer appear in git.credential_list.");
  credentialId = undefined;
  console.log("ok - git.credential_delete actually removes the row; it no longer appears in list");

  // Deleting an already-deleted / unknown id is a clean not-found, not a crash.
  const redeleteResult = await callTool("git.credential_delete", { id: randomUUID() }, sessionHeaders(memberACookie));
  const redeleteBody = redeleteResult.json as ToolResponse<unknown>;
  assert(redeleteBody.ok === false && redeleteBody.error.code === "GIT_CREDENTIAL_NOT_FOUND", "Deleting an unknown id should fail cleanly with GIT_CREDENTIAL_NOT_FOUND.");
  console.log("ok - deleting an unknown/already-deleted credential id fails cleanly, not with a 500");

  // --- Admin-role session can manage its own credentials too (write tier,
  // not gated behind admin scope -- see the access:"write" comment on
  // git.credential_delete in tool-definitions.ts) --------------------------
  const adminCreate = expectData<{ id: string }>(
    unwrap(await callTool("git.credential_create", { host: GOOD_HOST, label: "admin's own PAT", token: "glpat-admin-owned-0001" }, sessionHeaders(adminCookie)))
  );
  const adminDelete = expectData<{ deleted: boolean }>(
    unwrap(await callTool("git.credential_delete", { id: adminCreate.id }, sessionHeaders(adminCookie)))
  );
  assert(adminDelete.deleted === true, "An admin-role session should be able to create and delete its own git credential without needing elevation.");
  console.log("ok - an admin-role session can manage its own git credentials too (write tier is sufficient, no admin-scope gate)");

  // --- Agent (OAuth) read access falls back to the instance admin --------
  // The whole point of this task: an agent connected over OAuth (no
  // sessionUserId) has no credential of its own to read, but read-only use
  // of an already-stored credential should still work for it by resolving
  // to the instance's primary admin (resolveGitCredentialReader in
  // pg-tool-service.ts) -- otherwise the feature can't do the thing it was
  // built for (an agent checking CI status through PMem). Managing the
  // credential itself (create/delete) stays session-only regardless, per
  // the earlier assertions.
  //
  // This smoke run's OWN admin user is deliberately NOT assumed to be the
  // one the fallback resolves to: this script runs against the real shared
  // dev Postgres (same convention as every other smoke-gateway-*.ts), which
  // already has a real, earlier-created admin account. Querying for the
  // actual earliest-created admin (the exact same query
  // resolveGitCredentialReader() runs) and inserting the test row directly
  // for THAT user -- rather than logging in as it, which this script has no
  // credentials to do -- tests the real resolution behavior instead of an
  // assumption that happens to be false in this environment.
  const resolvedAdmin = await db("users").select("id").where({ role: "admin" }).orderBy("created_at", "asc").first();
  assert(resolvedAdmin, "Expected at least one admin user to exist (this script itself just created one, if no other existed).");
  const fallbackCredentialId = randomUUID();
  const fallbackNow = new Date();
  await db("git_credentials").insert({
    id: fallbackCredentialId,
    owner_user_id: resolvedAdmin!.id,
    host: GOOD_HOST,
    label: `oauth-fallback-smoke-${unique}`,
    token_enc: encryptGitToken("glpat-oauth-fallback-owned-by-resolved-admin"),
    created_at: fallbackNow,
    updated_at: fallbackNow,
    last_used_at: null
  });
  try {
    const oauthList = expectData<{ credentials: Array<{ id: string; host: string }> }>(
      unwrap(await callTool("git.credential_list", {}, oauthHeaders(oauthAccessToken)))
    );
    assert(
      oauthList.credentials.some((credential) => credential.id === fallbackCredentialId),
      "git.credential_list over OAuth should fall back to the actual resolved (earliest-created) admin's credentials, not fail or return nothing."
    );
    console.log("ok - git.credential_list over an OAuth bearer falls back to the resolved instance admin's own credentials (read-only, no session needed)");

    const oauthPipeline = expectData<{ status: string; jobs: Array<{ name: string }> }>(
      unwrap(await callTool("git.pipeline_status", { host: GOOD_HOST, project: "group/project", ref: "main" }, oauthHeaders(oauthAccessToken)))
    );
    assert(oauthPipeline.status === "running", "git.pipeline_status over OAuth should resolve the admin's credential for GOOD_HOST and return real pipeline data.");
    console.log("ok - git.pipeline_status over an OAuth bearer resolves the instance admin's credential and returns real pipeline data -- this is the actual motivating use case");

    const oauthCreateStillDenied = await callTool(
      "git.credential_create",
      { host: GOOD_HOST, label: "oauth should still not be able to create", token: "glpat-still-should-not-be-stored" },
      oauthHeaders(oauthAccessToken)
    );
    const oauthCreateStillDeniedBody = oauthCreateStillDenied.json as ToolResponse<unknown>;
    assert(
      oauthCreateStillDeniedBody.ok === false && oauthCreateStillDeniedBody.error.code === "UNAUTHORIZED",
      "Read fallback must not extend to credential management -- git.credential_create over OAuth must still be denied."
    );
    console.log("ok - the read-only fallback does not extend to git.credential_create -- OAuth still cannot mint credentials");
  } finally {
    // Cleanup is unconditional (finally, not just at the script's own
    // top-level catch/cleanup block) because this row is owned by whatever
    // real admin already existed in the shared dev DB, not one of this
    // script's own disposable seeded users -- it must not linger in that
    // real account's credential list regardless of whether the assertions
    // above passed.
    await db("git_credentials").where({ id: fallbackCredentialId }).del();
  }

  // --- GraphQL: createGitCredential / gitCredentials / deleteGitCredential
  const graphqlCreated = await graphql<{ createGitCredential: { id: string; host: string; label: string; createdAt: string; lastUsedAt: string | null } }>(
    `mutation Create($host: String!, $label: String!, $token: String!) {
       createGitCredential(host: $host, label: $label, token: $token) { id host label createdAt lastUsedAt }
     }`,
    { host: GOOD_HOST, label: "graphql PAT", token: "glpat-graphql-token-7777" },
    memberACookie
  );
  const graphqlCredentialId = graphqlCreated.createGitCredential.id;
  assert(graphqlCreated.createGitCredential.host === GOOD_HOST, "GraphQL createGitCredential returned the wrong host.");
  assert(!JSON.stringify(graphqlCreated).includes("glpat-graphql-token-7777"), "GraphQL createGitCredential response must never include the raw token.");
  assert(!("token" in graphqlCreated.createGitCredential), "GraphQL GitCredential type must not expose a token field.");
  console.log("ok - GraphQL createGitCredential mutation works and never returns the token");

  const graphqlListed = await graphql<{ gitCredentials: Array<{ id: string }> }>(
    `query { gitCredentials { id host label createdAt lastUsedAt } }`,
    {},
    memberACookie
  );
  assert(
    graphqlListed.gitCredentials.some((credential) => credential.id === graphqlCredentialId),
    "GraphQL gitCredentials query did not include the just-created credential."
  );
  console.log("ok - GraphQL gitCredentials query lists the credential");

  const graphqlPipeline = await graphql<{ gitPipelineStatus: { status: string; jobs: Array<{ name: string }> } }>(
    `query Status($host: String!, $project: String!, $ref: String) {
       gitPipelineStatus(host: $host, project: $project, ref: $ref)
     }`,
    { host: GOOD_HOST, project: "group/project", ref: "main" },
    memberACookie
  );
  assert(graphqlPipeline.gitPipelineStatus.status === "running", "GraphQL gitPipelineStatus returned unexpected data.");
  console.log("ok - GraphQL gitPipelineStatus query proxies through to the same resolver as the MCP tool");

  const graphqlDeleted = await graphql<{ deleteGitCredential: boolean }>(
    `mutation Delete($id: ID!) { deleteGitCredential(id: $id) }`,
    { id: graphqlCredentialId },
    memberACookie
  );
  assert(graphqlDeleted.deleteGitCredential === true, "GraphQL deleteGitCredential should return true.");
  const graphqlDeletedRow = await db("git_credentials").where({ id: graphqlCredentialId }).first();
  assert(!graphqlDeletedRow, "GraphQL deleteGitCredential must actually delete the row.");
  console.log("ok - GraphQL deleteGitCredential mutation actually deletes the row");

  // --- GraphQL: static token still can't manage credentials (mutation),
  // but CAN read them via the same admin-fallback as OAuth (query) --------
  const graphqlStaticCreateResponse = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${staticToken}` },
    body: JSON.stringify({
      query: `mutation { createGitCredential(host: "${GOOD_HOST}", label: "static should not create", token: "glpat-static-should-not-be-stored") { id } }`
    })
  });
  const graphqlStaticCreateBody = (await graphqlStaticCreateResponse.json()) as { errors?: Array<{ message: string }> };
  assert(graphqlStaticCreateBody.errors?.length, "GraphQL createGitCredential over the static token (no session) should return a GraphQL error, not data.");
  assert(
    graphqlStaticCreateBody.errors!.some((error) => /manage credentials/i.test(error.message)),
    `GraphQL error should explain the session requirement for managing credentials, got: ${JSON.stringify(graphqlStaticCreateBody.errors)}`
  );
  console.log("ok - GraphQL createGitCredential over the static token (no session) fails clearly, same UNAUTHORIZED reasoning as the MCP tool");

  const graphqlStaticListResponse = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${staticToken}` },
    body: JSON.stringify({ query: `query { gitCredentials { id } }` })
  });
  const graphqlStaticListBody = (await graphqlStaticListResponse.json()) as { data?: { gitCredentials?: Array<{ id: string }> }; errors?: unknown };
  assert(!graphqlStaticListBody.errors, `GraphQL gitCredentials over the static token should succeed via the admin fallback, got errors: ${JSON.stringify(graphqlStaticListBody.errors)}`);
  assert(Array.isArray(graphqlStaticListBody.data?.gitCredentials), "GraphQL gitCredentials over the static token should return an array (the resolved admin's credentials, possibly empty at this point in the script).");
  console.log("ok - GraphQL gitCredentials over the static token succeeds via the same admin-fallback read path as OAuth");

  console.log(`Gateway git-credentials smoke test passed using ${started.url}`);
} finally {
  if (credentialId) {
    await db("git_credentials").where({ id: credentialId }).del();
  }
  if (memberAUserId) {
    await db("git_credentials").where({ owner_user_id: memberAUserId }).del();
    await db("sessions").where({ user_id: memberAUserId }).del();
    await db("users").where({ id: memberAUserId }).del();
  }
  if (memberBUserId) {
    await db("git_credentials").where({ owner_user_id: memberBUserId }).del();
    await db("sessions").where({ user_id: memberBUserId }).del();
    await db("users").where({ id: memberBUserId }).del();
  }
  if (adminUserId) {
    await db("oauth_clients").where({ owner_user_id: adminUserId }).del();
    await db("git_credentials").where({ owner_user_id: adminUserId }).del();
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  await db("gateway_clients").where("label", "like", "Git Credentials Smoke%").del();
  await started.stop();
  await service.close();
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${started.url}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert(response.status === 200, `Login for ${email} failed. Status: ${response.status}`);
  const cookie = sessionCookieFrom(response);
  assert(cookie, `Login for ${email} did not set a session cookie.`);
  return cookie!;
}

async function mintOAuthAccessToken(sessionCookie: string): Promise<string> {
  const codeVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());

  // T-MEMORY-0xx SSO: POST /oauth/authorize is now session-cookie-backed
  // (JSON body, no magic_token) -- the frontend calls this exact shape
  // after its own login/consent screen confirms a pmem_session.
  const authorize = await fetch(`${started.url}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: sessionCookie },
    body: JSON.stringify({
      response_type: "code",
      client_id: oauthClientId,
      redirect_uri: redirectUri,
      scope: "memory:read memory:write",
      state: "git-credentials-smoke-state",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      resource: publicUrl
    })
  });
  const authorizeBody = (await authorize.json()) as { data?: { redirectUri?: string } };
  assert(authorize.status === 200, `OAuth authorize (session) failed. Status: ${authorize.status}, body: ${JSON.stringify(authorizeBody)}`);
  assert(authorizeBody.data?.redirectUri, "OAuth authorize did not return a redirectUri.");
  const code = new URL(authorizeBody.data!.redirectUri!).searchParams.get("code");
  assert(code, "OAuth authorize redirect missing code.");

  const tokenResponse = await fetch(`${started.url}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      code_verifier: codeVerifier,
      resource: publicUrl
    })
  });
  assert(tokenResponse.status === 200, "OAuth token exchange failed.");
  const tokenBody = (await tokenResponse.json()) as { access_token?: string };
  assert(tokenBody.access_token, "OAuth token exchange did not return an access_token.");
  return tokenBody.access_token!;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "Git Credentials Smoke Static"
  };
}

function oauthHeaders(bearer: string): Record<string, string> {
  return {
    authorization: `Bearer ${bearer}`,
    "x-project-memory-client-id": `git-credentials-smoke-agent-${unique}`,
    "x-project-memory-client-label": "Git Credentials Smoke Agent"
  };
}

function sessionHeaders(cookie: string): Record<string, string> {
  return { cookie };
}

async function callTool(
  tool: string,
  input: unknown,
  headers: Record<string, string>
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ tool, input })
  });
  return { status: response.status, json: await response.json() };
}

async function graphql<T>(query: string, variables: Record<string, unknown>, cookie: string): Promise<T> {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ query, variables })
  });
  assert(response.ok, `GraphQL HTTP request returned ${response.status}.`);
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  assert(body.data, "GraphQL response did not include data.");
  return body.data;
}

function unwrap(result: { status: number; json: unknown }): ToolResponse<unknown> {
  assert(result.status === 200, `Expected a 200 tool response, got HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json as ToolResponse<unknown>;
}

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
}

function sessionCookieFrom(response: Response): string | null {
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return null;
  }
  return raw.split(";")[0] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
