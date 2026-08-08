import type { Knex } from "knex";
import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { createProjectId } from "../../../shared/ids/id.service.js";
import { artifactAbsolutePath } from "../formatters/artifacts.js";
import { currentProjectKey, stringOrNull, writeActorFields } from "../formatters/common.js";
import { compactProject, projectInviteLinkOut, projectOut, scoreProjectCandidate } from "../formatters/projects.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import { type Constructor, BaseService } from "../base.js";

// Project sharing: URL-safe random invite codes -- same base64url shape as
// oauth.ts's randomToken()/base64url() (24 raw bytes, base64url-encoded, no
// padding), reimplemented here as a small local equivalent since those two
// helpers are private to oauth.ts.
function randomInviteCode(): string {
  return randomBytes(24).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function ProjectsCoreMixin<TBase extends Constructor<BaseService>>(Base: TBase) {
  return class extends Base {
  protected async createProject(input: Row, context: NormalizedGatewayRequestContext) {
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

  protected async listProjects(input: Row, context?: NormalizedGatewayRequestContext) {
    let query = this.db("projects").select("*").orderBy("slug");
    if (input.status) {
      query = query.where("status", String(input.status));
    }
    query = this.applyProjectMembershipFilter(query, context);
    return (await query).map(input.compact === true ? compactProject : projectOut);
  }

  protected async projectsPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const base = this.db("projects");
    if (input.status) {
      base.where("status", String(input.status));
    }
    this.applyProjectMembershipFilter(base, context);
    return this.pageRows(base, input, (query) => query.select("*").orderBy("slug"), projectOut);
  }

  protected async getProject(input: Row, context?: NormalizedGatewayRequestContext) {
    const row = input.id
      ? await this.db("projects").where({ id: String(input.id) }).first()
      : await this.db("projects").where({ slug: String(input.slug) }).first();
    if (!row) {
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist.", { ...input });
    }
    await this.assertProjectMember(String(row.id), context);
    return projectOut(row);
  }

  // Any current project member (or an admin, which always bypasses the
  // membership gate) can rename -- no separate per-project "owner" concept
  // exists or is introduced here, per the owner's explicit decision. Reuses
  // getProject()'s existing membership gate rather than duplicating it, so
  // a role=member session with no project_members row gets the exact same
  // PROJECT_NOT_FOUND every other project tool already gives it.
  protected async updateProject(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.getProject(input, context);
    const patch: Row = { updated_at: nowIso(), updated_by: context.clientId };
    if (typeof input.title === "string") {
      patch.title = input.title;
    }
    if (input.description !== undefined) {
      patch.description = stringOrNull(input.description);
    }
    if (typeof input.slug === "string" && input.slug !== project.slug) {
      const clash = await this.db("projects").where({ slug: input.slug }).whereNot({ id: project.id }).first();
      if (clash) {
        throw new AppError("VALIDATION_ERROR", `Project slug "${input.slug}" is already in use.`);
      }
      patch.slug = input.slug;
    }
    const [row] = await this.db("projects").where({ id: project.id }).update(patch).returning("*");
    return projectOut(row);
  }

  // Centralized project-membership gate (D-MEMORY-007 decision 3): only a
  // caller who actually resolves to role=member is ever filtered -- which,
  // since T-MEMORY-052, includes a role=member user connecting over an
  // OAuth-authenticated client, not just a session cookie or personal token
  // (context.sessionRole/sessionUserId fall back to the OAuth owner's real
  // role in requestContext(), http-server.ts). Admin callers and every
  // identity-less auth source (static token, anonymous/none) still bypass
  // this entirely and see every project, unchanged from pre-T-MEMORY-029
  // behavior. A member without a project_members row gets the same
  // PROJECT_NOT_FOUND a nonexistent project would produce -- existence is
  // never leaked, matching this codebase's other don't-distinguish-why
  // conventions (see auth.ts login()).
  protected async assertProjectMember(projectId: string, context?: NormalizedGatewayRequestContext): Promise<void> {
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
  protected async isMemberOfProject(projectId: string, userId: string): Promise<boolean> {
    const membership = await this.db("project_members").where({ project_id: projectId, user_id: userId }).first();
    return Boolean(membership);
  }

  // Query-builder counterpart of assertProjectMember for list/search
  // endpoints that scan many projects (project.list, project.resolve)
  // instead of resolving one specific id/slug.
  protected applyProjectMembershipFilter<T extends Knex.QueryBuilder>(
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

  protected async deleteProject(input: Row) {
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

  // Project sharing: reusable, per-project invite link. One row per
  // project (unique on project_id, migrations/pg/014), get-or-create
  // semantics -- the first request for a project's link lazily creates it,
  // same "lazy generation on first visit" precedent as personal API tokens
  // (T-MEMORY-047). Same membership gate as updateProject above (reused via
  // getProject, not duplicated): any current member (or admin) can invite
  // others, per the owner's explicit decision.
  protected async getOrCreateProjectInviteLink(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.getProject(input, context);
    const existing = await this.db("project_invite_links").where({ project_id: project.id }).first();
    const row = existing ?? (await this.createProjectInviteLinkRow(project.id, context));
    return projectInviteLinkOut(row);
  }

  // Reusable and stable per project, like a Slack workspace invite link --
  // NOT single-use (owner's explicit decision, see this task's plan).
  // Regenerating replaces the code in place; the old code stops resolving
  // immediately (claimProjectInviteLink looks it up by exact match).
  protected async regenerateProjectInviteLink(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.getProject(input, context);
    const code = randomInviteCode();
    const updatedRows = await this.db("project_invite_links")
      .where({ project_id: project.id })
      .update({ code, updated_at: nowIso() })
      .returning("*");
    const row = updatedRows[0] ?? (await this.createProjectInviteLinkRow(project.id, context, code));
    return projectInviteLinkOut(row);
  }

  protected async createProjectInviteLinkRow(
    projectId: string,
    context: NormalizedGatewayRequestContext,
    code: string = randomInviteCode()
  ): Promise<Row> {
    const now = nowIso();
    const row = {
      id: randomUUID(),
      project_id: projectId,
      code,
      created_by: context.sessionUserId,
      created_at: now,
      updated_at: now
    };
    await this.db("project_invite_links").insert(row);
    return row;
  }

  // UNAUTHENTICATED lookup for the invite-landing page (wired as a
  // dedicated REST route in http-server.ts, GET /project-invites/:code --
  // same "no scope/session gate at all" shape as GET /auth/claim, not a
  // GraphQL query, since the GraphQL/MCP request pipelines both always run
  // through the memory:read scope check first and this must work for a
  // fully anonymous visitor). Deliberately returns only {projectTitle,
  // projectSlug} -- safe to expose with no auth at all, since any current
  // project member could already just tell someone the project's name; does
  // NOT confirm anything about the code beyond "this project exists and has
  // this title", never project internals.
  protected async resolveProjectInviteContext(code: string): Promise<{ projectTitle: string; projectSlug: string }> {
    const linkRow = await this.db("project_invite_links").where({ code }).first();
    if (!linkRow) {
      throw new AppError("NOT_FOUND", "This invite link is no longer valid.", { code });
    }
    const projectRow = await this.db("projects").where({ id: linkRow.project_id }).first();
    if (!projectRow) {
      throw new AppError("NOT_FOUND", "This invite link is no longer valid.", { code });
    }
    return { projectTitle: String(projectRow.title), projectSlug: String(projectRow.slug) };
  }

  // Joining a project via its invite link requires a real user identity --
  // context.sessionUserId, populated for both a browser session AND a
  // personal API token bearer (see NormalizedGatewayRequestContext's own
  // comment), deliberately NOT the narrower requireSessionUserId used by
  // git-credential management (that one additionally requires
  // sessionSource === "cookie" for a different reason -- a raw secret only
  // ever entering/leaving through the trusted browser UI -- which doesn't
  // apply here). A static token, OAuth connector, or anonymous caller never
  // populates sessionUserId, so it gets a clear, fail-closed error instead
  // of silently doing nothing or joining nobody.
  protected async claimProjectInviteLink(input: Row, context: NormalizedGatewayRequestContext) {
    if (!context.sessionUserId) {
      throw new AppError(
        "UNAUTHORIZED",
        "Joining a project requires a logged-in session or personal API token (no static token, OAuth connector, or anonymous caller can join a project this way)."
      );
    }
    const code = String(input.code);
    const linkRow = await this.db("project_invite_links").where({ code }).first();
    if (!linkRow) {
      throw new AppError("PROJECT_INVITE_NOT_FOUND", "This invite link is no longer valid.", { code });
    }
    const projectRow = await this.db("projects").where({ id: linkRow.project_id }).first();
    if (!projectRow) {
      throw new AppError("PROJECT_INVITE_NOT_FOUND", "This invite link is no longer valid.", { code });
    }
    // Idempotent: re-claiming an already-joined project is a friendly
    // no-op, not an error (this task's explicit acceptance criteria).
    const alreadyMember = await this.isMemberOfProject(String(projectRow.id), context.sessionUserId);
    if (!alreadyMember) {
      await this.db("project_members").insert({
        project_id: projectRow.id,
        user_id: context.sessionUserId,
        created_at: nowIso()
      });
      await this.recordEventForProject(String(projectRow.id), {
        type: "project.member_joined",
        title: `Project joined via invite link: ${String(projectRow.title)}`,
        related_id: String(projectRow.id)
      }, context);
    }
    return { project: projectOut(projectRow), joined: !alreadyMember };
  }

  protected async resolveProjectCandidates(input: Row, context?: NormalizedGatewayRequestContext) {
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


  protected async projectDeleteCounts(projectId: string) {
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


  protected async setCurrentProject(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.getProject(input, context);
    await this.setKv(currentProjectKey(context.clientId), project.id);
    return project;
  }

  protected async currentProject(context?: NormalizedGatewayRequestContext) {
    const currentProjectId = context
      ? (await this.getKv(currentProjectKey(context.clientId))) ?? (await this.getKv("current_project_id"))
      : await this.getKv("current_project_id");
    if (!currentProjectId) {
      throw new AppError("CURRENT_PROJECT_NOT_SET", "Current project is not configured.");
    }
    return this.getProject({ id: currentProjectId }, context);
  }

  protected async resolveProject(project?: unknown, context?: NormalizedGatewayRequestContext) {
    if (typeof project === "string" && project.length > 0) {
      return project.startsWith("P-")
        ? this.getProject({ id: project }, context)
        : this.getProject({ slug: project }, context);
    }
    return this.currentProject(context);
  }


  protected async tryCurrentProject(context?: NormalizedGatewayRequestContext) {
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
