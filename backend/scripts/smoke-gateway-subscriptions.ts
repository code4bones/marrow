// T-MEMORY-042: GraphQL subscription (`gatewayEvents`) over WS, end to end
// against the real gateway (ephemeral local instance, real Postgres) --
// same style as scripts/smoke-gateway-scopes.ts, which this complements
// (that script owns the REST/MCP/GraphQL-over-HTTP scope/membership
// checks; this one owns the WS transport, its session-cookie-only auth
// gate, and per-connection event filtering by the same membership rule).
//
// Speaks the graphql-transport-ws subprotocol directly with the `ws`
// package rather than the `graphql-ws` client package: the client's
// `webSocketImpl` only ever calls `new WebSocketImpl(url, protocol)` (two
// args), with no way to thread a `Sec-WebSocket-Protocol`-adjacent cookie
// header through per-connection -- and this script needs three WS
// connections with three different cookies (admin, member, none). A
// hand-rolled client also makes the exact protocol-level behavior under
// test (connection_init / connection_ack / subscribe / next / close)
// explicit rather than hidden behind a library.
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { startGatewayServer } from "../src/gateway/http-server.js";
import { createAuthFacade, hashPassword } from "../src/gateway/auth.js";
import { PgToolService } from "../src/gateway/pg-tool-service.js";
import { createPgKnex } from "../src/shared/pg/knex.js";
import type { ToolResponse } from "../src/shared/mcp/tool-response.js";

const GRAPHQL_TRANSPORT_WS_PROTOCOL = "graphql-transport-ws";

interface GatewayEventEnvelope {
  event: string;
  payload: Record<string, unknown>;
}

type WsMessage = Record<string, unknown> & { type: string; id?: string };

class GatewayWsClient {
  private readonly socket: WebSocket;
  private readonly queues = new Map<string, WsMessage[]>();
  private readonly waiters = new Map<string, Array<(msg: WsMessage) => void>>();
  private closeInfo: { code: number; reason: string } | null = null;
  private closeWaiters: Array<(info: { code: number; reason: string }) => void> = [];

  constructor(url: string, cookie: string | undefined) {
    this.socket = new WebSocket(url, GRAPHQL_TRANSPORT_WS_PROTOCOL, cookie ? { headers: { cookie } } : undefined);
    this.socket.on("message", (data: Buffer) => {
      const message = JSON.parse(data.toString()) as WsMessage;
      const key = message.id ?? "";
      const pending = this.waiters.get(key);
      if (pending && pending.length > 0) {
        pending.shift()!(message);
        return;
      }
      const queue = this.queues.get(key) ?? [];
      queue.push(message);
      this.queues.set(key, queue);
    });
    this.socket.on("close", (code: number, reason: Buffer) => {
      const info = { code, reason: reason?.toString() ?? "" };
      this.closeInfo = info;
      for (const waiter of this.closeWaiters) {
        waiter(info);
      }
      this.closeWaiters = [];
    });
  }

  waitForOpen(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.socket.once("open", () => resolve());
      this.socket.once("error", reject);
    });
  }

  waitForClose(timeoutMs: number): Promise<{ code: number; reason: string }> {
    if (this.closeInfo) {
      return Promise.resolve(this.closeInfo);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for the WS connection to close.")), timeoutMs);
      this.closeWaiters.push((info) => {
        clearTimeout(timer);
        resolve(info);
      });
    });
  }

  send(message: WsMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  private nextMessage(key: string, timeoutMs: number): Promise<WsMessage> {
    const queue = this.queues.get(key);
    if (queue && queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for a WS message (id=${key || "<connection>"}).`)),
        timeoutMs
      );
      const waiters = this.waiters.get(key) ?? [];
      waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
      this.waiters.set(key, waiters);
    });
  }

  /** connection_init -> connection_ack handshake for an already-open socket. */
  async connectAndAcknowledge(): Promise<void> {
    await this.waitForOpen();
    this.send({ type: "connection_init" });
    const ack = await this.nextMessage("", 5000);
    assert(ack.type === "connection_ack", `Expected connection_ack, got ${JSON.stringify(ack)}.`);
  }

  async subscribe(id: string, query: string): Promise<void> {
    this.send({ type: "subscribe", id, payload: { query } });
  }

  async nextEnvelope(subscriptionId: string, timeoutMs: number): Promise<GatewayEventEnvelope> {
    const message = await this.nextMessage(subscriptionId, timeoutMs);
    assert(message.type === "next", `Expected a "next" message for subscription ${subscriptionId}, got ${JSON.stringify(message)}.`);
    const payload = (message as { payload?: { data?: { gatewayEvents?: GatewayEventEnvelope } } }).payload;
    const envelope = payload?.data?.gatewayEvents;
    assert(envelope, `"next" message for ${subscriptionId} did not carry a gatewayEvents envelope: ${JSON.stringify(message)}.`);
    return envelope!;
  }

  /** Synchronous check of whatever has already arrived and is sitting unread in this subscription's queue. */
  hasQueuedEnvelope(subscriptionId: string, predicate: (envelope: GatewayEventEnvelope) => boolean): boolean {
    const queue = this.queues.get(subscriptionId) ?? [];
    return queue.some((message) => {
      const payload = (message as { payload?: { data?: { gatewayEvents?: GatewayEventEnvelope } } }).payload;
      const envelope = payload?.data?.gatewayEvents;
      return envelope ? predicate(envelope) : false;
    });
  }

  close(): void {
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
  }
}

const db = createPgKnex();
const service = new PgToolService(db);
const token = `gateway-subscriptions-smoke-token-${Date.now()}`;
const auth = createAuthFacade(db);
const started = await startGatewayServer(service, {
  host: "127.0.0.1",
  port: 0,
  token,
  auth
});

const graphqlPath = `${normalizedApiEndpoint() ?? ""}/graphql`;
const graphqlUrl = `${started.url}${graphqlPath}`;
const wsUrl = `${graphqlUrl.replace(/^http/, "ws")}`;

const unique = Date.now();
const adminEmail = `gateway-subs-smoke-admin-${unique}@example.test`;
const adminPassword = "smoke-admin-password-1";
const memberEmail = `gateway-subs-smoke-member-${unique}@example.test`;
const memberPassword = "smoke-member-password-1";

let adminUserId: string | undefined;
let memberUserId: string | undefined;
let projectAId: string | undefined;
let projectBId: string | undefined;
let commonEventId: string | undefined;
const createdMemoryIds: string[] = [];
const openSockets: GatewayWsClient[] = [];

try {
  const now = new Date();
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

  memberUserId = randomUUID();
  await db("users").insert({
    id: memberUserId,
    email: memberEmail,
    password_hash: await hashPassword(memberPassword),
    email_verified_at: now,
    totp_enabled: false,
    role: "member",
    status: "active",
    created_at: now,
    updated_at: now
  });

  const adminCookie = await login(adminEmail, adminPassword);
  const memberCookie = await login(memberEmail, memberPassword);
  console.log("ok - admin and member sessions established");

  const projectA = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `gateway-subs-smoke-a-${unique}`, title: "Subs Smoke A" }, staticHeaders()))
  );
  projectAId = projectA.project.id;
  const projectB = expectData<{ project: { id: string } }>(
    unwrap(await callTool("project.create", { slug: `gateway-subs-smoke-b-${unique}`, title: "Subs Smoke B" }, staticHeaders()))
  );
  projectBId = projectB.project.id;
  await db("project_members").insert({ project_id: projectAId, user_id: memberUserId, created_at: now });
  console.log(`ok - project A/B created, member ${memberUserId} added to project_members for project A only`);

  // --- Reject: no credential at all -----------------------------------
  const noCookieClient = new GatewayWsClient(wsUrl, undefined);
  openSockets.push(noCookieClient);
  await noCookieClient.waitForOpen();
  noCookieClient.send({ type: "connection_init" });
  const noCookieClose = await noCookieClient.waitForClose(5000);
  assert(
    noCookieClose.code === 4403,
    `WS connection with no session cookie should be refused (4403) at onConnect, not reach connection_ack. Got close code ${noCookieClose.code}.`
  );
  console.log("ok - WS subscription without any session cookie is rejected at the handshake (never acknowledged)");

  // --- Reject: garbage/invalid cookie -----------------------------------
  const invalidCookieClient = new GatewayWsClient(wsUrl, "pmem_session=not-a-real-session-token");
  openSockets.push(invalidCookieClient);
  await invalidCookieClient.waitForOpen();
  invalidCookieClient.send({ type: "connection_init" });
  const invalidCookieClose = await invalidCookieClient.waitForClose(5000);
  assert(
    invalidCookieClose.code === 4403,
    `WS connection with an invalid session cookie should be refused (4403). Got close code ${invalidCookieClose.code}.`
  );
  console.log("ok - WS subscription with an invalid/unresolvable session cookie is rejected the same way");

  // --- Admin: sees everything -------------------------------------------
  const adminClient = new GatewayWsClient(wsUrl, adminCookie);
  openSockets.push(adminClient);
  await adminClient.connectAndAcknowledge();
  await adminClient.subscribe("admin-sub", "subscription { gatewayEvents { event payload } }");
  console.log("ok - admin session completes the WS GraphQL handshake and subscribes");

  const adminMemory = expectData<{ item: { id: string } }>(
    unwrap(
      await callTool(
        "memory.create",
        { project: projectAId, type: "note", title: "Admin subscription smoke note", body: "seen over WS" },
        sessionHeaders(adminCookie)
      )
    )
  );
  createdMemoryIds.push(adminMemory.item.id);

  const adminEnvelope = await adminClient.nextEnvelope("admin-sub", 5000);
  assert(adminEnvelope.event === "item.created", `Expected item.created, got ${adminEnvelope.event}.`);
  // payload is eventOut() of the events-table row the mutation recorded, not
  // the mutated record itself -- relatedId is the memory item's own id (see
  // pg-tool-service.ts's createMemory(), which passes related_id: row.id).
  assert(
    envelopeRelatedId(adminEnvelope) === adminMemory.item.id,
    "Admin WS envelope did not carry the memory.create mutation's related item id."
  );
  console.log("ok - admin WS subscription receives a live envelope for a mutation in a project it isn't even a member of");

  // --- Member: filtered by project_members --------------------------------
  const memberClient = new GatewayWsClient(wsUrl, memberCookie);
  openSockets.push(memberClient);
  await memberClient.connectAndAcknowledge();
  await memberClient.subscribe("member-sub", "subscription { gatewayEvents { event payload } }");
  console.log("ok - member session completes the WS GraphQL handshake and subscribes");

  // Trigger, in order: a mutation in project B (member is NOT in
  // project_members for B), then one in project A (member IS a member),
  // then a common-scope event (projectId: null). The member connection's
  // queue must never surface the project B envelope at all -- so the very
  // next two envelopes it receives must be exactly the project A one and
  // the common one, in that order, proving B's was filtered server-side
  // rather than merely arriving late.
  const bMemory = expectData<{ item: { id: string } }>(
    unwrap(
      await callTool(
        "memory.create",
        { project: projectBId, type: "note", title: "Non-member project note", body: "must not reach member WS" },
        staticHeaders()
      )
    )
  );
  createdMemoryIds.push(bMemory.item.id);

  const aMemory = expectData<{ item: { id: string } }>(
    unwrap(
      await callTool(
        "memory.create",
        { project: projectAId, type: "note", title: "Member project note", body: "must reach member WS" },
        sessionHeaders(memberCookie)
      )
    )
  );
  createdMemoryIds.push(aMemory.item.id);

  const commonEvent = expectData<{ event: { id: string } }>(
    unwrap(await callTool("event.record", { project: null, type: "smoke.common", title: "Common scope smoke event" }, staticHeaders()))
  );
  commonEventId = commonEvent.event.id;

  const memberFirst = await memberClient.nextEnvelope("member-sub", 5000);
  assert(
    envelopeRelatedId(memberFirst) === aMemory.item.id,
    `Member WS subscription's first envelope should be the project A mutation (project B's must be filtered out entirely), got payload ${JSON.stringify(memberFirst.payload)}.`
  );
  console.log("ok - member WS subscription receives an envelope for a project it IS a member of");

  const memberSecond = await memberClient.nextEnvelope("member-sub", 5000);
  // The common event IS the events-table row (event.record has no separate
  // mutated record), so its own payload.id -- not relatedId -- is what
  // matches, unlike the memory.create envelopes above.
  assert(
    memberSecond.event === "smoke.common" && (memberSecond.payload as { id?: string }).id === commonEvent.event.id,
    `Member WS subscription's second envelope should be the common-scope event, got ${JSON.stringify(memberSecond)}.`
  );
  console.log("ok - member WS subscription receives a common-scope (projectId: null) envelope");

  assert(
    !memberClient.hasQueuedEnvelope("member-sub", (envelope) => envelopeRelatedId(envelope) === bMemory.item.id),
    "Member WS subscription must never have received the project B envelope (no project_members row for B)."
  );
  console.log("ok - member WS subscription never received the envelope for a project it is not a member of");

  console.log(`Gateway subscriptions smoke test passed using ${started.url}`);
} finally {
  for (const socket of openSockets) {
    socket.close();
  }
  if (createdMemoryIds.length > 0) {
    await db("items").whereIn("id", createdMemoryIds).del();
  }
  if (memberUserId) {
    await db("project_members").where({ user_id: memberUserId }).del();
    await db("sessions").where({ user_id: memberUserId }).del();
    await db("users").where({ id: memberUserId }).del();
  }
  if (adminUserId) {
    await db("sessions").where({ user_id: adminUserId }).del();
    await db("users").where({ id: adminUserId }).del();
  }
  if (projectAId) {
    await db("events").where({ project_id: projectAId }).del();
    await db("items").where({ project_id: projectAId }).del();
    await db("projects").where({ id: projectAId }).del();
  }
  if (projectBId) {
    await db("events").where({ project_id: projectBId }).del();
    await db("items").where({ project_id: projectBId }).del();
    await db("projects").where({ id: projectBId }).del();
  }
  if (commonEventId) {
    await db("events").where({ id: commonEventId }).del();
  }
  await started.stop();
  await service.close();
}

// --- shared smoke helpers (same shape as smoke-gateway-scopes.ts) ---------

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

function staticHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "x-project-memory-client-label": "Subs Smoke Static"
  };
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

function envelopeRelatedId(envelope: GatewayEventEnvelope): string | undefined {
  const relatedId = (envelope.payload as { relatedId?: unknown }).relatedId;
  return typeof relatedId === "string" ? relatedId : undefined;
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

function normalizedApiEndpoint(): string | null {
  const raw = process.env.API_ENDPOINT?.trim();
  if (!raw || raw === "/") {
    return null;
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash.replace(/\/+$/, "");
}
