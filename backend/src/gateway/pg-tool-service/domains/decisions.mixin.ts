import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { createCreditsFacade } from "../../credits.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { jsonStringArray, stringOrNull, writeActorFields } from "../formatters/common.js";
import { decisionOut } from "../formatters/decisions.js";
import { linkOut } from "../formatters/links.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

const DECISION_ACCEPTED_BONUS = 15;

export function DecisionsMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  // D-MEMORY-037 / T-MEMORY-070: shared by recordDecision (a decision
  // created with -- or defaulting to -- status "accepted" is accepted from
  // the start) and updateDecisionStatus (an explicit later transition into
  // "accepted"). Never blocks the decision write itself; returns a warning
  // string on failure for the caller to surface.
  protected async awardDecisionAcceptedIfNeeded(
    row: Row,
    context: NormalizedGatewayRequestContext
  ): Promise<string | undefined> {
    if (String(row.status) !== "accepted" || !context.sessionUserId) {
      return undefined;
    }
    try {
      await createCreditsFacade(this.db).award(this.db, {
        userId: context.sessionUserId,
        amount: DECISION_ACCEPTED_BONUS,
        reason: "decision_accepted_bonus",
        projectId: stringOrNull(row.project_id),
        relatedType: "decision",
        relatedId: String(row.id)
      });
      return undefined;
    } catch (error) {
      return `Decision saved, but the credit bonus failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  protected async recordDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    const now = nowIso();
    const row = {
      id: await this.nextId("decisions", project ? `D-${projectKeyFromId(project.id)}` : "D-COMMON"),
      project_id: project?.id ?? null,
      title: String(input.title),
      status: typeof input.status === "string" ? input.status : "accepted",
      context: stringOrNull(input.context),
      decision: String(input.decision),
      rationale: stringOrNull(input.rationale),
      consequences: stringOrNull(input.consequences),
      tags: jsonStringArray(input.tags),
      supersedes_id: stringOrNull(input.supersedesId),
      summary: stringOrNull(input.summary),
      milestone: stringOrNull(input.milestone),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };
    await this.db("decisions").insert(row);
    if (row.supersedes_id) {
      await this.db("decisions").where({ id: row.supersedes_id }).update({ status: "superseded", updated_at: nowIso() });
    }
    await this.recordEventForProject(row.project_id, {
      type: "decision.recorded",
      title: `Decision recorded: ${row.title}`,
      related_id: row.id
    }, context);
    const linkage = await this.applyRecordLinkage(row.id, row.project_id, input.tags, input.links, context);
    const warning = await this.awardDecisionAcceptedIfNeeded(row, context);
    return { decision: { ...decisionOut(row), ...linkage }, ...(warning ? { warning } : {}) };
  }

  protected async supersedeDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const oldRow = await this.db("decisions").where({ id: String(input.supersedesId) }).first();
    if (!oldRow) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${String(input.supersedesId)} does not exist.`, {
        id: input.supersedesId
      });
    }
    if (oldRow.project_id) {
      await this.assertProjectMember(String(oldRow.project_id), context);
    }

    const projectId = await this.resolveDecisionProjectId(input, oldRow, context);
    if (projectId !== stringOrNull(oldRow.project_id)) {
      throw new AppError("VALIDATION_ERROR", "Replacement decision must stay in the same project/common scope.", {
        oldDecisionId: oldRow.id,
        oldProjectId: stringOrNull(oldRow.project_id),
        replacementProjectId: projectId
      });
    }

    const now = nowIso();
    const row = {
      id: await this.nextId("decisions", projectId ? `D-${projectKeyFromId(projectId)}` : "D-COMMON"),
      project_id: projectId,
      title: String(input.title),
      status: typeof input.status === "string" ? input.status : "accepted",
      context: stringOrNull(input.context),
      decision: String(input.decision),
      rationale: stringOrNull(input.rationale),
      consequences: stringOrNull(input.consequences),
      tags: jsonStringArray(input.tags),
      supersedes_id: String(input.supersedesId),
      summary: stringOrNull(input.summary),
      milestone: stringOrNull(input.milestone),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db("decisions").insert(row);
    const [superseded] = await this.db("decisions")
      .where({ id: String(oldRow.id) })
      .update({
        status: "superseded",
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(oldRow.version ?? 1) + 1
      })
      .returning("*");
    const link = await this.createSupersedesLink(String(row.id), String(oldRow.id), projectId, context);
    const event = await this.recordEventForProject(projectId, {
      type: "decision.superseded",
      title: `Decision superseded: ${String(oldRow.title)}`,
      body: `${String(row.id)} supersedes ${String(oldRow.id)}.`,
      related_id: row.id
    }, context);

    return {
      decision: decisionOut(row),
      superseded: decisionOut(superseded),
      link,
      event
    };
  }

  protected async resolveDecisionProjectId(
    input: Row,
    oldRow: Row,
    context: NormalizedGatewayRequestContext
  ): Promise<string | null> {
    if (input.project === undefined) {
      return stringOrNull(oldRow.project_id);
    }
    if (input.project === null) {
      return null;
    }
    return (await this.resolveProject(input.project, context)).id;
  }

  protected async createSupersedesLink(
    fromId: string,
    toId: string,
    projectId: string | null,
    context: NormalizedGatewayRequestContext
  ) {
    const row = {
      id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
      project_id: projectId,
      from_id: fromId,
      to_id: toId,
      relation: "supersedes",
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(projectId, {
      type: "link.created",
      title: `Link created: ${fromId} supersedes ${toId}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  protected async listDecisions(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    let query = this.db("decisions").select("*");
    query = query.where((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      query = query.andWhere("milestone", String(input.milestone));
    }
    const rows = await query.orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("created_at", "desc").limit(Number(input.limit ?? 20));
    return rows.map(decisionOut);
  }

  protected async decisionsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    const base = this.db("decisions");
    base.where((builder) => {
      if (project) {
        builder.orWhere("project_id", project.id);
      }
      if (includeCommon) {
        builder.orWhereNull("project_id");
      }
    });
    if (input.status) {
      base.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      base.andWhere("milestone", String(input.milestone));
    }
    return this.pageRows(
      base,
      input,
      (query) => query.select("*").orderByRaw("case when project_id is null then 1 else 0 end asc").orderBy("created_at", "desc"),
      decisionOut
    );
  }

  // T-MEMORY-057 (IDOR): see memory.mixin.ts's getMemory for the same
  // rationale -- decision ids are sequential/predictable too.
  protected async getDecision(id: string, context?: NormalizedGatewayRequestContext) {
    const row = await this.db("decisions").where({ id }).first();
    if (!row) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    if (row.project_id) {
      await this.assertProjectMember(String(row.project_id), context);
    }
    return decisionOut(row);
  }

  protected async archiveDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("decisions").where({ id }).first();
    if (!current) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        decision: decisionOut(current),
        event: null
      };
    }

    const [row] = await this.db("decisions")
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
      type: "decision.archived",
      title: `Decision archived: ${String(row.title)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);
    return {
      action: "archived",
      decision: decisionOut(row),
      event
    };
  }

  protected async updateDecisionStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const status = String(input.status);
    const current = await this.db("decisions").where({ id }).first();
    if (!current) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }
    // A superseded decision's status is structural (paired with the
    // replacement decision + the supersedes link created by
    // decision.supersede) -- flipping it back here would desync it from
    // that link without undoing it. Recorded so callers get a clear reason
    // rather than a silent no-op.
    if (String(current.status) === "superseded") {
      throw new AppError(
        "VALIDATION_ERROR",
        `Decision ${id} has been superseded and its status can no longer be changed directly.`,
        { id }
      );
    }

    const [row] = await this.db("decisions")
      .where({ id })
      .update({
        status,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "decision.status_changed",
      title: `Decision status changed: ${String(row.title)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);
    // Only a genuine transition into "accepted" earns the bonus -- guards
    // against re-awarding on a same-status no-op call.
    const warning =
      String(current.status) !== "accepted" ? await this.awardDecisionAcceptedIfNeeded(row, context) : undefined;
    return { decision: decisionOut(row), ...(warning ? { warning } : {}) };
  }

  // Mirrors updateDecisionStatus's shape minus the superseded-status guard
  // (irrelevant to milestone reassignment) -- see updateTaskMilestone's
  // comment in tasks.mixin.ts for why this exists.
  protected async updateDecisionMilestone(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("decisions").where({ id }).first();
    if (!current) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }
    const [row] = await this.db("decisions")
      .where({ id })
      .update({
        milestone: stringOrNull(input.milestone),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    return decisionOut(row);
  }

  protected async deleteDecision(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("decisions").where({ id }).first();
    if (!current) {
      throw new AppError("DECISION_NOT_FOUND", `Decision ${id} does not exist.`, { id });
    }

    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      await trx("decisions").where({ supersedes_id: id }).update({
        supersedes_id: null,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso()
      });
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("decisions").where({ id }).del();
    });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "decision.deleted",
      title: `Decision deleted: ${String(current.title)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedDecision: decisionOut(current),
      deletedLinks,
      event
    };
  }

  };
}
