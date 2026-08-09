// Cross-project Q&A (request.create/list/get, reply.create): one project
// asks another a question through shared memory, the other project answers,
// replies can nest under other replies (LiveJournal-comment-style tree).
// Same static-token /call style as project.create/event.record calls in
// scripts/smoke-gateway-notifications.ts -- no session/login needed, these
// tools aren't session-gated.
import { startGatewayServer } from "../src/gateway/http-server.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const db = createPgKnex();
const service = new PgToolService(db);
const staticToken = `gateway-requests-smoke-static-${Date.now()}`;
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token: staticToken
});

const unique = Date.now();
let frontProjectId: string | undefined;
let backProjectId: string | undefined;

try {
  const front = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: `requests-smoke-front-${unique}`, title: "Requests Smoke Front" }))
  );
  frontProjectId = front.project.id;
  const back = expectData<{ project: { id: string; slug: string } }>(
    unwrap(await callTool("project.create", { slug: `requests-smoke-back-${unique}`, title: "Requests Smoke Back" }))
  );
  backProjectId = back.project.id;
  console.log("ok - two projects created (front, back)");

  // --- request.create ------------------------------------------------------
  const created = expectData<{ request: { id: string; fromProjectId: string; toProjectId: string; status: string; question: string } }>(
    unwrap(await callTool("request.create", {
      project: back.project.slug,
      fromProject: front.project.slug,
      question: "What is your new schema?"
    }))
  );
  const requestId = created.request.id;
  assert(created.request.status === "open", `A fresh request should be open, got ${created.request.status}`);
  assert(created.request.fromProjectId === frontProjectId, "fromProjectId should resolve to the asking project's id.");
  assert(created.request.toProjectId === backProjectId, "toProjectId should resolve to the asked project's id.");
  console.log("ok - request.create files an open request under the target project, linked back to the asking project");

  const sameProject = unwrap(await callTool("request.create", {
    project: back.project.slug,
    fromProject: back.project.slug,
    question: "Can I ask myself?"
  }));
  assert(!sameProject.json.ok, "request.create with fromProject === project should fail validation.");
  console.log("ok - request.create rejects fromProject === project (asking yourself)");

  // --- request.list ---------------------------------------------------------
  const openList = expectData<{ requests: Array<{ id: string }> }>(
    unwrap(await callTool("request.list", { project: back.project.slug, status: "open" }))
  );
  assert(openList.requests.some((request) => request.id === requestId), "request.list(status=open) should include the freshly created request.");
  console.log("ok - request.list(project, status=open) finds the pending request");

  // --- reply.create (direct reply to the request root) ---------------------
  const reply1 = expectData<{ reply: { id: string }; request: { status: string } }>(
    unwrap(await callTool("reply.create", {
      requestId,
      project: back.project.slug,
      body: "Here is the new schema: ..."
    }))
  );
  assert(reply1.request.status === "answered", `First reply should flip the request to answered, got ${reply1.request.status}`);
  console.log("ok - reply.create answers the request and flips its status to answered");

  const stillOpenList = expectData<{ requests: Array<{ id: string }> }>(
    unwrap(await callTool("request.list", { project: back.project.slug, status: "open" }))
  );
  assert(!stillOpenList.requests.some((request) => request.id === requestId), "An answered request should no longer show up under status=open.");
  console.log("ok - an answered request drops out of request.list(status=open)");

  // --- reply.create nested under a reply (tree, not flat) -------------------
  const reply2 = expectData<{ reply: { id: string; parentId: string } }>(
    unwrap(await callTool("reply.create", {
      requestId,
      parentId: reply1.reply.id,
      project: front.project.slug,
      body: "Thanks -- follow-up: does that include the indexes?"
    }))
  );
  assert(reply2.reply.parentId === reply1.reply.id, "A nested reply's parentId should be the reply it replies to, not the request.");
  console.log("ok - reply.create nests a reply under another reply (parentId), not just under the request");

  const wrongThreadReply = unwrap(await callTool("reply.create", {
    requestId: "I-DOES-NOT-EXIST",
    project: back.project.slug,
    body: "orphan"
  }));
  assert(!wrongThreadReply.json.ok, "reply.create against a non-existent requestId should fail.");
  console.log("ok - reply.create rejects a non-existent requestId");

  // --- request.get assembles the real tree -----------------------------------
  const full = expectData<{
    request: { id: string; status: string };
    replies: Array<{ reply: { id: string }; children: Array<{ reply: { id: string }; children: unknown[] }> }>;
  }>(unwrap(await callTool("request.get", { id: requestId })));
  assert(full.request.status === "answered", "request.get should reflect the current (answered) status.");
  assert(full.replies.length === 1, `request.get should have exactly one top-level reply, got ${full.replies.length}`);
  assert(full.replies[0]!.reply.id === reply1.reply.id, "The top-level reply should be reply1 (direct reply to the request root).");
  assert(full.replies[0]!.children.length === 1, "reply1 should have exactly one child in the tree.");
  assert(full.replies[0]!.children[0]!.reply.id === reply2.reply.id, "reply1's child should be reply2 (nested reply).");
  console.log("ok - request.get returns the request plus a real nested reply tree (reply2 under reply1, not flat)");

  console.log(`Gateway requests/replies smoke test passed using ${started.url}`);
} finally {
  if (backProjectId) {
    await db("links").where({ project_id: backProjectId }).del();
    await db("items").where({ project_id: backProjectId }).del();
    await db("events").where({ project_id: backProjectId }).del();
    await db("projects").where({ id: backProjectId }).del();
  }
  if (frontProjectId) {
    await db("links").where({ project_id: frontProjectId }).del();
    await db("items").where({ project_id: frontProjectId }).del();
    await db("events").where({ project_id: frontProjectId }).del();
    await db("projects").where({ id: frontProjectId }).del();
  }
  await started.stop();
  await service.close();
}

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${staticToken}`,
    "x-project-memory-client-label": "Requests Smoke Static"
  };
}

async function callTool(tool: string, input: unknown): Promise<{ status: number; json: ToolResponse<unknown> }> {
  const response = await fetch(`${started.url}/call`, {
    method: "POST",
    headers: { "content-type": "application/json", ...staticHeaders() },
    body: JSON.stringify({ tool, input })
  });
  return { status: response.status, json: (await response.json()) as ToolResponse<unknown> };
}

function unwrap(result: { status: number; json: ToolResponse<unknown> }): { status: number; json: ToolResponse<unknown> } {
  assert(result.status === 200, `Expected a 200 HTTP status, got ${result.status}: ${JSON.stringify(result.json)}`);
  return result;
}

function expectData<T>(result: { status: number; json: ToolResponse<unknown> }): T {
  const response = result.json;
  assert(response.ok, response.ok ? "Unexpected gateway failure." : response.error.message);
  return (response as { ok: true; data: T }).data;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
