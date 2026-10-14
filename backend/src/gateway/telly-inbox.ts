import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Knex } from "knex";
import { nowIso } from "../shared/dates.js";
import type { AppLogger } from "../shared/logging/logger.js";
import type { Row } from "./pg-tool-service/types.js";

// T-MEMORY-184: this module deliberately knows the *generic* inbox contract
// only. TellyMCP owns inbox persistence, routing, and its worker; Marrow owns
// a durable source-side outbox and speaks to Telly through standard MCP.
export const tellyInboxIntegration = "tellymcp";
export const tellyInboxTaskOfferKind = "work.offer";
export const tellyInboxPutTool = "inbox_put";

type DeliveryStatus = "pending" | "sending" | "delivered" | "failed";

export type TellyInboxConfig = {
  endpoint: URL;
  bearerToken: string;
  pollIntervalMs: number;
  maxAttempts: number;
};

export type TellyInboxTaskOfferInput = {
  sourceEventId: string;
  projectId: string;
  projectTitle: string;
  taskId: string;
  title: string;
  summary: string | null;
  status: string;
  priority: number;
  milestone: string | null;
  acceptance: string | null;
  recipientUserId: string;
  actorUserId: string;
};

export type TellyInboxToolClient = {
  put(message: Row): Promise<unknown>;
};

type IntegrationOutboxRow = {
  id: string;
  payload: Row | string;
  attempt_count: number;
};

export function tellyInboxConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TellyInboxConfig | null {
  const endpoint = env.TELLYMCP_INBOX_MCP_URL?.trim();
  const bearerToken = env.TELLYMCP_INBOX_BEARER_TOKEN?.trim();
  if (!endpoint || !bearerToken) {
    return null;
  }
  try {
    return {
      endpoint: new URL(endpoint),
      bearerToken,
      pollIntervalMs: positiveInteger(env.TELLYMCP_INBOX_POLL_INTERVAL_MS, 10_000, 1_000, 300_000),
      maxAttempts: positiveInteger(env.TELLYMCP_INBOX_MAX_ATTEMPTS, 12, 1, 100)
    };
  } catch {
    return null;
  }
}

export function tellyInboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return tellyInboxConfigFromEnv(env) !== null;
}

export function tellyInboxTaskOfferPayload(input: TellyInboxTaskOfferInput): Row {
  return {
    schemaVersion: 1,
    source: {
      integration: "marrow",
      messageId: input.sourceEventId
    },
    recipient: {
      externalPrincipal: {
        namespace: "marrow",
        subject: input.recipientUserId
      }
    },
    route: {
      namespace: "marrow",
      key: input.projectId
    },
    resource: {
      kind: "task",
      id: input.taskId
    },
    kind: tellyInboxTaskOfferKind,
    requiresAcceptance: true,
    // v1 intentionally makes the inbox record self-contained. TellyMCP is
    // only an inbox MCP server in this phase, so it must not call back to
    // Marrow to render the Telegram prompt or process the answer.
    display: {
      title: input.title,
      // TellyMCP's v1 public schema requires a string when summary is
      // present; omit it rather than sending JSON null.
      ...(input.summary ? { summary: input.summary } : {})
    },
    metadata: {
      actorUserId: input.actorUserId
    }
  };
}

export async function enqueueTellyTaskOffer(db: Knex, input: TellyInboxTaskOfferInput): Promise<void> {
  const now = nowIso();
  const payload = tellyInboxTaskOfferPayload(input);
  await db("integration_outbox")
    .insert({
      id: randomUUID(),
      integration: tellyInboxIntegration,
      kind: tellyInboxTaskOfferKind,
      idempotency_key: input.sourceEventId,
      source_event_id: input.sourceEventId,
      project_id: input.projectId,
      task_id: input.taskId,
      recipient_user_id: input.recipientUserId,
      actor_user_id: input.actorUserId,
      payload: JSON.stringify(payload),
      delivery_status: "pending",
      attempt_count: 0,
      available_at: now,
      created_at: now,
      updated_at: now
    })
    .onConflict(["integration", "idempotency_key"])
    .ignore();
}

export class TellyInboxMcpClient implements TellyInboxToolClient {
  public constructor(private readonly config: TellyInboxConfig) {}

  public async put(message: Row): Promise<unknown> {
    const endpoint = new URL(this.config.endpoint);
    endpoint.searchParams.set("client_id", "marrow-tellymcp-outbox");
    endpoint.searchParams.set("client_label", "Marrow TellyMCP outbox");
    endpoint.searchParams.set("client_kind", "integration");
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: {
        headers: { authorization: `Bearer ${this.config.bearerToken}` }
      }
    });
    const client = new Client({ name: "marrow-tellymcp-outbox", version: "1.0.0" });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: tellyInboxPutTool, arguments: message });
      if (result.isError) {
        throw new Error(mcpErrorText(result.content));
      }
      return result.structuredContent ?? result.content;
    } finally {
      await client.close();
    }
  }
}

export class TellyInboxOutboxDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public constructor(
    private readonly db: Knex,
    private readonly config: TellyInboxConfig | null,
    private readonly logger?: AppLogger,
    private readonly client: TellyInboxToolClient | null = config ? new TellyInboxMcpClient(config) : null
  ) {}

  public start(): void {
    if (!this.config || !this.client || this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.tick().catch((error) => this.logTickError(error)), this.config.pollIntervalMs);
    this.timer.unref();
    void this.tick().catch((error) => this.logTickError(error));
    this.logger?.info({ endpoint: this.config.endpoint.origin }, "TellyMCP inbox outbox dispatcher started");
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async tick(): Promise<void> {
    if (!this.config || !this.client || this.running) {
      return;
    }
    this.running = true;
    try {
      // A bounded batch prevents one noisy integration from monopolizing the
      // gateway event loop; the next interval will continue the queue.
      for (let index = 0; index < 20; index += 1) {
        const row = await this.claimNext();
        if (!row) {
          break;
        }
        await this.deliver(row);
      }
    } finally {
      this.running = false;
    }
  }

  private logTickError(error: unknown): void {
    this.logger?.error({ error }, "TellyMCP inbox outbox dispatcher tick failed");
  }

  private async claimNext(): Promise<IntegrationOutboxRow | null> {
    const now = nowIso();
    return this.db.transaction(async (trx) => {
      const row = (await trx("integration_outbox")
        .where({ integration: tellyInboxIntegration })
        .where((query) =>
          query
            .where({ delivery_status: "pending" })
            .orWhere((stale) => stale.where({ delivery_status: "sending" }).andWhere("locked_until", "<", now))
        )
        .andWhere("available_at", "<=", now)
        .orderBy("created_at", "asc")
        .forUpdate()
        .skipLocked()
        .first()) as IntegrationOutboxRow | undefined;
      if (!row) {
        return null;
      }
      await trx("integration_outbox").where({ id: row.id }).update({
        delivery_status: "sending" satisfies DeliveryStatus,
        attempt_count: Number(row.attempt_count) + 1,
        locked_until: new Date(Date.now() + 60_000).toISOString(),
        updated_at: now
      });
      return { ...row, attempt_count: Number(row.attempt_count) + 1 };
    });
  }

  private async deliver(row: IntegrationOutboxRow): Promise<void> {
    const payload = rowPayload(row.payload);
    try {
      const response = await this.client!.put(payload);
      await this.db("integration_outbox").where({ id: row.id }).update({
        delivery_status: "delivered" satisfies DeliveryStatus,
        delivered_at: nowIso(),
        locked_until: null,
        last_error: null,
        delivery_response: JSON.stringify(response),
        updated_at: nowIso()
      });
    } catch (error) {
      const failed = row.attempt_count >= this.config!.maxAttempts;
      const retrySeconds = retryDelaySeconds(row.attempt_count);
      const message = error instanceof Error ? error.message : String(error);
      await this.db("integration_outbox").where({ id: row.id }).update({
        delivery_status: failed ? ("failed" satisfies DeliveryStatus) : ("pending" satisfies DeliveryStatus),
        locked_until: null,
        available_at: new Date(Date.now() + retrySeconds * 1_000).toISOString(),
        last_error: message.slice(0, 2_000),
        updated_at: nowIso()
      });
      this.logger?.warn(
        { outboxId: row.id, attempt: row.attempt_count, failed, error: message },
        "TellyMCP inbox delivery failed"
      );
    }
  }
}

function rowPayload(value: Row | string): Row {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Integration outbox payload is not an object.");
    }
    return parsed as Row;
  }
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 2 ** Math.min(Math.max(attempt, 1), 8));
}

function mcpErrorText(content: unknown): string {
  if (Array.isArray(content)) {
    const text = content
      .filter((item): item is { type?: unknown; text?: unknown } => Boolean(item && typeof item === "object"))
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join(" ");
    if (text) {
      return text;
    }
  }
  return "TellyMCP inbox_put returned an MCP error.";
}
