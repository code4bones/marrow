import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { stringArray } from "../formatters/common.js";
import { handoffBody, handoffOut } from "../formatters/handoffs.js";
import { linkOut } from "../formatters/links.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type MemoryInstance } from "./memory.mixin.js";

export function HandoffsMixin<TBase extends Constructor<MemoryInstance>>(Base: TBase) {
  return class extends Base {
  protected async createHandoff(input: Row, context: NormalizedGatewayRequestContext) {
    const tags = Array.from(new Set(["handoff", ...stringArray(input.tags)]));
    const item = await this.createMemory(
      {
        project: input.project,
        type: "handoff",
        title: input.title,
        body: handoffBody(input),
        status: "active",
        tags
      },
      context
    );
    const event = await this.recordEventForProject(item.projectId, {
      type: "handoff.created",
      title: `Handoff created: ${item.title}`,
      body: item.body,
      related_id: item.id
    }, context);
    const link = input.taskId
      ? await this.createHandoffTaskLink(item.id, String(input.taskId), item.projectId, context)
      : null;

    return {
      handoff: item,
      event,
      link
    };
  }

  protected async latestHandoffs(input: Row, context: NormalizedGatewayRequestContext) {
    const commonOnly = input.project === null;
    const project = commonOnly
      ? null
      : input.project
        ? await this.resolveProject(input.project, context)
        : await this.tryCurrentProject(context);
    const includeCommon = commonOnly ? true : input.includeCommon !== false;
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "handoff.latest requires a project or includeCommon=true.");
    }
    const rows = await this.listRecentItemsByType("handoff", project?.id ?? null, includeCommon, Number(input.limit ?? 3));
    return rows.map((row) => handoffOut(row, input.includeContent === true));
  }

  protected async searchHandoffs(input: Row, context: NormalizedGatewayRequestContext) {
    const rows = await this.searchMemory(
      {
        query: input.query,
        project: input.project,
        includeCommon: input.includeCommon !== false,
        type: "handoff",
        status: "active",
        limit: input.limit ?? 10
      },
      context
    );
    if (input.includeContent === true) {
      const fullRows = await Promise.all(rows.map((row) => this.getMemory(String(row.id), context)));
      return fullRows.map((row) => handoffOut(row as Row, true));
    }
    return rows.map((row) => handoffOut(row as Row, false));
  }

  protected async createHandoffTaskLink(
    fromId: string,
    toId: string,
    projectId: string | null,
    context: NormalizedGatewayRequestContext
  ) {
    await this.assertRecordExists(toId);
    const row = {
      id: await this.nextId("links", projectId ? `L-${projectKeyFromId(projectId)}` : "L-COMMON"),
      project_id: projectId,
      from_id: fromId,
      to_id: toId,
      relation: "relates_to",
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(projectId, {
      type: "link.created",
      title: `Link created: ${fromId} relates_to ${toId}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  };
}
