import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";
import { userIdFromClientId } from "./credits.js";

// T-MEMORY-090: `assignee` on task.create/decision.record (and the
// task.update_assignee/decision.update_assignee tools) is a loose text
// match an agent can pass from a natural-language instruction ("assign
// this to alex") -- user ids are opaque UUIDs, unusable that way. Resolved
// only against this project's own members (project_members), the same
// pool the UI picker offers, so an agent can't silently assign work to
// someone with no access to the project.
export type AssigneeInput = string | null | undefined;

export function createAssigneesFacade(db: Knex) {
  async function resolveAssigneeUserId(
    projectId: string,
    input: AssigneeInput,
    fallbackClientId: string | null | undefined
  ): Promise<string | null> {
    if (input === undefined) {
      return userIdFromClientId(fallbackClientId);
    }
    if (input === null) {
      return null;
    }

    const needle = input.trim();
    if (!needle) {
      return null;
    }

    const members = await db("project_members")
      .join("users", "users.id", "project_members.user_id")
      .where("project_members.project_id", projectId)
      .select<{ id: string; email: string }[]>("users.id", "users.email");

    const byId = members.filter((member) => member.id === needle);
    if (byId.length === 1) {
      return byId[0].id;
    }

    const lowerNeedle = needle.toLowerCase();
    const byEmail = members.filter((member) => member.email.toLowerCase() === lowerNeedle);
    if (byEmail.length === 1) {
      return byEmail[0].id;
    }

    const byLocalPart = members.filter((member) => member.email.toLowerCase().split("@")[0] === lowerNeedle);
    if (byLocalPart.length === 1) {
      return byLocalPart[0].id;
    }

    const fuzzy = members.filter((member) => member.email.toLowerCase().includes(lowerNeedle));
    if (fuzzy.length === 1) {
      return fuzzy[0].id;
    }
    if (fuzzy.length > 1) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Assignee "${needle}" matches more than one project member: ${fuzzy.map((m) => m.email).join(", ")}. Be more specific.`,
        { needle, candidates: fuzzy.map((m) => m.email) }
      );
    }

    throw new AppError("NOT_FOUND", `No project member matches assignee "${needle}".`, { needle });
  }

  return { resolveAssigneeUserId };
}

export function assigneeDiffersFromOwner(assigneeUserId: string | null | undefined, createdByClientId: unknown): boolean {
  if (!assigneeUserId) {
    return false;
  }
  return assigneeUserId !== userIdFromClientId(createdByClientId);
}
