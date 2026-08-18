import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { createActorLabelsFacade } from "../../actor-labels.js";
import { currentProjectKey, stringArray } from "../formatters/common.js";
import { anonymousClientTtlSeconds, clientOut, compactClient, cutoffFromSeconds } from "../formatters/clients.js";
import { anonymousClientPrefix, staticTokenClientId, type Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

export function ClientsMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  protected async listClients(input: Row) {
    let query = this.db("gateway_clients").select("*").orderBy("updated_at", "desc");
    if (typeof input.anonymous === "boolean") {
      query = input.anonymous
        ? query.where("id", "like", `${anonymousClientPrefix}%`)
        : query.where("id", "not like", `${anonymousClientPrefix}%`);
    }
    if (typeof input.staleOlderThanSeconds === "number") {
      query = query.andWhere("last_seen_at", "<", cutoffFromSeconds(input.staleOlderThanSeconds));
    }
    const rows = await query.limit(Number(input.limit ?? 10));
    return input.compact === true ? rows.map(compactClient) : rows.map(clientOut);
  }

  protected async gatewayClientsPage(input: Row) {
    const base = this.db("gateway_clients");
    if (typeof input.anonymous === "boolean") {
      if (input.anonymous) {
        base.where("id", "like", `${anonymousClientPrefix}%`);
      } else {
        base.where("id", "not like", `${anonymousClientPrefix}%`);
      }
    }
    if (typeof input.staleOlderThanSeconds === "number") {
      base.andWhere("last_seen_at", "<", cutoffFromSeconds(input.staleOlderThanSeconds));
    }
    return this.pageRows(base, input, (query) => query.select("*").orderBy("updated_at", "desc"), clientOut);
  }

  protected async getClient(input: Row) {
    const row = await this.clientRow(String(input.id));
    return {
      ...clientOut(row),
      currentProjectId: await this.getKv(currentProjectKey(String(row.id)))
    };
  }

  protected async forgetClient(input: Row) {
    const id = String(input.id);
    const row = await this.clientRow(id);
    await this.db.transaction(async (trx) => {
      await trx("kv").where({ key: currentProjectKey(id) }).del();
      await trx("gateway_clients").where({ id }).del();
    });
    return {
      client: clientOut(row),
      forgotten: true,
      removedCurrentProjectKey: true
    };
  }

  protected async pruneClients(input: Row) {
    const anonymousOnly = input.anonymousOnly !== false;
    const olderThanSeconds =
      typeof input.olderThanSeconds === "number" ? Number(input.olderThanSeconds) : anonymousClientTtlSeconds();
    const dryRun = input.dryRun !== false;
    const limit = Number(input.limit ?? 100);
    let query = this.db("gateway_clients")
      .select("*")
      .where("last_seen_at", "<", cutoffFromSeconds(olderThanSeconds))
      .orderBy("last_seen_at");
    if (anonymousOnly) {
      query = query.andWhere("id", "like", `${anonymousClientPrefix}%`);
    }
    const rows = await query.limit(limit);
    const clientIds = rows.map((row) => String(row.id));
    if (!dryRun && clientIds.length > 0) {
      await this.db.transaction(async (trx) => {
        await trx("kv").whereIn("key", clientIds.map(currentProjectKey)).del();
        await trx("gateway_clients").whereIn("id", clientIds).del();
      });
    }
    return {
      dryRun,
      anonymousOnly,
      olderThanSeconds,
      matched: rows.length,
      pruned: dryRun ? 0 : rows.length,
      clients: rows.map(clientOut)
    };
  }

  protected async actorLabels(input: Row) {
    const ids = stringArray(input.ids);
    return createActorLabelsFacade(this.db).resolveLabels(ids);
  }

  protected async clientRow(id: string): Promise<Row> {
    const row = await this.db("gateway_clients").where({ id }).first();
    if (!row) {
      throw new AppError("NOT_FOUND", `Gateway client ${id} does not exist.`, { id });
    }
    return row;
  }


  async ensureStaticTokenCredential(): Promise<void> {
    const now = nowIso();
    const owner = await this.db("users").select("id").where({ role: "admin" }).orderBy("created_at", "asc").first();
    await this.db("gateway_clients")
      .insert({
        id: staticTokenClientId,
        label: "static-token",
        scope: "admin",
        owner_user_id: owner?.id ?? null,
        metadata: JSON.stringify({ kind: "static-token", migrated: true }),
        created_at: now,
        updated_at: now
      })
      .onConflict("id")
      .merge({
        scope: "admin",
        owner_user_id: owner?.id ?? null,
        updated_at: now
      });
  }

  };
}
