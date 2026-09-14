import { randomUUID } from "node:crypto";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { encryptEnvValue, validateEnvKey } from "../../environment-variables.js";
import { stringOrNull } from "../formatters/common.js";
import { environmentVariableOut } from "../formatters/environment-variables.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

// Marrow-native "Environment Variables" domain (owner's request,
// 2026-09-14) -- see environment-variables.ts's own header comment for the
// full design rationale ("аналог CI Variables, но название Environment").
// Two scopes, resolved from `input.project` being present or not:
//   - "user" (common/profile): the caller's own private variables, exactly
//     like Git hosts on the profile page -- gated by requireEnvVariableOwner
//     below (any authenticated identity acting as itself: cookie session,
//     personal token, or an OAuth connector's resolved identity).
//   - "project": shared with every project member, gated by
//     assertProjectOwnerOrAdmin on write (same "Settings"-tier gate as
//     project rename/invite/members) and assertProjectMember on read (any
//     member can see a project's variables, via resolveProject itself).
// Deliberately NOT gated to browser-session-only the way git_credentials'
// createGitCredential/deleteGitCredential are: a raw git PAT and a Marrow-
// internal config value are different secret classes -- the git PAT can
// reach a live external system (a whole GitLab instance) if leaked/misused,
// while an environment variable is Marrow's own data, fully reversible by
// re-entering it, and the owner's own framing ("CI Variables ... tools for
// GETTING these variables") implies agents should be able to read AND
// populate this store, not just a human typing secrets into a form.
export function EnvironmentVariablesMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {
  // Deliberately its own name, NOT requireSessionUserId -- UserPrefsMixin
  // (composed outermost in service.ts) already defines its own
  // protected requireSessionUserId, and a same-named protected method on
  // an outer mixin silently shadows an inner one for every caller
  // (I-MEMORY-133's whole lesson: this exact class of bug let a
  // personal-token bearer manage git credentials undetected for a while).
  // The check here happens to want the same simple "sessionUserId is
  // truthy" rule UserPrefsMixin's own method implements, but it must stay
  // self-contained so a future edit to either method can't silently change
  // the other's behavior through the shadow.
  protected requireEnvVariableOwner(context: NormalizedGatewayRequestContext): string {
    if (!context.sessionUserId) {
      throw new AppError(
        "UNAUTHORIZED",
        "Environment variables require an authenticated identity (a session, OAuth connector, or personal API token)."
      );
    }
    return context.sessionUserId;
  }

  protected async recordEnvironmentVariable(input: Row, context: NormalizedGatewayRequestContext) {
    return this.setEnvironmentVariable(input, context);
  }

  protected async setEnvironmentVariable(input: Row, context: NormalizedGatewayRequestContext) {
    const key = validateEnvKey(input.key);
    const value = String(input.value ?? "");
    const secret = input.secret === true;
    const description = stringOrNull(input.description);
    const now = nowIso();

    let scope: "user" | "project";
    let ownerUserId: string | null = null;
    let projectId: string | null = null;
    if (input.project !== undefined && input.project !== null) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      scope = "project";
      projectId = project.id;
    } else {
      scope = "user";
      ownerUserId = this.requireEnvVariableOwner(context);
    }

    const match: Row = scope === "project" ? { scope, project_id: projectId } : { scope, owner_user_id: ownerUserId };
    match.key = key;
    const existing = await this.db("environment_variables").where(match).first();
    const valueEnc = encryptEnvValue(value);

    let row: Row;
    if (existing) {
      [row] = await this.db("environment_variables")
        .where({ id: existing.id })
        .update({ value_enc: valueEnc, secret, description, updated_by: context.clientId, updated_at: now })
        .returning("*");
    } else {
      row = {
        id: randomUUID(),
        scope,
        owner_user_id: ownerUserId,
        project_id: projectId,
        key,
        value_enc: valueEnc,
        secret,
        description,
        created_by: context.clientId,
        updated_by: context.clientId,
        created_at: now,
        updated_at: now
      };
      await this.db("environment_variables").insert(row);
    }

    await this.recordEventForProject(projectId, {
      type: existing ? "environment_variable.updated" : "environment_variable.created",
      title: `Environment variable ${existing ? "updated" : "created"}: ${key}`,
      related_id: String(row.id)
    }, context);

    // Echoed back unredacted -- the caller just supplied this value
    // themselves, same as git.variable_set's own response.
    return environmentVariableOut(row, { redact: false });
  }

  protected async deleteEnvironmentVariable(input: Row, context: NormalizedGatewayRequestContext) {
    const key = validateEnvKey(input.key);
    let match: Row;
    let projectId: string | null = null;
    if (input.project !== undefined && input.project !== null) {
      const project = await this.resolveProject(input.project, context);
      await this.assertProjectOwnerOrAdmin(project, context);
      projectId = project.id;
      match = { scope: "project", project_id: projectId, key };
    } else {
      const ownerUserId = this.requireEnvVariableOwner(context);
      match = { scope: "user", owner_user_id: ownerUserId, key };
    }

    const existing = await this.db("environment_variables").where(match).first();
    if (!existing) {
      throw new AppError("NOT_FOUND", `No environment variable "${key}" found to delete.`);
    }
    await this.db("environment_variables").where({ id: existing.id }).del();
    await this.recordEventForProject(projectId, {
      type: "environment_variable.deleted",
      title: `Environment variable deleted: ${key}`,
      related_id: String(existing.id)
    }, context);
    return { deleted: true as const };
  }

  protected async environmentVariablesList(input: Row, context: NormalizedGatewayRequestContext) {
    const redact = input.redact !== false;
    const commonUserId = context.sessionUserId ?? null;
    const commonRows: Row[] = commonUserId
      ? await this.db("environment_variables").where({ scope: "user", owner_user_id: commonUserId }).orderBy("key", "asc")
      : [];

    let projectRows: Row[] = [];
    if (input.project !== undefined && input.project !== null) {
      const project = await this.resolveProject(input.project, context);
      projectRows = await this.db("environment_variables").where({ scope: "project", project_id: project.id }).orderBy("key", "asc");
    }

    // project rows win on key collision (.env + .env.local, project is the
    // ".local" that overrides), per the owner's explicit call.
    const merged = new Map<string, Row>();
    for (const row of commonRows) merged.set(String(row.key), row);
    for (const row of projectRows) merged.set(String(row.key), row);

    const variables = [...merged.values()]
      .sort((a, b) => String(a.key).localeCompare(String(b.key)))
      .map((row) => environmentVariableOut(row, { redact }));
    return { variables };
  }

  protected async environmentVariableGet(input: Row, context: NormalizedGatewayRequestContext) {
    const key = validateEnvKey(input.key);
    const redact = input.redact !== false;

    let row: Row | undefined;
    if (input.project !== undefined && input.project !== null) {
      const project = await this.resolveProject(input.project, context);
      row = await this.db("environment_variables").where({ scope: "project", project_id: project.id, key }).first();
    }
    if (!row && context.sessionUserId) {
      row = await this.db("environment_variables").where({ scope: "user", owner_user_id: context.sessionUserId, key }).first();
    }
    if (!row) {
      throw new AppError(
        "NOT_FOUND",
        `No environment variable "${key}" found${input.project ? " for this project or your own profile" : " in your own profile"}.`
      );
    }
    return environmentVariableOut(row, { redact });
  }
  };
}
