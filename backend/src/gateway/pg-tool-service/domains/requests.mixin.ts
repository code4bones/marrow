import { AppError } from "../../../shared/errors.js";
import { shortText, stringArray } from "../formatters/common.js";
import { itemOut } from "../formatters/memory.js";
import { buildReplyTree, replyOut, requestOut } from "../formatters/requests.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type MemoryInstance } from "./memory.mixin.js";

function threadTag(requestId: string): string {
  return `thread:${requestId}`;
}

export function RequestsMixin<TBase extends Constructor<MemoryInstance>>(Base: TBase) {
  return class extends Base {
  // Cross-project Q&A: one project asks another a question (a memory item,
  // type="request", filed under the *asked* project so request.list there
  // finds it) and links back to the asking project via an "asked_by" edge
  // -- reuses the existing generic memory/link graph instead of a dedicated
  // table, same as handoffs.mixin.ts does for handoffs.
  protected async createRequest(input: Row, context: NormalizedGatewayRequestContext) {
    const toProject = await this.resolveProject(input.project, context);
    const fromProject = input.fromProject
      ? await this.resolveProject(input.fromProject, context)
      : await this.currentProject(context);
    if (fromProject.id === toProject.id) {
      throw new AppError("VALIDATION_ERROR", "A request's fromProject and project (target) must be different projects.", {
        project: toProject.id
      });
    }

    const question = String(input.question);
    const item = await this.createMemory(
      {
        project: toProject.id,
        type: "request",
        title: shortText(question, 120) ?? question,
        body: question,
        status: "open",
        tags: ["request"]
      },
      context
    );
    const link = await this.createLink(
      { project: toProject.id, fromId: item.id, toId: fromProject.id, relation: "asked_by" },
      context
    );
    const event = await this.recordEventForProject(toProject.id, {
      type: "request.created",
      title: `Request asked: ${item.title}`,
      related_id: item.id
    }, context);

    return {
      request: requestOut(item, fromProject.id, toProject.id),
      link,
      event
    };
  }

  protected async listRequests(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    let query = this.db("items").where({ project_id: project.id, type: "request" });
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }
    const rows = await query.orderBy("created_at", "desc").limit(Number(input.limit ?? 20));
    if (rows.length === 0) {
      return [];
    }

    const askedByLinks = await this.db("links")
      .where({ relation: "asked_by" })
      .whereIn("from_id", rows.map((row) => String(row.id)));
    const fromProjectByRequestId = new Map(askedByLinks.map((link) => [String(link.from_id), String(link.to_id)]));

    return rows.map((row) =>
      requestOut(itemOut(row), fromProjectByRequestId.get(String(row.id)) ?? null, project.id)
    );
  }

  protected async getRequest(id: string) {
    const row = await this.requestRow(id);
    const item = itemOut(row);

    const askedByLink = await this.listLinks({ id, direction: "from", relation: "asked_by" });
    const fromProjectId = (askedByLink[0] as Row | undefined)?.toId as string | undefined ?? null;

    const replyRows = await this.db("items")
      .where({ type: "reply" })
      .andWhereRaw("tags @> ?::jsonb", [JSON.stringify([threadTag(id)])])
      .orderBy("created_at", "asc");
    const repliesLinks = replyRows.length
      ? await this.db("links")
          .where({ relation: "replies" })
          .whereIn("from_id", replyRows.map((reply) => String(reply.id)))
      : [];
    const parentByReplyId = new Map(repliesLinks.map((link) => [String(link.from_id), String(link.to_id)]));

    return {
      request: requestOut(item, fromProjectId, String(row.project_id)),
      replies: buildReplyTree(replyRows.map((reply) => itemOut(reply)), parentByReplyId, id)
    };
  }

  protected async createReply(input: Row, context: NormalizedGatewayRequestContext) {
    const requestId = String(input.requestId);
    const request = await this.requestRow(requestId);

    let parentId = requestId;
    if (input.parentId) {
      const parent = await this.replyRow(String(input.parentId));
      if (!this.replyBelongsToThread(parent, requestId)) {
        throw new AppError("VALIDATION_ERROR", `Reply ${String(input.parentId)} does not belong to request ${requestId}.`, {
          parentId: input.parentId,
          requestId
        });
      }
      parentId = String(input.parentId);
    }

    const replyingProject = input.project
      ? await this.resolveProject(input.project, context)
      : await this.currentProject(context);
    const body = String(input.body);
    const item = await this.createMemory(
      {
        project: replyingProject.id,
        type: "reply",
        title: shortText(body, 120) ?? body,
        body,
        status: "current",
        tags: ["reply", threadTag(requestId)]
      },
      context
    );
    const link = await this.createLink(
      { project: replyingProject.id, fromId: item.id, toId: parentId, relation: "replies" },
      context
    );

    if (String(request.status) === "open") {
      // Pass tags through explicitly (as a real array) so updateMemory's
      // Array.isArray(input.tags) branch runs jsonStringArray on them --
      // its fallback-to-current.tags branch re-inserts whatever the pg
      // driver already parsed a jsonb column into, which pg's jsonb column
      // write rejects as "invalid input syntax for type json" for an array.
      await this.updateMemory({ id: requestId, status: "answered", tags: stringArray(request.tags) }, context);
    }
    const event = await this.recordEventForProject(replyingProject.id, {
      type: "reply.created",
      title: `Reply added to request ${requestId}`,
      related_id: item.id
    }, context);

    return {
      reply: replyOut(item, requestId, parentId),
      link,
      request: itemOut(await this.requestRow(requestId)),
      event
    };
  }

  protected async requestRow(id: string): Promise<Row> {
    const row = await this.db("items").where({ id }).first();
    if (!row || String(row.type) !== "request") {
      throw new AppError("ITEM_NOT_FOUND", `Request ${id} does not exist.`, { id });
    }
    return row;
  }

  protected async replyRow(id: string): Promise<Row> {
    const row = await this.db("items").where({ id }).first();
    if (!row || String(row.type) !== "reply") {
      throw new AppError("ITEM_NOT_FOUND", `Reply ${id} does not exist.`, { id });
    }
    return row;
  }

  protected replyBelongsToThread(reply: Row, requestId: string): boolean {
    return stringArray(reply.tags).includes(threadTag(requestId));
  }

  };
}
