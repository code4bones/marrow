import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { combinedRankSql, jsonStringArray, prefixRankSql, prefixWhereSql, stringOrNull, toPrefixTsQueryText } from "../formatters/common.js";
import { compactSkillRecord, skillOut } from "../formatters/skills.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

// D-MEMORY-041: a skill's body is always text/markdown, never binary, and
// small (agent-loadable instructions, not file attachments) -- unlike
// ArtifactsMixin this domain is DB-only, no filesystem I/O, which keeps FTS/
// backup/versioning simple with no downside.
export function SkillsMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  protected async recordSkill(input: Row, context: NormalizedGatewayRequestContext) {
    const project = input.project === null ? null : await this.resolveProject(input.project, context);
    const name = String(input.name);
    await this.assertSkillNameAvailable(project?.id ?? null, name);
    const now = nowIso();
    const row = {
      id: await this.nextId("skills", project ? `SK-${projectKeyFromId(project.id)}` : "SK-COMMON"),
      project_id: project?.id ?? null,
      name,
      description: stringOrNull(input.description),
      body: String(input.body),
      status: typeof input.status === "string" ? input.status : "active",
      tags: jsonStringArray(input.tags),
      activation_count: 0,
      last_activated_at: null,
      created_by: context.clientId,
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      version: 1,
      created_at: now,
      updated_at: now
    };
    await this.db("skills").insert(row);
    await this.recordEventForProject(row.project_id, {
      type: "skill.created",
      title: `Skill created: ${row.name}`,
      related_id: row.id
    }, context);
    const linkage = await this.applyRecordLinkage(row.id, row.project_id, input.tags, input.links, context);
    return { skill: { ...skillOut(row), ...linkage } };
  }

  // Mirrors the migration's unique index on (coalesce(project_id,
  // '__common__'), lower(name)) -- checked proactively so a duplicate name
  // surfaces as a clean, actionable AppError instead of a raw constraint
  // violation. `excludeId` lets updateSkill reuse this when the name itself
  // is being changed, without tripping over the row's own current name.
  protected async assertSkillNameAvailable(projectId: string | null, name: string, excludeId?: string): Promise<void> {
    let query = this.db("skills").whereRaw("lower(name) = lower(?)", [name]);
    query = projectId ? query.andWhere("project_id", projectId) : query.whereNull("project_id");
    if (excludeId) {
      query = query.andWhereNot("id", excludeId);
    }
    const existing = await query.first();
    if (existing) {
      throw new AppError("SKILL_CONFLICT", `A skill named "${name}" already exists in this scope. Use skill.update on ${String(existing.id)} instead.`, {
        existingId: String(existing.id)
      });
    }
  }

  // T-MEMORY-057 (IDOR): skill ids are sequential/predictable too, same
  // guard artifactRowById/getDecision already apply.
  protected async skillRowById(id: string, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const row = await this.db("skills").where({ id }).first();
    if (!row) {
      throw new AppError("SKILL_NOT_FOUND", `Skill ${id} does not exist.`, { id });
    }
    if (row.project_id) {
      await this.assertProjectMember(String(row.project_id), context);
    }
    return row;
  }

  protected async getSkill(id: string, context?: NormalizedGatewayRequestContext) {
    return skillOut(await this.skillRowById(id, context));
  }

  // No default status filter (unlike artifacts' default-to-"current") -- an
  // author browsing their own skills wants to see drafts too. Optional
  // `query` triggers FTS ranking (folds an FTS/search variant into this one
  // method rather than a separate skill.search -- skills are expected to be
  // dozens per project, not thousands, so a dedicated rank-only search
  // method isn't worth the duplication).
  protected async listSkills(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    if (!project && !includeCommon) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Skill list requires a project or includeCommon=true.");
    }

    let query = this.db("skills").select("*");
    const queryText = typeof input.query === "string" ? input.query : null;
    let hasFilter = false;
    if (queryText && input.prefix === true) {
      const prefixQuery = toPrefixTsQueryText(queryText);
      if (prefixQuery) {
        hasFilter = true;
        query = query
          .select(this.db.raw(`${prefixRankSql("skills")} as rank`, [prefixQuery, prefixQuery, prefixQuery]))
          .where((builder) => builder.whereRaw(prefixWhereSql(), [prefixQuery, prefixQuery, prefixQuery]).orWhereRaw("id ilike ?", [`%${queryText}%`]));
      }
    } else if (queryText) {
      hasFilter = true;
      query = query
        .select(this.db.raw(`${combinedRankSql("skills")} as rank`, [queryText, queryText, queryText]))
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
    if (Array.isArray(input.tags) && input.tags.length > 0) {
      query = query.andWhereRaw("tags @> ?::jsonb", [JSON.stringify(input.tags)]);
    }
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }

    const rows = await query
      .orderByRaw("case when project_id is null then 1 else 0 end asc")
      .orderBy(hasFilter ? "rank" : "updated_at", "desc")
      .limit(Number(input.limit ?? 20));
    const skills = rows.map(skillOut);
    return input.compact === true ? skills.map(compactSkillRecord) : skills;
  }

  protected async skillsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const includeCommon = input.includeCommon !== false;
    const project = input.project ? await this.resolveProject(input.project, context) : await this.tryCurrentProject(context);
    const queryText = typeof input.query === "string" ? input.query : null;
    const base = this.db("skills");
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
    if (input.status) {
      base.andWhere("status", String(input.status));
    }

    return this.pageRows(
      base,
      input,
      (query) => {
        query.select("*");
        if (queryText) {
          query.select(this.db.raw(`${combinedRankSql("skills")} as rank`, [queryText, queryText, queryText]));
        }
        query.orderByRaw("case when project_id is null then 1 else 0 end asc");
        return query.orderBy(queryText ? "rank" : "updated_at", "desc");
      },
      skillOut
    );
  }

  protected async updateSkill(input: Row, context: NormalizedGatewayRequestContext) {
    const current = await this.skillRowById(String(input.id), context);
    const name = typeof input.name === "string" ? input.name : String(current.name);
    if (name.toLowerCase() !== String(current.name).toLowerCase()) {
      await this.assertSkillNameAvailable(stringOrNull(current.project_id), name, String(current.id));
    }
    const [row] = await this.db("skills")
      .where({ id: String(current.id) })
      .update({
        name,
        description:
          input.description === null
            ? null
            : typeof input.description === "string"
              ? input.description
              : current.description,
        body: typeof input.body === "string" ? input.body : current.body,
        tags: jsonStringArray(Array.isArray(input.tags) ? input.tags : current.tags),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "skill.updated",
      title: `Skill updated: ${String(row.name)}`,
      related_id: row.id
    }, context);
    return skillOut(row);
  }

  protected async archiveSkill(input: Row, context: NormalizedGatewayRequestContext) {
    const current = await this.skillRowById(String(input.id), context);
    if (String(current.status) === "archived") {
      return {
        action: "already_archived",
        skill: skillOut(current),
        event: null
      };
    }

    const now = nowIso();
    const [row] = await this.db("skills")
      .where({ id: String(current.id) })
      .update({
        status: "archived",
        archived_at: now,
        archived_by: context.clientId,
        archive_reason: stringOrNull(input.reason),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "skill.archived",
      title: `Skill archived: ${String(row.name)}`,
      body: stringOrNull(input.reason),
      related_id: row.id
    }, context);

    return {
      action: "archived",
      skill: skillOut(row),
      event
    };
  }

  protected async deleteSkill(input: Row, context: NormalizedGatewayRequestContext) {
    const current = await this.skillRowById(String(input.id), context);
    const id = String(current.id);
    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("skills").where({ id }).del();
    });
    const event = await this.recordEventForProject(stringOrNull(current.project_id), {
      type: "skill.deleted",
      title: `Skill deleted: ${String(current.name)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedSkill: skillOut(current),
      deletedLinks,
      event
    };
  }

  // D-MEMORY-041: the key new verb -- distinct from getSkill because it's a
  // trackable ACTION (an agent about to follow this skill's instructions),
  // not passive reading. Bumps activation_count/last_activated_at and
  // records a skill.activated event so "who activated what, when" is
  // auditable, analogous to how a Claude Code Skill loads instructions into
  // context when invoked. Only an active skill can be activated -- draft/
  // archived skills stay invisible to this agent-facing surface even though
  // skill.get/skill.list can still show them to their author.
  protected async activateSkill(input: Row, context: NormalizedGatewayRequestContext) {
    const current = await this.skillRowById(String(input.id), context);
    if (String(current.status) !== "active") {
      throw new AppError("VALIDATION_ERROR", `Skill ${String(current.id)} is not active (status: ${String(current.status)}) and cannot be activated.`, {
        id: current.id,
        status: current.status
      });
    }
    const now = nowIso();
    const [row] = await this.db("skills")
      .where({ id: String(current.id) })
      .update({
        activation_count: this.db.raw("activation_count + 1"),
        last_activated_at: now
      })
      .returning("*");
    await this.recordEventForProject(stringOrNull(row.project_id), {
      type: "skill.activated",
      title: `Skill activated: ${String(row.name)}`,
      related_id: row.id
    }, context);
    return { skill: skillOut(row) };
  }

  };
}
