import type { Knex } from "knex";
import { AppError } from "../shared/errors.js";
import { userIdFromClientId } from "./credits.js";
import type { NormalizedGatewayRequestContext } from "./pg-tool-service/types.js";

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

// T-MEMORY-095: "self-notify" only means something for a real interactive
// browser click -- context.sessionSource === "cookie". An agent session
// (Claude Code, Codex, ...) connected over OAuth or a personal token
// resolves to the exact same clientId ("user:<id>") as that person's own
// browser session, but the owner isn't the one physically watching it
// happen -- in practice, per the owner, almost everything in this app is
// agent-driven ("браузер чисто для красоты"), so excluding by clientId
// alone would have made this notify path silent almost always. Only a real
// cookie session for that same user counts as "they just watched this
// happen themselves, no need to also ping their phone."
function isInteractiveSelfAction(context: NormalizedGatewayRequestContext, candidateUserId: string): boolean {
  return context.sessionSource === "cookie" && context.sessionUserId === candidateUserId;
}

// T-MEMORY-093 follow-up: who a lifecycle event (status change, completion)
// on an assigned task/decision should notify -- the assignee, but not the
// assignee themselves if they're the one who just clicked it in their own
// browser (see isInteractiveSelfAction above -- an agent acting "as" them
// still notifies). Returns undefined (not null) so callers can spread it
// straight into recordEventForProject's input without an extra
// null-vs-undefined branch.
export function assigneeNotifyTarget(
  assigneeUserId: string | null | undefined,
  context: NormalizedGatewayRequestContext
): string | undefined {
  if (!assigneeUserId) {
    return undefined;
  }
  return isInteractiveSelfAction(context, assigneeUserId) ? undefined : assigneeUserId;
}

// T-MEMORY-093 follow-up (owner's ask): "if the owner is one person and the
// assignee is another, a lifecycle event notifies everyone involved" -- both
// the creator and the assignee, deduped, minus whoever is watching it happen
// live in their own browser right now (see isInteractiveSelfAction). Used
// for status-change/completion events, as opposed to assigneeNotifyTarget
// above which is assignment-only (create/reassign) and only ever targets
// the new assignee.
export function lifecycleNotifyTargets(
  createdByClientId: unknown,
  assigneeUserId: string | null | undefined,
  context: NormalizedGatewayRequestContext
): string[] {
  const owner = userIdFromClientId(createdByClientId);
  const candidates = [owner, assigneeUserId ?? null];
  return Array.from(
    new Set(candidates.filter((id): id is string => id !== null && !isInteractiveSelfAction(context, id)))
  );
}
