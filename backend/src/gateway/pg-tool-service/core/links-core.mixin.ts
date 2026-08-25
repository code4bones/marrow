import type { Knex } from "knex";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { stringArray, stringOrNull } from "../formatters/common.js";
import { linkOut } from "../formatters/links.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";
import { ProjectsCoreMixin } from "./projects-core.mixin.js";

// LinksCoreMixin's createLink/linksPage call this.resolveProject /
// this.tryCurrentProject, which are added by ProjectsCoreMixin -- so this
// mixin can only be composed onto a base that already includes it (see
// service.ts's composition order).
type ProjectsCoreInstance = InstanceType<ReturnType<typeof ProjectsCoreMixin<Constructor<BaseService>>>>;

export function LinksCoreMixin<TBase extends Constructor<ProjectsCoreInstance>>(Base: TBase) {
  return class extends Base {

  protected async createLink(input: Row, context: NormalizedGatewayRequestContext) {
    await this.assertRecordExists(String(input.fromId));
    await this.assertRecordExists(String(input.toId));
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    const row = {
      id: await this.nextId("links", project ? `L-${projectKeyFromId(project.id)}` : "L-COMMON"),
      project_id: project?.id ?? null,
      from_id: String(input.fromId),
      to_id: String(input.toId),
      relation: String(input.relation),
      created_by: context.clientId,
      source_instance_id: context.clientId,
      created_at: nowIso()
    };
    await this.db("links").insert(row);
    await this.recordEventForProject(row.project_id, {
      type: "link.created",
      title: `Link created: ${row.from_id} ${row.relation} ${row.to_id}`,
      related_id: row.id
    }, context);
    return linkOut(row);
  }

  // Shared by memory.create and decision.record (I-MEMORY-022 step 2): if the
  // caller passes explicit links, create them atomically with the new record
  // so the graph doesn't stay sparse. Otherwise, when tags were given, run a
  // cheap tag-overlap query and return candidates as a non-blocking hint —
  // never throws, since this is best-effort assistance, not validation.
  protected async applyRecordLinkage(
    fromId: string,
    projectId: string | null,
    tags: unknown,
    links: unknown,
    context: NormalizedGatewayRequestContext
  ): Promise<{ linksCreated?: unknown[]; relatedCandidates?: unknown[] }> {
    const linkEntries = Array.isArray(links) ? links : [];
    if (linkEntries.length > 0) {
      const linksCreated: unknown[] = [];
      for (const entry of linkEntries) {
        const candidate = entry as Row;
        const toId = typeof candidate?.toId === "string" ? candidate.toId : null;
        const relation = typeof candidate?.relation === "string" ? candidate.relation : null;
        if (!toId || !relation) {
          continue;
        }
        await this.assertRecordExists(toId);
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
        linksCreated.push(linkOut(row));
      }
      return linksCreated.length > 0 ? { linksCreated } : {};
    }

    const tagList = stringArray(tags);
    if (tagList.length === 0) {
      return {};
    }
    const relatedCandidates = await this.findRelatedByTags(fromId, projectId, tagList);
    return relatedCandidates.length > 0 ? { relatedCandidates } : {};
  }

  protected async findRelatedByTags(
    excludeId: string,
    projectId: string | null,
    tags: string[]
  ): Promise<Array<{ id: string; type: string; title: string }>> {
    const scope = (query: Knex.QueryBuilder) =>
      projectId === null ? query.whereNull("project_id") : query.where("project_id", projectId);

    // Postgres' jsonb "?|" (any key exists) operator collides with knex's own
    // "?" placeholder parsing, so the overlap check is expressed via
    // jsonb_array_elements_text + ANY(?::text[]) instead, which needs only
    // one real bind parameter.
    const tagOverlap = "EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS t(tag) WHERE t.tag = ANY(?::text[]))";
    const items = await scope(this.db("items").select("id", "type", "title", "created_at"))
      .whereRaw(tagOverlap, [tags])
      .andWhere("id", "!=", excludeId);
    const decisions = await scope(this.db("decisions").select("id", "title", "created_at"))
      .whereRaw(tagOverlap, [tags])
      .andWhere("id", "!=", excludeId);

    return [
      ...items.map((row: Row) => ({ id: String(row.id), type: String(row.type), title: String(row.title), createdAt: String(row.created_at) })),
      ...decisions.map((row: Row) => ({ id: String(row.id), type: "decision", title: String(row.title), createdAt: String(row.created_at) }))
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 3)
      .map(({ id, type, title }) => ({ id, type, title }));
  }

  protected async listLinks(input: Row) {
    const direction = input.direction ?? "both";
    let query = this.db("links").select("*");
    if (direction === "from") {
      query = query.where("from_id", String(input.id));
    } else if (direction === "to") {
      query = query.where("to_id", String(input.id));
    } else {
      query = query.where((builder) => builder.where("from_id", String(input.id)).orWhere("to_id", String(input.id)));
    }
    if (input.relation) {
      query = query.andWhere("relation", String(input.relation));
    }
    return (await query.orderBy("created_at", "desc").limit(Number(input.limit ?? 50))).map(linkOut);
  }

  protected async deleteLink(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("links").where({ id }).first();
    if (!current) {
      throw new AppError("LINK_NOT_FOUND", `Link ${id} does not exist.`, { id });
    }
    if (current.project_id) {
      await this.assertProjectMember(String(current.project_id), context);
    }
    await this.db("links").where({ id }).del();
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "link.deleted",
      title: `Link deleted: ${String(current.from_id)} ${String(current.relation)} ${String(current.to_id)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedLink: linkOut(current),
      event
    };
  }

  protected async linksPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("links");
    if (input.id) {
      const direction = input.direction ?? "both";
      if (direction === "from") {
        base.where("from_id", String(input.id));
      } else if (direction === "to") {
        base.where("to_id", String(input.id));
      } else {
        base.where((builder) => builder.where("from_id", String(input.id)).orWhere("to_id", String(input.id)));
      }
    } else {
      const commonOnly = input.common === true || input.project === null;
      const includeCommon = commonOnly ? true : input.includeCommon !== false;
      const project = commonOnly
        ? null
        : input.project
          ? await this.resolveProject(input.project, context)
          : await this.tryCurrentProject(context);
      if (!project && !includeCommon) {
        throw new AppError("CURRENT_PROJECT_NOT_SET", "Link list requires an id, a project, or includeCommon=true.");
      }

      base.andWhere((builder) => {
        if (project) {
          builder.orWhere("project_id", project.id);
        }
        if (includeCommon) {
          builder.orWhereNull("project_id");
        }
      });
    }

    if (input.relation) {
      base.andWhere("relation", String(input.relation));
    }

    return this.pageRows(
      base,
      input,
      (query) =>
        query
          .select("*")
          .orderByRaw("case when project_id is null then 1 else 0 end asc")
          .orderBy("created_at", "desc"),
      linkOut
    );
  }

  };
}

// Convenience instance type for Tier 2 mixins that need everything through
// Tier 1 (Base + ProjectsCore + LinksCore) -- avoids re-deriving this
// InstanceType<ReturnType<...>> chain in every dependent file.
export type Tier1Instance = InstanceType<ReturnType<typeof LinksCoreMixin<Constructor<ProjectsCoreInstance>>>>;
