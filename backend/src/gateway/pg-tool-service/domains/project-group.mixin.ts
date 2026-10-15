import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectGroupMemberOut } from "../formatters/project-group.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type Tier1Instance } from "../core/links-core.mixin.js";

function requiredString(input: Row, field: string): string {
  const value = typeof input[field] === "string" ? input[field].trim() : "";
  if (!value) {
    throw new AppError("VALIDATION_ERROR", `project_group.${field} is required.`, { input });
  }
  return value;
}

export function ProjectGroupMixin<TBase extends Constructor<Tier1Instance>>(Base: TBase) {
  return class extends Base {

  protected async addProjectGroupMember(input: Row, context: NormalizedGatewayRequestContext) {
    const key = requiredString(input, "key");
    const project = await this.resolveProject(input.projectId, context);
    await this.assertProjectMember(project.id, context);
    const row = {
      key,
      project_id: project.id,
      created_by: context.clientId,
      created_at: nowIso()
    };
    await this.db("project_group").insert(row).onConflict(["key", "project_id"]).ignore();
    return projectGroupMemberOut(row);
  }

  protected async removeProjectGroupMember(input: Row, context: NormalizedGatewayRequestContext) {
    const key = requiredString(input, "key");
    const project = await this.resolveProject(input.projectId, context);
    await this.assertProjectMember(project.id, context);
    const deleted = await this.db("project_group").where({ key, project_id: project.id }).del();
    return deleted > 0;
  }

  // Renames every member row in one update (not a remove+re-add dance --
  // atomic, and doesn't risk losing a row if a step fails partway).
  // Membership is checked against every project currently under oldKey,
  // same "must be a member of what you're touching" spirit as add/remove.
  protected async renameProjectGroup(input: Row, context: NormalizedGatewayRequestContext) {
    const oldKey = requiredString(input, "oldKey");
    const newKey = requiredString(input, "newKey");
    const members = await this.db("project_group").where({ key: oldKey }).select("*");
    if (members.length === 0) {
      throw new AppError("VALIDATION_ERROR", `No project_group members found for key "${oldKey}".`, { input });
    }
    for (const member of members) {
      await this.assertProjectMember(String(member.project_id), context);
    }
    await this.db("project_group").where({ key: oldKey }).update({ key: newKey });
    const renamed = await this.db("project_group").where({ key: newKey }).select("*");
    return renamed.map(projectGroupMemberOut);
  }

  // Unfiltered by design (I-context 2026-10-15): this is small (one row per
  // project per group, no group ever expected to run into the hundreds) and
  // read for pure UI clustering -- the Projects list only ever renders
  // projects the caller can already see, so a group row pointing at a
  // project they can't see just never finds a visible match on the other
  // end. No membership check needed here that per-project reads don't
  // already provide downstream.
  protected async projectGroupMembers() {
    const rows = await this.db("project_group").select("*").orderBy("key", "asc");
    return rows.map(projectGroupMemberOut);
  }

  };
}
