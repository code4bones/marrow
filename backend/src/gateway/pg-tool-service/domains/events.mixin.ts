import { AppError } from "../../../shared/errors.js";
import { asNullableString } from "../formatters/common.js";
import { eventOut } from "../formatters/events.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

export function EventsMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  protected async recordEvent(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    return this.recordEventForProject(project?.id ?? null, {
      type: String(input.type),
      title: asNullableString(input.title),
      body: asNullableString(input.body),
      related_id: asNullableString(input.relatedId)
    }, context);
  }

  protected async listEvents(input: Row, context?: NormalizedGatewayRequestContext) {
    let query = this.db("events").select("*");
    if (input.project !== undefined) {
      if (input.project === null) {
        query = query.whereNull("project_id");
      } else {
        const project = await this.resolveProject(input.project, context);
        query = query.where("project_id", project.id);
      }
    }
    if (input.relatedId) {
      query = query.andWhere("related_id", String(input.relatedId));
    }
    return (await query.orderBy("created_at", "desc").limit(Number(input.limit ?? 20))).map(eventOut);
  }

  protected async eventsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("events");
    if (input.project !== undefined) {
      if (input.project === null) {
        base.whereNull("project_id");
      } else {
        const project = await this.resolveProject(input.project, context);
        base.where("project_id", project.id);
      }
    }
    if (input.relatedId) {
      base.andWhere("related_id", String(input.relatedId));
    }
    return this.pageRows(base, input, (query) => query.select("*").orderBy("created_at", "desc"), eventOut);
  }

  protected async deleteEvent(input: Row) {
    const id = String(input.id);
    const current = await this.db("events").where({ id }).first();
    if (!current) {
      throw new AppError("NOT_FOUND", `Event ${id} does not exist.`, { id });
    }
    await this.db("events").where({ id }).del();
    return {
      deletedEvent: eventOut(current)
    };
  }

  };
}
