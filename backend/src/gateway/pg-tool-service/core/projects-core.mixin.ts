import type { Knex } from "knex";
import { rm } from "node:fs/promises";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { createProjectId } from "../../../shared/ids/id.service.js";
import { artifactAbsolutePath } from "../formatters/artifacts.js";
import { currentProjectKey, stringOrNull, writeActorFields } from "../formatters/common.js";
import { compactProject, projectOut, scoreProjectCandidate } from "../formatters/projects.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

export function ProjectsCoreMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  private async createProject(input: Row, context: NormalizedGatewayRequestContext) {
    const now = nowIso();
    const baseId = createProjectId(String(input.slug));
    const id = await this.uniqueProjectId(baseId);
    const row = {
      id,
      slug: String(input.slug),
      title: String(input.title),
      description: stringOrNull(input.description),
      status: "active",
      root_path: stringOrNull(input.rootPath),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db("projects").insert(row);
    await this.recordEventForProject(id, {
      type: "project.created",
      title: `Project created: ${row.title}`,
      related_id: id
    }, context);
    return projectOut(row);
  }

  private async listProjects(input: Row, context?: NormalizedGatewayRequestContext) {
    let query = this.db("projects").select("*").orderBy("slug");
    if (input.status) {
      query = query.where("status", String(input.status));
    }
    query = this.applyProjectMembershipFilter(query, context);
    return (await query).map(input.compact === true ? compactProject : projectOut);
  }

  private async projectsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("projects");
    if (input.status) {
      base.where("status", String(input.status));
    }
    this.applyProjectMembershipFilter(base, context);
    return this.pageRows(base, input, (query) => query.select("*").orderBy("slug"), projectOut);
  }

  private async getProject(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id
      ? await this.db("projects").where({ id: String(input.id) }).first()
      : await this.db("projects").where({ slug: String(input.slug) }).first();
    if (!row) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.", { ...input });
    }
    await this.assertProjectMember(String(row.id), context);
    return projectOut(row);
  }

  // Centralized project-membership gate (D-MEMORY-007 decision 3): only a
  // role=member session is ever filtered. Admin sessions and every
  // non-session auth source (static token, OAuth, anonymous/none) bypass
  // this entirely and see every project, unchanged from pre-T-MEMORY-029
  // behavior. A member without a project_members row gets the same
  // PROJECT_NOT_FOUND a nonexistent project would produce -- existence is
  // never leaked, matching this codebase's other don't-distinguish-why
  // conventions (see auth.ts login()).
  private async assertProjectMember(projectId: string, context?: NormalizedGatewayRequestContext): Promise<void> {
    if (!context || context.sessionRole !== "member" || !context.sessionUserId) {
      return;
    }
    if (!(await this.isMemberOfProject(projectId, context.sessionUserId))) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.");
    }
  }

  // Shared single-row membership query, used by both assertProjectMember
  // above (REST/MCP/GraphQL request path) and isProjectVisibleToSession below
  // (WS subscription event filtering, T-MEMORY-042) -- one query, two
  // call sites, instead of duplicating the project_members lookup.
  private async isMemberOfProject(projectId: string, userId: string): Promise<boolean> {
    const membership = await this.db("project_members").where({ project_id: projectId, user_id: userId }).first();
    return Boolean(membership);
  }

  // Query-builder counterpart of assertProjectMember for list/search
  // endpoints that scan many projects (project.list, project.resolve)
  // instead of resolving one specific id/slug.
  private applyProjectMembershipFilter<T extends Knex.QueryBuilder>(
    query: T,
    context?: NormalizedGatewayRequestContext
  ): T {
    if (context?.sessionRole === "member" && context.sessionUserId) {
      query.whereIn("id", this.db("project_members").select("project_id").where({ user_id: context.sessionUserId }));
    }
    return query;
  }

  // T-MEMORY-042: mirrors assertProjectMember's exact bypass rules, but as a
  // boolean predicate rather than a throw -- used by the WS subscription
  // resolver (graphql.ts's filteredGatewayEvents) to decide whether a given
  // published event envelope is visible to one open connection's session
  // identity. role=admin always passes; a common-scope event
  // (projectId === null) always passes for anyone; role=member is checked
  // against project_members exactly like assertProjectMember. Subscriptions
  // are session-only (see http-server.ts's WS upgrade handling), so the
  // caller is always a real session identity, never a static-token/OAuth/
  // anonymous context.
  async isProjectVisibleToSession(
    projectId: string | null,
    session: { role: string; userId: string }
  ): Promise<boolean> {
    if (session.role !== "member" || projectId === null) {
      return true;
    }
    return this.isMemberOfProject(projectId, session.userId);
  }

  private async deleteProject(input: Row) {
    const project = await this.getProject(input);
    const counts = await this.projectDeleteCounts(project.id);
    const dependentRows = counts.tasks + counts.items + counts.decisions + counts.links + counts.events + counts.artifacts;
    const cascade = input.cascade === true;
    if (dependentRows > 0 && !cascade) {
      throw new AppError("PROJECT_NOT_EMPTY", "Project has dependent records. Re-run with cascade=true to delete it.", {
        project,
        counts
      });
    }

    const artifactRows = await this.db("artifacts").select("storage_path").where({ project_id: project.id });
    let currentProjectKeys = 0;
    await this.db.transaction(async (trx) => {
      const deletedKeys = await trx("kv")
        .where({ value: project.id })
        .where((builder) => {
          builder.where({ key: "current_project_id" }).orWhere("key", "like", "current_project_id:%");
        })
        .del();
      currentProjectKeys = Number(deletedKeys);
      await trx("projects").where({ id: project.id }).del();
    });

    for (const artifact of artifactRows) {
      await rm(artifactAbsolutePath(String(artifact.storage_path)), { force: true });
    }

    return {
      deletedProject: project,
      cascade,
      counts: {
        ...counts,
        currentProjectKeys
      }
    };
  }

  private async resolveProjectCandidates(input: Row, context?: NormalizedGatewayRequestContext) {
    const rows = await this.applyProjectMembershipFilter(
      this.db("projects").select("*").where({ status: "active" }),
      context
    );
    const candidates = rows
      .map((row) => scoreProjectCandidate(row, input))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.project.slug.localeCompare(right.project.slug))
      .slice(0, Number(input.limit ?? 10));
    const top = candidates[0];
    const second = candidates[1];
    const resolved = top && (!second || top.score > second.score) ? top.project : null;

    return {
      resolved,
      ambiguous: Boolean(top && second && top.score === second.score),
      candidates
    };
  }


  private async projectDeleteCounts(projectId: string) {
    const [tasks, taskClaims, items, decisions, links, events, artifacts] = await Promise.all([
      this.countQueryRows(this.db("tasks").where("project_id", projectId)),
      this.countQueryRows(this.db("task_claims").where("project_id", projectId)),
      this.countQueryRows(this.db("items").where("project_id", projectId)),
      this.countQueryRows(this.db("decisions").where("project_id", projectId)),
      this.countQueryRows(this.db("links").where("project_id", projectId)),
      this.countQueryRows(this.db("events").where("project_id", projectId)),
      this.countQueryRows(this.db("artifacts").where("project_id", projectId))
    ]);
    return {
      tasks,
      taskClaims,
      items,
      decisions,
      links,
      events,
      artifacts
    };
  }


  private async setCurrentProject(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.getProject(input, context);
    await this.setKv(currentProjectKey(context.clientId), project.id);
    return project;
  }

  private async currentProject(context?: NormalizedGatewayRequestContext) {
    const currentProjectId = context
      ? (await this.getKv(currentProjectKey(context.clientId))) ?? (await this.getKv("current_project_id"))
      : await this.getKv("current_project_id");
    if (!currentProjectId) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Current project is not configured.");
    }
    return this.getProject({ id: currentProjectId }, context);
  }

  private async resolveProject(project?: unknown, context?: NormalizedGatewayRequestContext) {
    if (typeof project === "string" && project.length > 0) {
      return project.startsWith("P-")
        ? this.getProject({ id: project }, context)
        : this.getProject({ slug: project }, context);
    }
    return this.currentProject(context);
  }


  private async tryCurrentProject(context?: NormalizedGatewayRequestContext) {
    try {
      return await this.currentProject(context);
    } catch (error) {
      if (error instanceof AppError && error.code === "CURRENT_PROJECT_NOT_SET") {
        return null;
      }
      throw error;
    }
  }
  };
}
