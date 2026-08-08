import type { Knex } from "knex";
import * as z from "zod/v4";
import { nowIso } from "../../shared/dates.js";
import { AppError } from "../../shared/errors.js";
import { projectKeyFromId } from "../../shared/ids/id.service.js";
import { defaultGatewayOutputSchema, gatewayToolSpecs } from "../tool-definitions.js";
import { GATEWAY_EVENT_TOPIC, gatewayEvents } from "../event-bus.js";
import type { GitHttpFetch } from "../git-credentials.js";
import { anonymousClientTtlSeconds, cutoffFromSeconds } from "./formatters/clients.js";
import { currentProjectKey, paginationInput } from "./formatters/common.js";
import { itemOut } from "./formatters/memory.js";
import { eventOut } from "./formatters/events.js";
import { recordLookupOut, recordLookupTables } from "./formatters/records.js";
import { anonymousClientPrefix, type NormalizedGatewayRequestContext, type Row } from "./types.js";

export class BaseService {
  // T-MEMORY-044: injectable HTTP client for git.pipeline_status's outbound
  // GitLab REST calls -- defaults to the real global `fetch`, but a smoke
  // test can pass a fake here instead of this constructor reaching a real
  // GitLab instance over the network (the task's own acceptance criteria:
  // "the smoke test should NOT make real network calls").
  constructor(
    protected readonly db: Knex,
    protected readonly gitHttpFetch: GitHttpFetch = fetch
  ) {}

  listTools() {
    return gatewayToolSpecs.map(({ name, description, outputSchema }) => ({
      name,
      description,
      outputSchema: z.toJSONSchema(outputSchema ?? defaultGatewayOutputSchema)
    }));
  }

  protected async countQueryRows(query: Knex.QueryBuilder): Promise<number> {
    const row = (await query.count({ count: "*" }).first()) as Row | undefined;
    return Number(row?.count ?? 0);
  }

  protected async pageRows<T>(
    baseQuery: Knex.QueryBuilder,
    input: Row,
    applyListShape: (query: Knex.QueryBuilder) => Knex.QueryBuilder,
    mapRow: (row: Row) => T
  ) {
    const page = paginationInput(input.pagination);
    const totalCount = await this.countQueryRows(baseQuery.clone());
    const rows = (await applyListShape(baseQuery.clone()).limit(page.limit).offset(page.offset)) as Row[];
    return {
      items: rows.map(mapRow),
      pageInfo: {
        limit: page.limit,
        offset: page.offset,
        totalCount,
        hasNextPage: page.offset + rows.length < totalCount,
        hasPreviousPage: page.offset > 0
      }
    };
  }

  protected taskSelectWithActiveClaimCount(query: Knex.QueryBuilder): Knex.QueryBuilder {
    return query.select("tasks.*").select(
      this.db.raw(
        "(select count(*)::int from task_claims where task_claims.task_id = tasks.id and task_claims.status = 'active' and task_claims.lease_expires_at > now()) as active_claim_count"
      )
    );
  }

  protected async recordLookup(id: string): Promise<Row> {
    for (const table of recordLookupTables(id)) {
      const row = await this.db(table).where({ id }).first();
      if (!row) {
        continue;
      }
      return recordLookupOut(table, row);
    }
    throw new AppError("NOT_FOUND", `Record ${id} does not exist.`, { id });
  }

  protected async deleteLinksForRecord(id: string, db: Knex | Knex.Transaction = this.db): Promise<number> {
    return Number(
      await db("links")
        .where((builder) => builder.where("from_id", id).orWhere("to_id", id))
        .del()
    );
  }


  protected async listRecentItemsByType(
    type: string,
    projectId: string | null,
    includeCommon: boolean,
    limit: number
  ): Promise<Row[]> {
    let query = this.db("items").select("*").where({ type, status: "active" });
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    return (await query.orderBy("updated_at", "desc").limit(limit)).map(itemOut);
  }


  protected async recordEventForProject(
    projectId: string | null,
    input: Row,
    context: NormalizedGatewayRequestContext
  ) {
    const row = {
      id: await this.nextId("events", `E-${projectId ? projectKeyFromId(projectId) : "COMMON"}`),
      project_id: projectId,
      type: input.type,
      title: input.title ?? null,
      body: input.body ?? null,
      related_id: input.related_id ?? null,
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("events").insert(row);
    const out = eventOut(row);
    // T-MEMORY-042: this is the single choke point every mutation across
    // every domain already passes through -- publishing here, once, covers
    // PMemUI's live-update feed for the whole gateway with no other call
    // site needing to change. EventEmitter.emit() (which publish() wraps)
    // runs subscriber callbacks synchronously and rethrows synchronously if
    // one throws -- guarded here because a live-update side effect must
    // never fail the mutation it's attached to.
    try {
      void gatewayEvents.publish(GATEWAY_EVENT_TOPIC, { event: String(row.type), payload: out });
    } catch {
      // Best-effort notification; the event row itself is already committed.
    }
    return out;
  }


  protected async touchClient(
    context: NormalizedGatewayRequestContext,
    options: { cleanupAnonymous?: boolean } = {}
  ): Promise<void> {
    const now = nowIso();
    if (options.cleanupAnonymous !== false) {
      await this.cleanupExpiredAnonymousClients();
    }
    await this.db("gateway_clients")
      .insert({
        id: context.clientId,
        label: context.clientLabel,
        last_seen_at: now,
        metadata: JSON.stringify(context.metadata),
        created_at: now,
        updated_at: now
      })
      .onConflict("id")
      .merge({
        label: context.clientLabel,
        last_seen_at: now,
        metadata: JSON.stringify(context.metadata),
        updated_at: now
      });
  }

  protected async cleanupExpiredAnonymousClients(): Promise<void> {
    const ttlSeconds = anonymousClientTtlSeconds();
    if (ttlSeconds <= 0) {
      return;
    }

    const rows = await this.db("gateway_clients")
      .select("id")
      .where("id", "like", `${anonymousClientPrefix}%`)
      .andWhere("last_seen_at", "<", cutoffFromSeconds(ttlSeconds));
    const clientIds = rows.map((row) => String(row.id));
    if (clientIds.length === 0) {
      return;
    }

    await this.db.transaction(async (trx) => {
      await trx("kv").whereIn("key", clientIds.map(currentProjectKey)).del();
      await trx("gateway_clients").whereIn("id", clientIds).del();
    });
  }

  protected async countRows(table: string): Promise<number> {
    const [row] = await this.db(table).count<{ count: string | number }[]>({ count: "*" });
    return Number(row?.count ?? 0);
  }

  protected async safeCountRows(table: string): Promise<number | null> {
    try {
      return await this.countRows(table);
    } catch {
      return null;
    }
  }

  protected async artifactBackupStats(): Promise<{ count: number; totalBytes: number }> {
    const row = await this.db("artifacts")
      .select(
        this.db.raw("count(*)::int as count"),
        this.db.raw("coalesce(sum(size_bytes), 0)::bigint as total_bytes")
      )
      .first();
    return {
      count: Number(row?.count ?? 0),
      totalBytes: Number(row?.total_bytes ?? 0)
    };
  }

  protected async uniqueProjectId(baseId: string): Promise<string> {
    if (!(await this.exists("projects", baseId))) {
      return baseId;
    }
    for (let index = 2; index < 1000; index += 1) {
      const id = `${baseId}-${index}`;
      if (!(await this.exists("projects", id))) {
        return id;
      }
    }
    throw new AppError("VALIDATION_ERROR", "Could not create a unique project id.");
  }

  protected async nextId(table: string, prefix: string): Promise<string> {
    const rows = await this.db(table).select("id").where("id", "like", `${prefix}-%`);
    const next =
      rows.reduce((max, row) => {
        const match = String(row.id).match(/-(\d+)$/);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1;
    return `${prefix}-${String(next).padStart(3, "0")}`;
  }

  protected async exists(table: string, id: string): Promise<boolean> {
    const row = await this.db(table).select("id").where({ id }).first();
    return Boolean(row);
  }

  protected async assertRecordExists(id: string): Promise<void> {
    for (const table of ["projects", "items", "tasks", "decisions", "events", "links", "artifacts"]) {
      if (await this.exists(table, id)) {
        return;
      }
    }
    throw new AppError("LINK_NOT_FOUND", `Linked record ${id} does not exist.`, { id });
  }

  protected async setKv(key: string, value: string): Promise<void> {
    await this.db("kv")
      .insert({ key, value, updated_at: nowIso() })
      .onConflict("key")
      .merge({ value, updated_at: nowIso() });
  }

  protected async getKv(key: string): Promise<string | null> {
    const row = await this.db("kv").select("value").where({ key }).first();
    return row?.value ?? null;
  }
}
