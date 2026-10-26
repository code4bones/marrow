import type { Knex } from "knex";
import { AppError } from "../../shared/errors.js";
import { enqueueTellyTaskOffer, tellyInboxEnabled } from "../telly-inbox.js";
import { shortText, stringArray, stringOrNull } from "../pg-tool-service/formatters/common.js";
import type { Row } from "../pg-tool-service/types.js";
import type { MentionedMember } from "./members.js";

// Internal worker path only: no client metadata can enable this. Telegram
// automation has no human assignment actor, but is authorized by the current
// project owner. Preserve integration authorship and label the offer as a bot.
export async function enqueueTelegramTaskOffers(db: Knex, bot: Row, project: Row, task: Row,
  recipients: MentionedMember[], assigneeIds: string[]): Promise<void> {
  if (!tellyInboxEnabled() || !project.owner_user_id || !assigneeIds.length ||
      recipients.some((member) => member.resolution === "owner")) return;
  const resolved = new Set(recipients.filter((member) => member.resolution === "manual" || member.resolution === "linked").map((member) => member.userId));
  if (assigneeIds.some((id) => !resolved.has(id))) return;
  const events = await db("events").where({ project_id: project.id, related_id: task.id, type: "task.assigned" }).select("id", "target_user_ids");
  const summary = [stringOrNull(task.scope), stringOrNull(task.notes)].filter(Boolean).join("\n");
  for (const recipientUserId of new Set(assigneeIds)) {
    const event = events.find((event) => stringArray(event.target_user_ids).includes(recipientUserId));
    if (!event) throw new AppError("GATEWAY_ERROR", "Telegram task assignment event is missing.");
    await enqueueTellyTaskOffer(db, {
      sourceEventId: String(event.id), projectId: String(project.id), projectSlug: String(project.slug), projectTitle: String(project.title),
      taskId: String(task.id), title: String(task.title), summary: summary ? shortText(summary, 600) : null,
      status: String(task.status), priority: Number(task.priority ?? 100), milestone: stringOrNull(task.milestone),
      acceptance: stringOrNull(task.acceptance), recipientUserId, actorUserId: String(project.owner_user_id),
      actorLabel: `Telegram @${bot.username}`
    });
  }
}
