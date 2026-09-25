import type { Knex } from "knex";
import { AppError } from "../../../shared/errors.js";
import { asNullableString } from "../formatters/common.js";
import { eventOut } from "../formatters/events.js";
import { privateCommonEventPrefixes } from "../../private-events.js";
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

  // No `project` argument = the global feed: a role=member caller only gets
  // common events plus those of projects they are an ACTIVE member of (a
  // pending-approval invite claimant is not a member yet).
  protected applyEventMembershipFilter<T extends Knex.QueryBuilder>(
    query: T,
    context?: NormalizedGatewayRequestContext
  ): T {
    if (context?.sessionRole === "member" && context.sessionUserId) {
      const sessionUserId = context.sessionUserId;
      query.where((builder) => {
        builder
          // Common events, minus other people's private setup/admin ones (private-events.ts).
          .where((common) => {
            common.whereNull("project_id").andWhere((visible) => {
              visible
                .whereNot((privateEvents) => {
                  for (const prefix of privateCommonEventPrefixes()) {
                    privateEvents.orWhere("type", "like", `${prefix}%`);
                  }
                })
                .orWhere("created_by", `user:${sessionUserId}`);
            });
          })
          .orWhereIn(
            "project_id",
            this.db("project_members").select("project_id").where({ user_id: sessionUserId, status: "active" })
          );
      });
    }
    return query;
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
    } else {
      this.applyEventMembershipFilter(query, context);
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
    } else {
      // T-MEMORY-051: the global notifications feed must not show a role=member
      // session events from projects it was never added to (SEC-4: nor from
      // ones it only has a pending invite claim on).
      this.applyEventMembershipFilter(base, context);
    }
    if (input.relatedId) {
      base.andWhere("related_id", String(input.relatedId));
    }
    return this.pageRows(base, input, (query) => query.select("*").orderBy("created_at", "desc"), eventOut);
  }

  protected async deleteEvent(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("events").where({ id }).first();
    if (!current) {
      throw new AppError("NOT_FOUND", `Event ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }
    // The audit trail: admin-only when it is common-scope.
    this.assertCommonScopeDeleteAllowed(current, null, context);
    await this.db("events").where({ id }).del();
    await this.recordEventForProject(current.project_id, {
      type: "event.deleted",
      title: `Event deleted: ${String(current.title ?? current.type)}`,
      related_id: id
    }, context);
    return {
      deletedEvent: eventOut(current)
    };
  }

  };
}
