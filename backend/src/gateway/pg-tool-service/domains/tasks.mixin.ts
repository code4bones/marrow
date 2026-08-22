import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { assigneeDiffersFromOwner, assigneeNotifyTarget, createAssigneesFacade, lifecycleNotifyTargets } from "../../assignees.js";
import { createCreditsFacade, userIdFromClientId } from "../../credits.js";
import { jsonStringArray, stringArray, stringOrNull, writeActorFields } from "../formatters/common.js";
import { eventTypeForStatus } from "../formatters/events.js";
import {
  appendText,
  compactTask,
  taskClaimEffectiveStatus,
  taskClaimEventBody,
  taskClaimLeaseExpiresAt,
  taskClaimOut,
  taskClaimRole,
  taskNoteDefaultRelation,
  taskNoteTypeTitle,
  taskOut,
  taskSortColumn,
  taskSortDirection
} from "../formatters/tasks.js";
import type { NormalizedGatewayRequestContext, Row } from "../types.js";
import type { Constructor } from "../base.js";
import { type MemoryInstance } from "./memory.mixin.js";

// T-MEMORY-065: relations that exclusively mean "this item exists to
// annotate/describe that task" -- addTaskNote's own default relations
// (a caller can still override `relation` at note-creation time, which is
// why deleteOwnedTaskNotes below also checks the "task-note" tag, not just
// this set) plus RemarkPanel's hardcoded "annotates". Never a relation
// that could mean "these two independent records are merely related"
// (relates_to, derives_from, refines, supersedes, warns_against, ...) --
// those must never trigger a cascade delete of the other side.
const TASK_CANCELLED_PENALTY = 5;

const OWNED_TASK_NOTE_RELATIONS = new Set([
  "annotates",
  "implementation_note_for",
  "review_note_for",
  "test_result_for",
  "handoff_for",
  "note_for"
]);

export function TasksMixin<TBase extends Constructor<MemoryInstance>>(Base: TBase) {
  return class extends Base {
  protected async createTask(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const assigneeUserId = await createAssigneesFacade(this.db).resolveAssigneeUserId(
      project.id,
      input.assignee as string | null | undefined,
      context.clientId
    );
    const now = nowIso();
    const row = {
      id: await this.nextId("tasks", `T-${projectKeyFromId(project.id)}`),
      project_id: project.id,
      title: String(input.title),
      status: "todo",
      milestone: stringOrNull(input.milestone),
      priority: input.priority ?? 100,
      scope: stringOrNull(input.scope),
      acceptance: stringOrNull(input.acceptance),
      allowed_files: jsonStringArray(input.allowedFiles),
      forbidden_files: jsonStringArray(input.forbiddenFiles),
      depends_on: jsonStringArray(input.dependsOn),
      notes: stringOrNull(input.notes),
      assignee_user_id: assigneeUserId,
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };
    await this.db("tasks").insert(row);
    await this.recordEventForProject(project.id, {
      type: "task.created",
      title: `Task created: ${row.title}`,
      related_id: row.id
    }, context);
    const createNotifyTarget = assigneeNotifyTarget(assigneeUserId, context);
    if (assigneeDiffersFromOwner(assigneeUserId, row.created_by)) {
      await this.recordEventForProject(project.id, {
        type: "task.assigned",
        title: `Task assigned: ${row.title}`,
        related_id: row.id,
        target_user_ids: createNotifyTarget ? [createNotifyTarget] : []
      }, context);
    }
    return taskOut(row);
  }

  protected async listTasks(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    let query = this.taskSelectWithActiveClaimCount(this.db("tasks")).where("project_id", project.id);
    if (input.status) {
      query = query.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      query = query.andWhere("milestone", String(input.milestone));
    }
    const tasks = (await query.orderBy("priority").orderBy("created_at").limit(Number(input.limit ?? 20))).map(taskOut);
    return input.compact === true ? tasks.map(compactTask) : tasks;
  }

  protected async tasksPage(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const base = this.db("tasks").where("project_id", project.id);
    if (input.status) {
      base.andWhere("status", String(input.status));
    }
    if (input.milestone) {
      base.andWhere("milestone", String(input.milestone));
    }
    // T-MEMORY-051 follow-up: server-driven sort (default updated_at desc).
    // Trailing `id` tiebreaker keeps offset pagination stable when many rows
    // share the same sort-column value.
    const sortColumn = taskSortColumn(input.sortField);
    const sortDirection = taskSortDirection(input.sortDirection);
    return this.pageRows(
      base,
      input,
      (query) => this.taskSelectWithActiveClaimCount(query).orderBy(sortColumn, sortDirection).orderBy("id"),
      taskOut
    );
  }

  // T-MEMORY-057 (IDOR): task ids are sequential/predictable too.
  //
  // I-MEMORY-065: task.get used to return scope/acceptance/notes but never
  // surfaced that OTHER records (implementation notes, review notes,
  // superseding decisions/notes on a related record) point AT this task via
  // links -- an agent reading task.get alone had no signal those existed at
  // all, and had to separately know to call preflight(taskId) or
  // link.list(toId=task) to discover them. noteIds/noteCount are cheap (ids
  // only, no bodies) but make that gap visible.
  protected async getTask(id: string, context?: NormalizedGatewayRequestContext) {
    const row = await this.taskSelectWithActiveClaimCount(this.db("tasks")).where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(row.project_id), context);
    const noteLinks = await this.db("links")
      .where({ to_id: id })
      .andWhere("relation", "like", "%_for")
      .orderBy("created_at", "desc")
      .select("from_id");
    const noteIds = noteLinks.map((link: Row) => String(link.from_id));
    return { ...taskOut(row), noteIds, noteCount: noteIds.length };
  }

  // T-MEMORY-065: task.add_note/remark items exist solely to describe this
  // task -- deleteLinksForRecord alone only ever removed the *link*, never
  // the note/remark item itself, leaving it orphaned in `items` (still
  // tagged "task-note"/"remark", now pointing at nothing). "Owned" is
  // narrowed to *exclusively* linked (see OWNED_TASK_NOTE_RELATIONS above
  // the mixin factory): an item that also has some other link (e.g. a note
  // that got cross-referenced elsewhere) is left alone -- only its link to
  // this task is removed, same as any other shared entity. Matches
  // T-MEMORY-065 acceptance criteria 2 vs 3.
  protected async deleteOwnedTaskNotes(taskId: string, context: NormalizedGatewayRequestContext): Promise<string[]> {
    const incoming = await this.db("links").where({ to_id: taskId });
    const candidateIds = new Set<string>();
    for (const link of incoming) {
      const relation = String(link.relation);
      if (OWNED_TASK_NOTE_RELATIONS.has(relation)) {
        candidateIds.add(String(link.from_id));
        continue;
      }
      const item = await this.db("items").where({ id: link.from_id }).first();
      if (item && jsonStringArray(item.tags).includes("task-note")) {
        candidateIds.add(String(link.from_id));
      }
    }

    const deletedIds: string[] = [];
    for (const itemId of candidateIds) {
      // whereNot(object) chains NOT per-key (NOT from_id=x AND NOT to_id=y),
      // not a grouped NOT(x AND y) -- that would incorrectly exclude the
      // item's *only* other link too whenever its to_id happened to equal
      // taskId for some unrelated reason. A builder callback groups it
      // properly: NOT (from_id = itemId AND to_id = taskId).
      const otherLinks = await this.db("links")
        .where((builder) => builder.where("from_id", itemId).orWhere("to_id", itemId))
        .whereNot((builder) => builder.where("from_id", itemId).andWhere("to_id", taskId))
        .first();
      if (otherLinks) {
        continue;
      }
      await this.deleteMemory({ id: itemId, reason: "Parent task deleted." }, context);
      deletedIds.push(itemId);
    }
    return deletedIds;
  }

  protected async deleteTask(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    const deletedNoteIds = await this.deleteOwnedTaskNotes(id, context);
    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      deletedLinks = await this.deleteLinksForRecord(id, trx);
      await trx("tasks").where({ id }).del();
    });
    const event = await this.recordEventForProject(String(current.project_id), {
      type: "task.deleted",
      title: `Task deleted: ${String(current.title)}`,
      body: stringOrNull(input.reason),
      related_id: id
    }, context);
    return {
      deletedTask: taskOut(current),
      deletedLinks,
      deletedNoteIds,
      event
    };
  }

  protected async nextTask(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    const row = await this.taskSelectWithActiveClaimCount(this.db("tasks"))
      .where({ project_id: project.id, status: "todo" })
      .orderBy("priority")
      .orderBy("created_at")
      .first();
    return row ? taskOut(row) : null;
  }

  protected async updateTaskStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    if (String(input.status) === "done") {
      const completed = await this.completeTask(
        {
          id,
          acceptanceEvidence: stringOrNull(input.note) ?? undefined,
          force: input.force,
          reason: input.reason
        },
        context
      );
      return { task: completed.task, ...(completed.warning ? { warning: completed.warning } : {}) };
    }
    const note = stringOrNull(input.note);
    const notes = note ? (current.notes ? `${current.notes}\n\n${note}` : note) : current.notes;
    const newStatus = String(input.status);
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        status: newStatus,
        notes,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(row.project_id, {
      type: eventTypeForStatus(newStatus),
      title: `Task status changed: ${row.title}`,
      body: note,
      related_id: row.id,
      target_user_ids: lifecycleNotifyTargets(row.created_by, stringOrNull(row.assignee_user_id), context)
    }, context);

    // D-MEMORY-037 / T-MEMORY-070: penalties, not gated behind a session --
    // a reopen/cancel is a fact about the task regardless of who's calling
    // right now. task_reopened_penalty reverses the exact task_completed
    // award for THIS task (the specific person who was credited for
    // finishing it, not whoever is reopening it now); task_cancelled_penalty
    // has no prior award to reverse, so it targets whoever was actually
    // doing the work (active claim's client_id, falling back to
    // created_by), same "user:<id>" resolution as the T-MEMORY-081 overdue
    // ticker will use. Never blocks the status change itself.
    let creditWarning: string | undefined;
    try {
      if (String(current.status) === "done" && (newStatus === "todo" || newStatus === "doing")) {
        await this.applyTaskReopenedPenalty(id, stringOrNull(row.project_id));
      } else if (String(current.status) === "doing" && newStatus === "cancelled") {
        await this.applyTaskCancelledPenalty(row);
      }
    } catch (error) {
      creditWarning = `Task status changed, but the credit penalty failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    return { task: taskOut(row), ...(creditWarning ? { warning: creditWarning } : {}) };
  }

  protected async applyTaskReopenedPenalty(taskId: string, projectId: string | null): Promise<void> {
    const lastAward = await this.db("credit_transactions")
      .where({ related_type: "task", related_id: taskId, reason: "task_completed" })
      .orderBy("created_at", "desc")
      .first();
    if (!lastAward) {
      return;
    }
    await createCreditsFacade(this.db).award(this.db, {
      userId: String(lastAward.user_id),
      amount: -Math.abs(Number(lastAward.amount)),
      reason: "task_reopened_penalty",
      projectId,
      relatedType: "task",
      relatedId: taskId
    });
  }

  protected async applyTaskCancelledPenalty(task: Row): Promise<void> {
    const activeClaim = await this.db("task_claims")
      .where({ task_id: task.id })
      .orderBy("updated_at", "desc")
      .first();
    const userId = userIdFromClientId(activeClaim?.client_id) ?? userIdFromClientId(task.created_by);
    if (!userId) {
      return;
    }
    await createCreditsFacade(this.db).award(this.db, {
      userId,
      amount: -TASK_CANCELLED_PENALTY,
      reason: "task_cancelled_penalty",
      projectId: stringOrNull(task.project_id),
      relatedType: "task",
      relatedId: String(task.id)
    });
  }

  // T-context (2026-08-11): task.create/milestone was write-once -- no way
  // to group an already-created task under a work process after the fact,
  // or fix a wrong one. Mirrors updateTaskStatus's shape minus the
  // status-specific "done" special case; not a lifecycle transition, so no
  // recordEventForProject call.
  protected async updateTaskMilestone(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        milestone: stringOrNull(input.milestone),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    return taskOut(row);
  }

  // T-MEMORY-090: mirrors updateTaskMilestone's shape -- `assignee` is
  // required-but-nullable (unlike task.create's optional `assignee`,
  // there's no "unset" default to fall back on here; the caller must say
  // either a member or null).
  protected async updateTaskAssignee(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    const assigneeUserId = await createAssigneesFacade(this.db).resolveAssigneeUserId(
      String(current.project_id),
      input.assignee as string | null,
      undefined
    );
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        assignee_user_id: assigneeUserId,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const reassignNotifyTarget = assigneeNotifyTarget(assigneeUserId, context);
    if (assigneeDiffersFromOwner(assigneeUserId, row.created_by)) {
      await this.recordEventForProject(String(row.project_id), {
        type: "task.assigned",
        title: `Task assigned: ${String(row.title)}`,
        related_id: id,
        target_user_ids: reassignNotifyTarget ? [reassignNotifyTarget] : []
      }, context);
    }
    return taskOut(row);
  }

  protected async claimTask(input: Row, context: NormalizedGatewayRequestContext) {
    const taskId = String(input.taskId);
    const task = await this.taskRow(taskId, context);
    if (["done", "cancelled"].includes(String(task.status))) {
      throw new AppError("VALIDATION_ERROR", `Task ${taskId} cannot be claimed because it is ${String(task.status)}.`, {
        taskId,
        status: task.status
      });
    }

    await this.expireTaskClaims(taskId);
    const now = nowIso();
    const leaseExpiresAt = taskClaimLeaseExpiresAt(input.leaseSeconds);
    const row = {
      id: await this.nextId("task_claims", `TC-${projectKeyFromId(String(task.project_id))}`),
      task_id: taskId,
      project_id: String(task.project_id),
      client_id: context.clientId,
      client_label: context.clientLabel,
      client_kind: typeof context.metadata.kind === "string" ? context.metadata.kind : null,
      role: taskClaimRole(input.role),
      scope: stringOrNull(input.scope),
      status: "active",
      lease_expires_at: leaseExpiresAt,
      heartbeat_at: now,
      note: stringOrNull(input.note),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };

    await this.db.transaction(async (trx) => {
      await trx("task_claims").insert(row);
      if (String(task.status) === "todo") {
        await trx("tasks").where({ id: taskId }).update({
          status: "doing",
          updated_by: context.clientId,
          source_instance_id: context.clientId,
          updated_at: now,
          version: Number(task.version ?? 1) + 1
        });
      }
    });

    const event = await this.recordEventForProject(String(task.project_id), {
      type: "task.claimed",
      title: `Task claimed: ${String(task.title)}`,
      body: taskClaimEventBody(row),
      related_id: taskId
    }, context);
    return {
      claim: taskClaimOut(row),
      task: await this.getTask(taskId, context),
      event
    };
  }

  protected async heartbeatTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    const claim = await this.activeTaskClaim(String(input.claimId), context);
    const now = nowIso();
    const [row] = await this.db("task_claims")
      .where({ id: claim.id })
      .update({
        lease_expires_at: taskClaimLeaseExpiresAt(input.leaseSeconds),
        heartbeat_at: now,
        note: appendText(stringOrNull(claim.note), stringOrNull(input.note)),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(claim.version ?? 1) + 1
      })
      .returning("*");
    return taskClaimOut(row);
  }

  protected async completeTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    return this.finishTaskClaim(input, "completed", "task.claim_completed", "Task claim completed", context);
  }

  protected async releaseTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    return this.finishTaskClaim(input, "released", "task.claim_released", "Task claim released", context);
  }

  protected async finishTaskClaim(
    input: Row,
    status: "completed" | "released",
    eventType: string,
    eventTitle: string,
    context: NormalizedGatewayRequestContext
  ) {
    const claim = await this.activeTaskClaim(String(input.claimId), context);
    const now = nowIso();
    const [row] = await this.db("task_claims")
      .where({ id: claim.id })
      .update({
        status,
        note: appendText(stringOrNull(claim.note), stringOrNull(input.note)),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(claim.version ?? 1) + 1
      })
      .returning("*");
    const task = await this.getTask(String(row.task_id), context);
    const event = await this.recordEventForProject(String(row.project_id), {
      type: eventType,
      title: `${eventTitle}: ${String(row.id)}`,
      body: taskClaimEventBody(row),
      related_id: String(row.task_id)
    }, context);
    return {
      claim: taskClaimOut(row),
      task,
      event
    };
  }

  protected async listTaskClaims(input: Row, context?: NormalizedGatewayRequestContext) {
    const taskId = String(input.taskId);
    await this.assertTaskExists(taskId, context);
    await this.expireTaskClaims(taskId);
    let query = this.db("task_claims").select("*").where({ task_id: taskId });
    if (input.includeInactive !== true) {
      query = query.andWhere({ status: "active" }).andWhere("lease_expires_at", ">", nowIso());
    }
    const rows = await query
      .orderByRaw("case status when 'active' then 0 when 'completed' then 1 when 'released' then 2 when 'expired' then 3 else 4 end")
      .orderBy("updated_at", "desc");
    return rows.map(taskClaimOut);
  }

  protected async completeTask(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.taskRow(id, context);
    let completedClaim: Row | null = null;

    if (input.claimId) {
      completedClaim = (await this.completeTaskClaim({ claimId: input.claimId, note: input.acceptanceEvidence }, context)).claim;
    }

    await this.expireTaskClaims(id);
    const activeClaims = await this.activeTaskClaims(id);
    const force = input.force === true;
    if (activeClaims.length > 0 && !force) {
      throw new AppError(
        "TASK_HAS_ACTIVE_CLAIMS",
        `Task ${id} still has ${activeClaims.length} active claim(s). Complete/release claims first, or use force=true with a reason.`,
        { taskId: id, activeClaims: activeClaims.map(taskClaimOut) }
      );
    }
    const reason = stringOrNull(input.reason);
    const evidence = stringOrNull(input.acceptanceEvidence);
    if (activeClaims.length > 0 && force && !reason && !evidence) {
      throw new AppError("VALIDATION_ERROR", "Forced task completion requires reason or acceptanceEvidence.", { taskId: id });
    }

    const now = nowIso();
    let cancelledClaims = 0;
    if (activeClaims.length > 0 && force) {
      cancelledClaims = Number(
        await this.db("task_claims")
          .where({ task_id: id, status: "active" })
          .andWhere("lease_expires_at", ">", now)
          .update({
            status: "cancelled",
            note: appendText(null, `Cancelled by forced task completion.${reason ? ` Reason: ${reason}` : ""}`),
            updated_by: context.clientId,
            source_instance_id: context.clientId,
            updated_at: now
          })
      );
    }

    const note = [evidence ? `Acceptance evidence: ${evidence}` : null, reason ? `Completion reason: ${reason}` : null]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        status: "done",
        notes: appendText(stringOrNull(current.notes), note || null),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: now,
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    const event = await this.recordEventForProject(String(row.project_id), {
      type: "task.completed",
      title: `Task completed: ${String(row.title)}`,
      body: [
        evidence,
        reason,
        cancelledClaims > 0 ? `Cancelled active claims: ${cancelledClaims}` : null
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n"),
      related_id: id,
      target_user_ids: lifecycleNotifyTargets(row.created_by, stringOrNull(row.assignee_user_id), context)
    }, context);

    // I-MEMORY-065: a task can go straight from created to completed with no
    // claim, no acceptance evidence, and no reason -- gateway history alone
    // then can't establish that anything was actually done. Not blocked
    // (plenty of trivial/manual completions are legitimate), just surfaced
    // so the caller notices at the moment it happens instead of a reviewer
    // discovering it much later with no trail left to follow.
    let warning: string | undefined;
    if (!completedClaim && !evidence && !reason) {
      const everClaimed = await this.db("task_claims").where({ task_id: id }).first();
      if (!everClaimed) {
        warning = `Task ${id} was completed without ever being claimed and without acceptanceEvidence or reason -- there is no record of what was actually done.`;
      }
    }

    // D-MEMORY-037 / T-MEMORY-069: credits the completing human, if any --
    // context.sessionUserId is unset for a bare static-token/anonymous
    // caller (no one to credit), which is a normal, unremarkable case, not
    // an error. A credits-subsystem failure is surfaced as a warning rather
    // than blocking task completion itself, same reasoning as the
    // never-claimed warning above: the task's own completion is the primary
    // outcome and must not fail because of an additive side effect.
    let creditWarning: string | undefined;
    if (context.sessionUserId) {
      try {
        await createCreditsFacade(this.db).awardTaskCompletion(this.db, context.sessionUserId, {
          projectId: stringOrNull(row.project_id),
          taskId: id
        });
      } catch (error) {
        creditWarning = `Task completed, but the credit award failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const combinedWarning = [warning, creditWarning].filter((value): value is string => Boolean(value)).join(" ");

    return {
      task: await this.getTask(id, context),
      ...(combinedWarning ? { warning: combinedWarning } : {}),
      completedClaim,
      event
    };
  }

  protected async addTaskNote(input: Row, context: NormalizedGatewayRequestContext) {
    const task = await this.getTask(String(input.taskId), context);
    const type = typeof input.type === "string" ? input.type : "coordination_note";
    const item = await this.createMemory({
      project: task.projectId,
      type,
      title: stringOrNull(input.title) ?? `${taskNoteTypeTitle(type)}: ${task.title}`,
      body: String(input.body),
      tags: ["task-note", type, ...stringArray(input.tags)]
    }, context);
    const link = await this.createLink({
      project: task.projectId,
      fromId: item.id,
      toId: task.id,
      relation: stringOrNull(input.relation) ?? taskNoteDefaultRelation(type)
    }, context);
    const event = await this.recordEventForProject(task.projectId, {
      type: "task.note_added",
      title: `Task note added: ${task.title}`,
      body: `${item.id} ${link.relation} ${task.id}`,
      related_id: item.id
    }, context);
    return { item, link, event };
  }

  protected async assertTaskExists(id: string, context?: NormalizedGatewayRequestContext): Promise<void> {
    await this.taskRow(id, context);
  }

  // T-MEMORY-057 (IDOR): shared low-level fetch behind task.claim/complete
  // and (via assertTaskExists) task.claims -- task/claim ids are
  // sequential/predictable, same as every other record kind.
  protected async taskRow(id: string, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const row = await this.db("tasks").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(row.project_id), context);
    return row;
  }

  protected async taskClaimRow(id: string, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const row = await this.db("task_claims").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_CLAIM_NOT_FOUND", `Task claim ${id} does not exist.`, { id });
    }
    if (row.project_id) {
      await this.assertProjectMember(String(row.project_id), context);
    }
    return row;
  }

  protected async activeTaskClaim(id: string, context?: NormalizedGatewayRequestContext): Promise<Row> {
    const row = await this.taskClaimRow(id, context);
    await this.expireTaskClaims(String(row.task_id));
    const current = await this.taskClaimRow(id, context);
    if (String(current.status) !== "active" || new Date(String(current.lease_expires_at)).getTime() <= Date.now()) {
      throw new AppError("TASK_CLAIM_NOT_ACTIVE", `Task claim ${id} is not active.`, {
        id,
        status: taskClaimEffectiveStatus(current)
      });
    }
    return current;
  }

  protected async activeTaskClaims(taskId: string): Promise<Row[]> {
    return await this.db("task_claims")
      .select("*")
      .where({ task_id: taskId, status: "active" })
      .andWhere("lease_expires_at", ">", nowIso())
      .orderBy("updated_at", "desc");
  }

  protected async expireTaskClaims(taskId?: string): Promise<number> {
    const query = this.db("task_claims")
      .where({ status: "active" })
      .andWhere("lease_expires_at", "<=", nowIso());
    if (taskId) {
      query.andWhere({ task_id: taskId });
    }
    return Number(
      await query.update({
        status: "expired",
        updated_at: nowIso()
      })
    );
  }

  };
}
