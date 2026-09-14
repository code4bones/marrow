// "Ask Marrow" (owner's request, 2026-09-14), end to end against the real
// gateway (ephemeral local instance, real Postgres) -- same style as
// scripts/smoke-gateway-environment-variables.ts. Deliberately does NOT
// call a real DeepSeek instance: PgToolService now takes an injectable
// llmHttpFetch (third constructor param, mirroring gitHttpFetch) and this
// script passes a fake that serves canned chat-completion/models payloads
// from an in-memory map keyed by URL, same "no outbound network
// dependency" reasoning as the git-credentials smoke test.
//
// Covers: provider credential create/list/update(default)/delete round
// trip (key never in any response) -> ai.ask with no default credential
// failing clearly (AI_PROVIDER_REQUIRED) -> a successful loop actually
// calling a real Marrow tool (project.list) via service.call with the
// CALLER's own context, proving project-membership scoping holds through
// the chat loop (a role=member not in a project never sees it via the
// assistant) -> conversation persistence + clear -> the iteration cap ->
// ai.available_models proxying the fake /models response both pre-save
// (raw apiKey) and post-save (stored credential) -> selecting a
// not-yet-wired-up provider (claude) as default failing with a clear
// error, not a crash.
import { randomUUID } from "node:crypto";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { createOAuthFacadeFromEnv } from "../src/gateway/oauth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { gatewayToolClaudeName } from "../src/gateway/tool-definitions.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

if (!process.env.TOTP_ENC_KEY) {
  process.env.TOTP_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}
if (!process.env.AI_PROVIDER_ENC_KEY) {
  process.env.AI_PROVIDER_ENC_KEY = Buffer.from(randomUUID() + randomUUID()).subarray(0, 32).toString("base64");
}

const unique = Date.now();

const FAKE_MODELS = [
  { id: "deepseek-flash", object: "model", owned_by: "deepseek" },
  { id: "deepseek-v4-pro", object: "model", owned_by: "deepseek" }
];

const PROJECT_LIST_CLAUDE_NAME = gatewayToolClaudeName("project.list");
const GATEWAY_ABOUT_CLAUDE_NAME = gatewayToolClaudeName("gateway.about");

let fakeDeepSeekRequestCount = 0;

// A minimal, deterministic stand-in for DeepSeek's OpenAI-compatible
// /chat/completions -- round 0 (no tool messages yet in the conversation)
// always requests project.list; round 1+ echoes back whatever the tool
// message actually contained as the final answer, so the test can assert
// on real scoped data flowing all the way through. A special marker in the
// user's own message ("LOOP_FOREVER_MARKER") makes it request a tool call
// forever, to exercise the iteration cap.
const fakeDeepSeekHttpFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.pathname === "/models") {
    return new Response(JSON.stringify({ object: "list", data: FAKE_MODELS }), { status: 200 });
  }
  if (url.pathname === "/chat/completions") {
    fakeDeepSeekRequestCount += 1;
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string | null }> };
    const toolMessages = body.messages.filter((m) => m.role === "tool");
    const firstUserMessage = body.messages.find((m) => m.role === "user")?.content ?? "";

    if (firstUserMessage.includes("LOOP_FOREVER_MARKER")) {
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `call_${toolMessages.length}`, type: "function", function: { name: GATEWAY_ABOUT_CLAUDE_NAME, arguments: "{}" } }] } }]
      });
    }
    if (toolMessages.length === 0) {
      return jsonResponse({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: PROJECT_LIST_CLAUDE_NAME, arguments: "{}" } }] } }]
      });
    }
    return jsonResponse({
      choices: [{ message: { role: "assistant", content: `TOOL_RESULT_ECHO:${toolMessages[toolMessages.length - 1].content}`, tool_calls: [] } }]
    });
  }
  throw new Error(`fakeDeepSeekHttpFetch: unexpected request to ${url.toString()}`);
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const db = createPgKnex();
const service = new PgToolService(db, fetch, fakeDeepSeekHttpFetch);
const staticToken = `gateway-ai-chat-smoke-static-${unique}`;
const auth = createAuthFacade(db);
const publicUrl = "https://pmem-ai-chat-smoke.example/api";

const oauth = createOAuthFacadeFromEnv({
  ...process.env,
  PROJECT_MEMORY_PUBLIC_URL: publicUrl,
  PROJECT_MEMORY_OAUTH_ISSUER: publicUrl,
  PROJECT_MEMORY_OAUTH_AUDIENCE: publicUrl
}, db);
assert(oauth, "OAuth facade was not created.");

const started = await startGatewayServer(service, { host: "127.0.0.1", port: 0, token: staticToken, oauth, auth });

const ownerEmail = `ai-chat-smoke-owner-${unique}@example.test`;
const ownerPassword = "smoke-ai-chat-owner-password-1";
const outsiderEmail = `ai-chat-smoke-outsider-${unique}@example.test`;
const outsiderPassword = "smoke-ai-chat-outsider-password-1";

let ownerUserId: string | undefined;
let outsiderUserId: string | undefined;
let projectSlug: string | undefined;
let credentialId: string | undefined;

try {
  const now = new Date();
  ownerUserId = randomUUID();
  await db("users").insert({
    id: ownerUserId, email: ownerEmail, password_hash: await hashPassword(ownerPassword),
    email_verified_at: now, totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });
  outsiderUserId = randomUUID();
  await db("users").insert({
    id: outsiderUserId, email: outsiderEmail, password_hash: await hashPassword(outsiderPassword),
    email_verified_at: now, totp_enabled: false, role: "member", status: "active", created_at: now, updated_at: now
  });
  console.log("ok - a project owner and an unrelated outsider seeded");

  const ownerCookie = await login(ownerEmail, ownerPassword);
  const outsiderCookie = await login(outsiderEmail, outsiderPassword);
  console.log("ok - sessions established for both accounts");

  projectSlug = `ai-chat-smoke-project-${unique}`;
  await callTool("project.create", { slug: projectSlug, title: "AI Chat Smoke Project" }, sessionHeaders(ownerCookie));
  console.log("ok - a project created, visible only to its owner (outsider is not a member)");

  // --- ai.conversation_create + ai.conversations_list ----------------------
  const ownerConversation = expectData<{ id: string; title: string }>(
    unwrap(await callTool("ai.conversation_create", { title: "My first chat" }, sessionHeaders(ownerCookie)))
  );
  const ownerConversationId = ownerConversation.id;
  assert(ownerConversation.title === "My first chat", `Unexpected created conversation. Got: ${JSON.stringify(ownerConversation)}`);
  const ownerConversationsListed = expectData<{ conversations: Array<{ id: string; title: string }> }>(
    unwrap(await callTool("ai.conversations_list", {}, sessionHeaders(ownerCookie)))
  );
  assert(ownerConversationsListed.conversations.some((c) => c.id === ownerConversationId), "ai.conversations_list should include the just-created conversation.");
  console.log("ok - ai.conversation_create requires a title and ai.conversations_list returns it");

  const createWithoutTitle = await callTool("ai.conversation_create", {}, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(createWithoutTitle), "VALIDATION_ERROR", "ai.conversation_create with no title should fail clearly.");
  console.log("ok - ai.conversation_create requires a non-empty title");

  // --- ai.ask with no default provider configured -------------------------
  const askNoProvider = await callTool("ai.ask", { conversationId: ownerConversationId, message: "hello" }, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(askNoProvider), "AI_PROVIDER_REQUIRED", "ai.ask with no default AI provider should fail clearly, not silently proceed.");
  console.log("ok - ai.ask requires a default AI provider credential");

  // --- ai.ask against a conversation the caller doesn't own -----------------
  const askUnknownConversation = await callTool("ai.ask", { conversationId: `not-${ownerConversationId}`, message: "hello" }, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(askUnknownConversation), "AI_CONVERSATION_NOT_FOUND", "ai.ask against a nonexistent/unowned conversation id should fail clearly.");
  console.log("ok - ai.ask requires an owned, existing conversation");

  // --- Provider credential CRUD -------------------------------------------
  const created = expectData<{ id: string; provider: string; isDefault: boolean; keyHint?: string }>(
    unwrap(await callTool("ai.provider_create", { provider: "deepseek", label: "My DeepSeek key", apiKey: "sk-owner-deepseek-secret-000", isDefault: true }, sessionHeaders(ownerCookie)))
  );
  credentialId = created.id;
  assert(created.provider === "deepseek" && created.isDefault === true, `Unexpected created credential. Got: ${JSON.stringify(created)}`);
  assert(!("apiKey" in created) && JSON.stringify(created).indexOf("sk-owner-deepseek-secret-000") === -1, "The raw API key must never appear in ai.provider_create's response.");
  console.log("ok - ai.provider_create stores a credential and marks it default; the raw key never appears in the response");

  const listed = expectData<{ credentials: Array<{ id: string; keyHint?: string }> }>(
    unwrap(await callTool("ai.provider_list", {}, sessionHeaders(ownerCookie)))
  );
  const listedCreated = listed.credentials.find((c) => c.id === credentialId);
  assert(listedCreated?.keyHint === "-000", `ai.provider_list should include the created credential with a last-4 hint. Got: ${JSON.stringify(listedCreated)}`);
  assert(JSON.stringify(listed).indexOf("sk-owner-deepseek-secret-000") === -1, "ai.provider_list must never leak the raw key.");
  console.log("ok - ai.provider_list returns the credential with a hint, never the real key");

  const updated = expectData<{ model: string | null }>(
    unwrap(await callTool("ai.provider_update", { id: credentialId, model: "deepseek-flash" }, sessionHeaders(ownerCookie)))
  );
  assert(updated.model === "deepseek-flash", `ai.provider_update should have set the model. Got: ${JSON.stringify(updated)}`);
  console.log("ok - ai.provider_update sets the pinned model");

  // --- ai.available_models: pre-save (raw apiKey) and post-save (stored) --
  const modelsPreSave = expectData<{ models: string[] }>(
    unwrap(await callTool("ai.available_models", { provider: "deepseek", apiKey: "sk-some-other-unsaved-key" }, sessionHeaders(ownerCookie)))
  );
  assert(modelsPreSave.models.includes("deepseek-flash") && modelsPreSave.models.includes("deepseek-v4-pro"), `Unexpected pre-save models. Got: ${JSON.stringify(modelsPreSave)}`);
  console.log("ok - ai.available_models previews models for a freshly-typed (not yet saved) API key");

  const modelsPostSave = expectData<{ models: string[] }>(
    unwrap(await callTool("ai.available_models", { provider: "deepseek" }, sessionHeaders(ownerCookie)))
  );
  assert(modelsPostSave.models.includes("deepseek-flash"), "ai.available_models should also work from an already-stored credential (no apiKey given).");
  console.log("ok - ai.available_models also works from an already-stored credential");

  // --- ai.ask: the loop actually calls a real Marrow tool with the
  // caller's own scoping ----------------------------------------------------
  const askOwner = expectData<{ role: string; content: string }>(
    unwrap(await callTool("ai.ask", { conversationId: ownerConversationId, message: "what projects do I have?" }, sessionHeaders(ownerCookie)))
  );
  assert(askOwner.content.startsWith("TOOL_RESULT_ECHO:"), `ai.ask should have gone through the fake tool-call round trip. Got: ${JSON.stringify(askOwner)}`);
  assert(askOwner.content.includes(projectSlug), "The owner's own ai.ask should see their own project through project.list.");
  console.log("ok - ai.ask runs the loop, calling a real Marrow tool (project.list) and returning its actual result");

  const outsiderCredential = expectData<{ id: string }>(
    unwrap(await callTool("ai.provider_create", { provider: "deepseek", label: "outsider key", apiKey: "sk-outsider-deepseek-secret-000", isDefault: true }, sessionHeaders(outsiderCookie)))
  );
  await callTool("ai.provider_update", { id: outsiderCredential.id, model: "deepseek-flash" }, sessionHeaders(outsiderCookie));
  const outsiderConversation = expectData<{ id: string }>(
    unwrap(await callTool("ai.conversation_create", { title: "Outsider chat" }, sessionHeaders(outsiderCookie)))
  );
  const askOutsider = expectData<{ content: string }>(
    unwrap(await callTool("ai.ask", { conversationId: outsiderConversation.id, message: "what projects do I have?" }, sessionHeaders(outsiderCookie)))
  );
  assert(!askOutsider.content.includes(projectSlug), "A user who is not a member of the project must never see it through Ask Marrow -- project-membership scoping must hold through the chat loop.");
  console.log("ok - project-membership scoping holds through the chat loop: an outsider's ai.ask never sees a project they're not a member of");

  const outsiderAskInOwnerConversation = await callTool("ai.ask", { conversationId: ownerConversationId, message: "hi" }, sessionHeaders(outsiderCookie));
  assertFailureCode(unwrap(outsiderAskInOwnerConversation), "AI_CONVERSATION_NOT_FOUND", "One user must never be able to ai.ask into another user's conversation, even with their own valid provider credential.");
  console.log("ok - conversation ownership is enforced independently of provider credential ownership");

  await callTool("ai.provider_delete", { id: outsiderCredential.id }, sessionHeaders(outsiderCookie));
  await callTool("ai.conversation_delete", { id: outsiderConversation.id }, sessionHeaders(outsiderCookie));

  // --- Conversation persistence, rename, messages, delete -------------------
  const messagesAfterAsk = expectData<{ messages: Array<{ role: string; content: string }> }>(
    unwrap(await callTool("ai.conversation_messages", { id: ownerConversationId }, sessionHeaders(ownerCookie)))
  );
  assert(messagesAfterAsk.messages.length >= 2, `Expected at least the user+assistant turn from ai.ask above to be persisted. Got: ${messagesAfterAsk.messages.length}`);
  assert(messagesAfterAsk.messages[0].role === "user" && messagesAfterAsk.messages[0].content === "what projects do I have?", "First persisted message should be the user's own question, unmodified.");
  console.log("ok - ai.conversation_messages persists the user question + assistant answer, oldest first");

  const renamed = expectData<{ title: string }>(
    unwrap(await callTool("ai.conversation_rename", { id: ownerConversationId, title: "Renamed chat" }, sessionHeaders(ownerCookie)))
  );
  assert(renamed.title === "Renamed chat", `ai.conversation_rename should have updated the title. Got: ${JSON.stringify(renamed)}`);
  console.log("ok - ai.conversation_rename updates the title");

  const renameByOutsider = await callTool("ai.conversation_rename", { id: ownerConversationId, title: "hijacked" }, sessionHeaders(outsiderCookie));
  assertFailureCode(unwrap(renameByOutsider), "AI_CONVERSATION_NOT_FOUND", "A non-owner must never be able to rename someone else's conversation.");
  console.log("ok - only the owner can rename their own conversation");

  const deletedConversation = expectData<{ deleted: boolean }>(
    unwrap(await callTool("ai.conversation_delete", { id: ownerConversationId }, sessionHeaders(ownerCookie)))
  );
  assert(deletedConversation.deleted === true, "ai.conversation_delete should report deleted: true.");
  const messagesAfterDelete = await callTool("ai.conversation_messages", { id: ownerConversationId }, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(messagesAfterDelete), "AI_CONVERSATION_NOT_FOUND", "Deleting a conversation should also make its messages unreachable, not just hide it from the list.");
  console.log("ok - ai.conversation_delete removes the conversation and cascades its messages (ON DELETE CASCADE)");

  // --- Iteration cap (needs a fresh conversation, the one above was deleted) -
  const capConversation = expectData<{ id: string }>(
    unwrap(await callTool("ai.conversation_create", { title: "Cap test chat" }, sessionHeaders(ownerCookie)))
  );
  const requestCountBefore = fakeDeepSeekRequestCount;
  const loopForever = expectData<{ content: string }>(
    unwrap(await callTool("ai.ask", { conversationId: capConversation.id, message: "LOOP_FOREVER_MARKER please answer" }, sessionHeaders(ownerCookie)))
  );
  assert(!loopForever.content.startsWith("TOOL_RESULT_ECHO:"), "The iteration cap should have kicked in with its own fallback message, not a normal echoed answer.");
  assert(fakeDeepSeekRequestCount - requestCountBefore === 6, `Expected exactly 6 chat-completion round trips (the cap), got ${fakeDeepSeekRequestCount - requestCountBefore}.`);
  console.log("ok - the tool-use loop's iteration cap actually bounds a runaway loop instead of hanging");

  // --- A provider that isn't wired up yet -----------------------------------
  const claudeCredential = expectData<{ id: string }>(
    unwrap(await callTool("ai.provider_create", { provider: "claude", label: "not wired up yet", apiKey: "sk-fake-claude-key", isDefault: true }, sessionHeaders(ownerCookie)))
  );
  const askUnsupported = await callTool("ai.ask", { conversationId: capConversation.id, message: "hello" }, sessionHeaders(ownerCookie));
  assertFailureCode(unwrap(askUnsupported), "VALIDATION_ERROR", "Selecting an unimplemented provider as default should fail clearly when asked a question, not crash.");
  await callTool("ai.provider_delete", { id: claudeCredential.id }, sessionHeaders(ownerCookie));
  await callTool("ai.conversation_delete", { id: capConversation.id }, sessionHeaders(ownerCookie));
  console.log("ok - selecting claude (not yet wired up) as default fails ai.ask with a clear error, not a crash");

  // --- Delete round trip ------------------------------------------------------
  const deleted = expectData<{ deleted: boolean }>(unwrap(await callTool("ai.provider_delete", { id: credentialId }, sessionHeaders(ownerCookie))));
  assert(deleted.deleted === true, "ai.provider_delete should report deleted: true.");
  credentialId = undefined;
  console.log("ok - ai.provider_delete actually removes the credential");

  console.log(`Gateway AI chat smoke test passed using ${started.url}`);
} finally {
  if (credentialId) {
    await db("ai_provider_credentials").where({ id: credentialId }).del();
  }
  if (projectSlug) {
    await db("projects").where({ slug: projectSlug }).del();
  }
  for (const id of [ownerUserId, outsiderUserId]) {
    if (id) {
      // ai_conversations.user_id -> users(id) and ai_chat_messages.conversation_id
      // -> ai_conversations(id) are both ON DELETE CASCADE, but clean up
      // explicitly rather than relying on that for a smoke script.
      await db("ai_conversations").where({ user_id: id }).del();
      await db("ai_provider_credentials").where({ owner_user_id: id }).del();
      await db("users").where({ id }).del();
    }
  }
  await started.stop();
  await db.destroy();
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

function sessionHeaders(cookie: string): Record<string, string> {
  return { cookie };
}

async function callTool(tool: string, input: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ tool, input })
  });
  return { status: response.status, json: await response.json() };
}

function unwrap(result: { status: number; json: unknown }): ToolResponse<unknown> {
  assert(result.status === 200, `Expected a 200 tool response, got HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json as ToolResponse<unknown>;
}

function expectData<T>(response: ToolResponse<unknown>): T {
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return response.data as T;
}

function assertFailureCode(response: ToolResponse<unknown>, code: string, message: string): void {
  if (response.ok || response.error.code !== code) {
    throw new Error(`${message} Response: ${JSON.stringify(response)}`);
  }
}

function sessionCookieFrom(response: Response): string | null {
  const raw = response.headers.get("set-cookie");
  if (!raw) {
    return null;
  }
  return raw.split(";")[0] ?? null;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
