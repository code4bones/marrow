import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { createCreditsFacade } from "../../credits.js";
import { commonItemPrefix, projectKeyFromId } from "../../../shared/ids/id.service.js";
import { combinedRankSql, jsonStringArray, kwicHeadlineSql, stringArray, stringOrNull, writeActorFields } from "../formatters/common.js";
import { compactProject } from "../formatters/projects.js";
import { linkOut } from "../formatters/links.js";
import {
  failedAttemptBody,
  hygieneItemOut,
  hygieneNextCalls,
  itemOut,
  memoryDuplicateGroups,
  searchOut
} from "../formatters/memory.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

const FAILED_ATTEMPT_PENALTY = 5;
const FAULT_FIXED_BONUS = 15;

export function MemoryMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  protected async createMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    const prefix = project ? `I-${projectKeyFromId(project.id)}` : commonItemPrefix(String(input.type));
    const now = nowIso();
    const row = {
      id: typeof input.id === "string" ? input.id : await this.nextId("items", prefix),
      project_id: project?.id ?? null,
      type: String(input.type),
      title: String(input.title),
      body: String(input.body),
      status: typeof input.status === "string" ? input.status : "current",
      tags: jsonStringArray(input.tags),
      summary: stringOrNull(input.summary),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db("items").insert(row);
    await this.recordEventForProject(row.project_id, {
      type: "item.created",
      title: `Memory item created: ${row.title}`,
      related_id: row.id
    }, context);
    const linkage = await this.applyRecordLinkage(row.id, row.project_id, input.tags, input.links, context);
    return { ...itemOut(row), ...linkage };
  }

  protected async upsertMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const existing = await this.findExistingMemoryForUpsert(input, context);
    if (!existing) {
      return {
        action: "created",
        item: await this.createMemory(input, context)
      };
    }
    if (existing.project_id) {
      await this.assertProjectMember(String(existing.project_id), context);
    }

    const patch = {
      title: String(input.title),
      body: String(input.body),
      status: typeof input.status === "string" ? input.status : existing.status,
      tags: jsonStringArray(Array.isArray(input.tags) ? input.tags : existing.tags),
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      updated_at: nowIso(),
      version: Number(existing.version ?? 1) + 1
    };
    const [row] = await this.db("items").where({ id: String(existing.id) }).update(patch).returning("*");
    await this.recordEventForProject(row.project_id, {
      type: "item.updated",
      title: `Memory item upserted: ${row.title}`,
      related_id: row.id
    }, context);
    return {
      action: "updated",
      item: itemOut(row)
    };
  }

  protected async findExistingMemoryForUpsert(
    input: Row,
    context: NormalizedGatewayRequestContext
  ): Promise<Row | undefined> {
    const match = typeof input.match === "string" ? input.match : undefined;
    if ((match === "id" || !match) && typeof input.id === "string") {
      const byId = await this.db("items").where({ id: input.id }).first();
      if (byId || match === "id") {
        return byId;
      }
    }

    const common = input.common === true || input.project === null;
    const project = common ? null : await this.resolveProject(input.project, context);
    return this.db("items")
      .where({ type: String(input.type), title: String(input.title) })
      .andWhere((builder) => {
        if (project) {
          builder.where("project_id", project.id);
        } else {
          builder.whereNull("project_id");
        }
      })
      .first();
  }

  protected async recordFailedAttempt(input: Row, context: NormalizedGatewayRequestContext) {
    const tags = Array.from(new Set(["failed_attempt", ...stringArray(input.tags)]));
    const upsert = await this.upsertMemory(
      {
        id: input.id,
        project: input.project,
        common: input.common,
        type: "failed_attempt",
        title: input.title,
        body: failedAttemptBody(input),
        status: "current",
        tags,
        match: input.match ?? "scope_type_title"
      },
      context
    );
    const item = upsert.item as ReturnType<typeof itemOut>;
    const event = await this.recordEventForProject(item.projectId, {
      type: "attempt.failed",
      title: `Failed attempt recorded: ${item.title}`,
      body: item.body,
      related_id: item.id
    }, context);
    const link = input.relatedId
      ? await this.createRecordLink(item.id, String(input.relatedId), "warns_against", item.projectId, context)
      : null;

    // D-MEMORY-037 / T-MEMORY-070: only a genuinely NEW failed attempt is a
    // penalty -- upsertMemory can also just be re-recording/refreshing an
    // existing one (action "updated"), which shouldn't multiply the penalty
    // every time the same known issue gets re-documented.
    let creditWarning: string | undefined;
    if (upsert.action === "created" && context.sessionUserId) {
      try {
        await createCreditsFacade(this.db).award(this.db, {
          userId: context.sessionUserId,
          amount: -FAILED_ATTEMPT_PENALTY,
          reason: "failed_attempt_penalty",
          projectId: item.projectId,
          relatedType: "item",
          relatedId: item.id
        });
      } catch (error) {
        creditWarning = `Failed attempt recorded, but the credit penalty failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    return {
      action: upsert.action,
      attempt: item,
      event,
      link,
      ...(creditWarning ? { warning: creditWarning } : {})
    };
  }

  // Generalized from what was createWarnsAgainstLink (originally only
  // failed_attempt.record's "this warns against that" case) -- archiveMemory
  // now reuses it for "resolved_by" so a fixed fault points at what fixed it
  // instead of becoming a dead end.
  protected async createRecordLink(
    fromId: string,
    toId: string,
    relation: string,
    projectId: string | null,
    context: NormalizedGatewayRequestContext
  ) {
    await this.assertRecordExists(toId);
    const existing = await this.db("links")
      .where({ from_id: fromId, to_id: toId, relation })
      .first();
    if (existing) {
      return linkOut(existing);
    }

    const row = {
      id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
      project_id: projectId,
      from_id: fromId,
      to_id: toId,
      relation,
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(projectId, {
      type: "link.created",
      title: `Link created: ${fromId} ${relation} ${toId}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  // T-MEMORY-057 (IDOR): ids are sequential/predictable, so a role=member
  // fetching by id (not through resolveProject/search, which are already
  // membership-safe) must be checked against the fetched row's own
  // project_id, mirroring assertProjectMember's PROJECT_NOT_FOUND convention
  // for a non-member -- don't-leak-existence, same as everywhere else.
  protected async getMemory(id: string, context?: NormalizedGatewayRequestContext) {
    const row = await this.db("items").where({ id }).first();
    if (!row) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }
    if (row.project_id) {
      await this.assertProjectMember(String(row.project_id), context);
    }
    // T-context (2026-08-25): a fault otherwise reads as a dead end -- what
    // actually fixed it is a link (relation "resolved_by", created via
    // archiveMemory's resolvedBy input), but links are a wholly separate
    // table nothing else in memory.get joins against. Surface it here so an
    // agent reading a fault can see what resolved it without a second call.
    const resolvedBy =
      String(row.type) === "failed_attempt"
        ? (await this.db("links").where({ from_id: id, relation: "resolved_by" }).orderBy("created_at", "desc")).map(linkOut)
        : undefined;
    return { ...itemOut(row), ...(resolvedBy && resolvedBy.length > 0 ? { resolvedBy } : {}) };
  }

  protected async memoryItemsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const commonOnly = input.common === true || input.project === null;
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Memory item list requires a project or includeCommon=true.");
    }

    const base = this.db("items");
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.type) {
      base.andWhere("type", String(input.type));
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    }
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      base.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(stringArray(input.tags))]);
    }

    return this.pageRows(
      base,
      input,
      (query) =>
        query
          .select("*")
          .orderByRaw("case when project_id is null then 1 else 0 end asc")
          .orderBy("updated_at", "desc"),
      itemOut
    );
  }

  protected async searchMemory(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Search requires a project or includeCommon=true.");
    }

    // query is optional here (unlike the public memory.search MCP tool,
    // which still requires it at the schema level) so internal callers like
    // project.summary can browse "recent active records for this project"
    // without inventing a query and running it through a mandatory FTS
    // filter that has no reason to match — see I-MEMORY-022 step 1.
    const queryText = typeof input.query === "string" && input.query.trim() ? input.query : null;
    let query = this.db("items").select("id", "project_id", "type", "title", "body", "status", "tags", "summary");
    if (queryText) {
      query = query
        .select(this.db.raw(`${combinedRankSql("items")} as rank`, [queryText, queryText, queryText]))
        .select(this.db.raw(`${kwicHeadlineSql()} as headline`, [queryText, queryText, queryText]))
        .whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }

    query = query.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });

    if (input.type) {
      query = query.andWhere("type", String(input.type));
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy(queryText ? "rank" : "created_at", "desc")
      .limit(Number(input.limit ?? 10));
    return rows.map(searchOut);
  }

  protected async memorySearchPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Search requires a project or includeCommon=true.");
    }

    // T-context (2026-08-25): was `String(input.query)` unconditionally fed
    // into plainto_tsquery, which for an empty string produces an EMPTY
    // tsquery -- `search_vector @@ <empty tsquery>` matches ZERO rows in
    // Postgres, not "everything". That silently broke the Faults page's new
    // browse-by-type-only mode (empty search box) the moment searchMemory's
    // sibling optional-query handling was relied on here too -- this method
    // never had it. Mirrors searchMemory's own queryText-truthy branching.
    const queryText = typeof input.query === "string" && input.query.trim() ? input.query : null;
    const base = this.db("items");
    if (queryText) {
      base.whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }
    base.andWhere((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.type) {
      base.andWhere("type", String(input.type));
    }
    if (input.status) {
      base.andWhere("status", String(input.status));
    }

    return this.pageRows(
      base,
      input,
      (query) => {
        query.select("id", "project_id", "type", "title", "body", "status", "tags", "summary", "created_by", "created_at", "updated_at");
        if (queryText) {
          query
            .select(
              this.db.raw(`${combinedRankSql("items")} as rank`, [queryText, queryText, queryText]),
              this.db.raw(`${kwicHeadlineSql()} as headline`, [queryText, queryText, queryText])
            )
            .orderByRaw("case when project_id is null then 1 else 0 end asc")
            .orderBy("rank", "desc");
        } else {
          query.orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("created_at", "desc");
        }
        return query;
      },
      searchOut
    );
  }

  protected async updateMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("items").where({ id }).first();
    if (!current) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }

    const patch = {
      title: typeof input.title === "string" ? input.title : current.title,
      body: typeof input.body === "string" ? input.body : current.body,
      status: typeof input.status === "string" ? input.status : current.status,
      tags: jsonStringArray(Array.isArray(input.tags) ? input.tags : current.tags),
      summary: typeof input.summary === "string" ? input.summary : current.summary,
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      updated_at: nowIso(),
      version: Number(current.version ?? 1) + 1
    };
    const [row] = await this.db("items").where({ id }).update(patch).returning("*");
    await this.recordEventForProject(row.project_id, {
      type: "item.updated",
      title: `Memory item updated: ${row.title}`,
      related_id: row.id
    }, context);
    return itemOut(row);
  }

  protected async archiveMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("items").where({ id }).first();
    if (!current) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        memory: itemOut(current),
        event: null
      };
    }

    const [row] = await this.db("items")
      .where({ id })
      .update({
        status: "archived",
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "item.archived",
      title: `Memory item archived: ${String(row.title)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);

    // D-MEMORY-037 / T-MEMORY-070: "known faults" (project.summary/preflight's
    // knownFaults) ARE type=failed_attempt items with status="current" --
    // there is no separate fault entity in this schema. Archiving one out of
    // "current" is exactly "this fault no longer applies", so that's the
    // fixed-fault bonus moment, not memory.update or any other status edit.
    let creditWarning: string | undefined;
    if (String(current.type) === "failed_attempt" && String(current.status) === "current" && context.sessionUserId) {
      try {
        await createCreditsFacade(this.db).award(this.db, {
          userId: context.sessionUserId,
          amount: FAULT_FIXED_BONUS,
          reason: "fault_fixed_bonus",
          projectId: stringOrNull(row.project_id),
          relatedType: "item",
          relatedId: row.id
        });
      } catch (error) {
        creditWarning = `Fault archived, but the credit bonus failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }

    // T-context (2026-08-25): "линковать к ним решения/попытки, которые
    // привели к удаче" -- without this, an archived fault has no trace of
    // what actually fixed it. Only meaningful for failed_attempt; silently
    // ignored (not an error) for any other record type someone archives.
    let resolvedByLink: unknown;
    if (String(current.type) === "failed_attempt" && typeof input.resolvedBy === "string" && input.resolvedBy.trim()) {
      resolvedByLink = await this.createRecordLink(row.id, input.resolvedBy.trim(), "resolved_by", stringOrNull(row.project_id), context);
    }

    return {
      action: "archived",
      memory: itemOut(row),
      event,
      ...(resolvedByLink ? { resolvedByLink } : {}),
      ...(creditWarning ? { warning: creditWarning } : {})
    };
  }

  protected async deleteMemory(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("items").where({ id }).first();
    if (!current) {
      throw new AppError("ITEM_NOT_FOUND", `Memory item ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }

    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("items").where({ id }).del();
    });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "item.deleted",
      title: `Memory item deleted: ${String(current.title)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedMemory: itemOut(current),
      deletedLinks,
      event
    };
  }

  protected async memoryHygieneReport(input: Row, context: NormalizedGatewayRequestContext) {
    const commonOnly = input.project === null;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "memory.hygiene_report requires a project or includeCommon=true.");
    }

    const limit = Number(input.limit ?? 20);
    const largeBodyChars = Number(input.largeBodyChars ?? 4000);
    const staleDays = Number(input.staleDays ?? 90);
    const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString();
    const rows = await this.memoryHygieneRows(project?.id ?? null, includeCommon);
    const duplicateGroups = memoryDuplicateGroups(rows, limit);
    const largeRecords = rows
      .filter((row) => Number(row.bodyChars ?? 0) >= largeBodyChars)
      .sort((left, right) => Number(right.bodyChars ?? 0) - Number(left.bodyChars ?? 0))
      .slice(0, limit)
      .map(hygieneItemOut);
    const staleRecords = rows
      .filter((row) => String(row.updatedAt) < staleBefore)
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)))
      .slice(0, limit)
      .map(hygieneItemOut);

    return {
      summary:
        "Read-only memory hygiene report. Review suggested records before updating, archiving, or consolidating anything.",
      project: project ? compactProject(project) : null,
      includeCommon,
      thresholds: {
        largeBodyChars,
        staleDays,
        staleBefore
      },
      scanned: {
        activeItems: rows.length
      },
      findings: {
        largeRecords,
        staleRecords,
        duplicateTitleGroups: duplicateGroups
      },
      counts: {
        largeRecords: largeRecords.length,
        staleRecords: staleRecords.length,
        duplicateTitleGroups: duplicateGroups.length
      },
      nextCalls: hygieneNextCalls([...largeRecords, ...staleRecords], duplicateGroups)
    };
  }

  protected async memoryHygieneRows(projectId: string | null, includeCommon: boolean): Promise<Row[]> {
    let query = this.db("items")
      .select("id", "project_id", "type", "title", "status", "tags", "created_at", "updated_at")
      .select(this.db.raw("char_length(body) as body_chars"))
      .where("status", "current");
    query = query.andWhere((builder) => {
      if (projectId) {
        builder.orWhere("project_id", projectId);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    const rows = await query.orderBy("updated_at", "desc").limit(2000);
    return rows.map((row) => ({
      id: String(row.id),
      projectId: stringOrNull(row.project_id),
      scope: row.project_id ? "project" : "common",
      type: String(row.type),
      title: String(row.title),
      status: String(row.status),
      tags: stringArray(row.tags),
      bodyChars: Number(row.body_chars ?? 0),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }));
  }

  };
}

// Convenience instance type for Tier 2 mixins that also need createMemory
// (e.g. tasks.mixin.ts's addTaskNote, handoffs.mixin.ts) -- avoids
// re-deriving this InstanceType<ReturnType<...>> chain in every dependent
// file.
export type MemoryInstance = InstanceType<ReturnType<typeof MemoryMixin<Constructor<Tier1Instance>>>>;
