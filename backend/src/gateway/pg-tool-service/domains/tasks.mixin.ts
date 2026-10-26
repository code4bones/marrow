import type { Knex } from "knex";
import { enqueueTelegramTaskFeedback } from "../../telegram-project-bots/feedback.js";
import { getTaskAssigneeIds, resolveTaskAssignees, setTaskAssignees } from "../../task-assignees.js";
import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
import { assigneeDiffersFromOwner, assigneeNotifyTarget, createAssigneesFacade, lifecycleNotifyTargets } from "../../assignees.js";
import { createCreditsFacade, userIdFromClientId } from "../../credits.js";
import { enqueueTellyTaskOffer, tellyInboxEnabled } from "../../telly-inbox.js";
import { enqueueIssueExport, exportStatus } from "../../gitlab-webhooks/exports.js";
import { combinedRankSql, jsonStringArray, prefixRankSql, prefixWhereSql, shortText, stringArray, stringOrNull, toPrefixTsQueryText, writeActorFields } from "../formatters/common.js";
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
  taskSearchOut,
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
    await this.assertTaskPermission(project.id, "create", context);
    await this.db("projects").where({ id: project.id }).forUpdate().first();
    const assigneeUserIds = await resolveTaskAssignees(this.db, project.id, input, context.clientId);
    const assigneeUserId = assigneeUserIds[0] ?? null;
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
      project_version: stringOrNull(input.projectVersion),
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };
    await this.db("tasks").insert(row);
    await setTaskAssignees(this.db, row.id, assigneeUserIds);
    // T-context (owner's ask, 2026-08-22): the Kanban board is now a
    // multiplayer surface (see the pm/developer/tester role system) --
    // someone other than the owner creating a task with no explicit
    // assignee (it silently self-assigns, see resolveAssigneeUserId's
    // undefined-input fallback above) previously notified nobody, since
    // assigneeDiffersFromOwner below is false in that case. Only fires when
    // the caller left assignee untouched -- an explicit assignee (to anyone,
    // including themselves) is already covered by the task.assigned branch
    // below and shouldn't double-notify the owner too.
    //
    // T-context (owner's ask, 2026-08-27, atlas-arrow-fix): this used to be
    // a plain creator-vs-owner id comparison, deliberately not
    // assigneeNotifyTarget's isInteractiveSelfAction nuance -- reasoned as
    // "an agent acting as the owner still shouldn't notify the owner about
    // their own task." In practice that made a solo project (owner is also
    // the only creator, work agent-driven) never notify Telegram at all,
    // while the web Notifications feed showed the same events. Now uses
    // assigneeNotifyTarget so only a real interactive browser click by the
    // owner is treated as "they just watched this happen."
    const ownerCreateNotifyTarget = input.assignee === undefined && input.assignees === undefined
      ? assigneeNotifyTarget(project.ownerUserId, context)
      : undefined;
    await this.recordEventForProject(project.id, {
      type: "task.created",
      title: `Task created: ${row.title}`,
      related_id: row.id,
      target_user_ids: ownerCreateNotifyTarget ? [ownerCreateNotifyTarget] : [],
      record_title: row.title
    }, context);
    await this.notifyNewTaskAssignees(row, project, assigneeUserIds, [], context);
    await this.enqueueTaskGitlabExport(row, context);
    return this.formatTask(row);
  }

  // T-context (owner's ask, 2026-08-23): "me" resolves to whoever this
  // connection is actually authenticated as (context.sessionUserId) --
  // works identically whether that's a browser session, a personal token,
  // or an OAuth-connected agent (Claude/ChatGPT/Codex) acting on a real
  // person's behalf. Anything else is resolved the same way task.create's
  // own assignee field already resolves a member (email, username
  // fragment, or raw id).
  protected async resolveAssigneeFilter(projectId: string, assignee: string, context?: NormalizedGatewayRequestContext): Promise<string> {
    if (assignee.trim().toLowerCase() === "me") {
      const me = context?.sessionUserId;
      if (!me) {
        throw new AppError(
          "VALIDATION_ERROR",
          "assignee=\"me\" requires a real signed-in caller (a session, personal token, or OAuth-connected identity) -- an anonymous or static-token connection has no \"me\" to resolve.",
          { assignee }
        );
      }
      return me;
    }
    // resolveAssigneeUserId only ever returns null when its `input` param is
    // literally null -- unreachable here since `assignee` is always a
    // non-null string by this point (guaranteed by the input.assignee
    // truthiness check at both call sites).
    const resolved = await createAssigneesFacade(this.db).resolveAssigneeUserId(projectId, assignee, undefined);
    if (!resolved) {
      throw new AppError("NOT_FOUND", `No project member matches assignee "${assignee}".`, { assignee });
    }
    return resolved;
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
    if (input.assignee) {
      const assigneeUserId = await this.resolveAssigneeFilter(project.id, String(input.assignee), context);
      query = query.andWhere((q) => q.where("assignee_user_id", assigneeUserId).orWhereIn("id", this.db("task_assignees").select("task_id").where({ user_id: assigneeUserId })));
    }
    if (input.claimedByAgent) {
      // Sweep expired claims first -- otherwise a stale active row (past
      // its lease) would still match here even though task.claims'
      // taskClaimEffectiveStatus would already report it as "expired".
      await this.expireTaskClaims();
      query = query.whereIn(
        "id",
        this.db("task_claims").select("task_id").where({ status: "active", agent_name: String(input.claimedByAgent) })
      );
    }
    const tasks = await this.formatTasks(await query.orderBy("priority").orderBy("created_at").limit(Number(input.limit ?? 20)));
    return input.compact === true ? tasks.map(compactTask) : tasks;
  }

  // T-context (2026-08-25, global quick-search): tasks had no free-text
  // search before migration 079 added search_vector. Mirrors searchArtifacts'
  // shape (queryText optional -- falsy skips the FTS filter and ranks by
  // recency instead, same as every other search* method in this codebase).
  protected async searchTasks(input: Row, context?: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
    let query = this.db("tasks").select("*").where("project_id", project.id);
    const queryText = typeof input.query === "string" ? input.query : null;
    let hasFilter = false;
    if (queryText && input.prefix === true) {
      const prefixQuery = toPrefixTsQueryText(queryText);
      if (prefixQuery) {
        hasFilter = true;
        query = query
          .select(this.db.raw(`${prefixRankSql("tasks")} as rank`, [prefixQuery, prefixQuery, prefixQuery]))
          // T-context (2026-08-25, live-caught): searching "070" for
          // T-MEMORY-070 found nothing -- FTS only ever looked at content
          // columns (title/scope/...), never the record's own visible id.
          // OR in a plain substring match against id alongside the FTS
          // match so typing part of an id (with or without its T-/D-/I-/A-
          // prefix or project key) jumps straight to it too.
          .where((builder) => builder.whereRaw(prefixWhereSql(), [prefixQuery, prefixQuery, prefixQuery]).orWhereRaw("id ilike ?", [`%${queryText}%`]));
      }
    } else if (queryText) {
      hasFilter = true;
      query = query
        .select(this.db.raw(`${combinedRankSql("tasks")} as rank`, [queryText, queryText, queryText]))
        .whereRaw("search_vector @@ (plainto_tsquery('simple', ?) || plainto_tsquery('english', ?) || plainto_tsquery('russian', ?))", [queryText, queryText, queryText]);
    }
    const rows = await query
      .orderBy(hasFilter ? "rank" : "updated_at", "desc")
      .limit(Number(input.limit ?? 10));
    return rows.map(taskSearchOut);
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
    if (input.assignee) {
      const assigneeUserId = await this.resolveAssigneeFilter(project.id, String(input.assignee), context);
      base.andWhere((q) => q.where("assignee_user_id", assigneeUserId).orWhereIn("id", this.db("task_assignees").select("task_id").where({ user_id: assigneeUserId })));
    }
    // T-MEMORY-051 follow-up: server-driven sort (default updated_at desc).
    // Trailing `id` tiebreaker keeps offset pagination stable when many rows
    // share the same sort-column value.
    const sortColumn = taskSortColumn(input.sortField);
    const sortDirection = taskSortDirection(input.sortDirection);
    const page = await this.pageRows(base, input,
      (query) => this.taskSelectWithActiveClaimCount(query).orderBy(sortColumn, sortDirection).orderBy("id"), (row) => row);
    return { ...page, items: await this.formatTasks(page.items) };
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
    const source = await this.db("telegram_task_sources").where({ task_id: id, project_id: row.project_id }).first();
    const artifactLinks = await this.db("links").where({ to_id: id, relation: "attached_to" }).where("from_id", "like", "A-%").select("from_id");
    const attachments = source ? await this.db("telegram_message_files").where({ task_id: id }).select("id", "file_name", "status", "artifact_id", "last_error") : [];
    return { ...await this.formatTask(row), noteIds, noteCount: noteIds.length, artifactIds: [...new Set(artifactLinks.map((l) => String(l.from_id)))], gitlab: await exportStatus(this.db, id),
      ...(source ? { telegram: { attachments: attachments.map((a) => ({ id: a.id, name: a.file_name, status: a.status, artifactId: a.artifact_id, error: a.last_error })), chatId: String(source.chat_id), messageId: String(source.message_id),
        workflow: "Keep ONE shared task. Telegram files are imported asynchronously as linked artifacts; if attachments are pending, re-read task.get before assuming no file exists. For a completed stage use task.handoff with next assignees, completed-work note and expectedVersion from task.get; complete/release active claims first. For questions use task.update_status(status: clar, note: question). Use DONE only when the entire task is finished. These actions reply to the original Telegram message; do not send a second manual reply." } } : {}) };

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
    await this.assertProjectMember(String(current.project_id), context);
    await this.assertTaskPermission(String(current.project_id), "delete", context);
    const deletedTask = await this.formatTask(current);
    const deletedNoteIds = await this.deleteOwnedTaskNotes(id, context);
    let deletedLinks = 0;
    await this.db.transaction(async (trx) => {
      await trx("projects").where({ id: current.project_id }).forUpdate().first();
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
      deletedTask,
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
    return row ? this.formatTask(row) : null;
  }

  protected async updateTaskStatus(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const initial = await this.taskRow(id, context);
    await this.db("projects").where({ id: initial.project_id }).forUpdate().first();
    const current = await this.db("tasks").where({ id }).forUpdate().first();
    if (!current) throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    const newStatusValue = String(input.status);
    if (newStatusValue === "done") {
      // completeTask itself asserts the "complete" permission (also the
      // entry point when task.complete is called directly, not just via
      // this status='done' path) -- no need to duplicate the check here.
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
    if (newStatusValue === "clar") {
      await this.assertTaskPermission(String(current.project_id), "clarify", context);
      const question = stringOrNull(input.note)?.trim();
      if (!question) throw new AppError("VALIDATION_ERROR", "A clarification question is required.");
      const previous = current.status === "clar" ? await this.db("events").where({ related_id: id, type: "task.clarification_requested" }).orderBy("created_at", "desc").orderBy("id", "desc").first() : null;
      if (previous?.body === question) return { task: await this.formatTask(current) };
      const [row] = await this.db("tasks").where({ id }).update({ status: "clar", notes: appendText(stringOrNull(current.notes), `Clarification requested: ${question}`),
        updated_by: context.clientId, source_instance_id: context.clientId, updated_at: nowIso(), version: Number(current.version ?? 1) + 1 }).returning("*");
      const source = await this.db("telegram_task_sources").where({ task_id: id, project_id: row.project_id }).whereNotNull("bot_id").first();
      const ids = await getTaskAssigneeIds(this.db, row);
      const event = await this.recordEventForProject(String(row.project_id), {
        type: "task.clarification_requested", title: `Clarification requested: ${row.title}`, body: question, related_id: id,
        target_user_ids: source ? [] : lifecycleNotifyTargets(row.created_by, ids, context), record_title: row.title
      }, context);
      await enqueueTelegramTaskFeedback(this.db, row, String(event.id), "clar", question, [], await this.assignmentActorUserId(context));
      return { task: await this.formatTask(row) };
    }
    // T-MEMORY-115: a reviewer's reject decision, not a plain move -- gated
    // separately (review_decide: pm/tester) from every other status change
    // (move: pm/developer). The note is mandatory here specifically because
    // it becomes the new follow-up task's scope -- an empty one would leave
    // that task saying nothing about what actually needs fixing.
    if (newStatusValue === "changes_requested") {
      await this.assertTaskPermission(String(current.project_id), "review_decide", context);
      const reviewNote = stringOrNull(input.note);
      if (!reviewNote) {
        throw new AppError("VALIDATION_ERROR", "Requesting changes requires a note explaining what needs to change.", { id });
      }
      const [row] = await this.db("tasks")
        .where({ id })
        .update({
          status: newStatusValue,
          notes: appendText(stringOrNull(current.notes), reviewNote),
          updated_by: context.clientId,
          source_instance_id: context.clientId,
          updated_at: nowIso(),
          version: Number(current.version ?? 1) + 1
        })
        .returning("*");
      const followUpTask = await this.createFollowUpTask(row, reviewNote, context);
      await this.recordEventForProject(row.project_id, {
        type: "task.changes_requested",
        title: `Changes requested: ${row.title}`,
        body: reviewNote,
        related_id: row.id,
        target_user_ids: lifecycleNotifyTargets(row.created_by, await getTaskAssigneeIds(this.db, row), context),
        record_title: row.title
      }, context);
      return { task: await this.formatTask(row), followUpTask };
    }
    await this.assertTaskPermission(String(current.project_id), "move", context);
    const note = stringOrNull(input.note);
    const notes = note ? (current.notes ? `${current.notes}\n\n${note}` : note) : current.notes;
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        status: newStatusValue,
        notes,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(row.project_id, {
      type: eventTypeForStatus(newStatusValue),
      title: `Task status changed: ${row.title}`,
      body: note,
      related_id: row.id,
      target_user_ids: lifecycleNotifyTargets(row.created_by, await getTaskAssigneeIds(this.db, row), context),
      record_title: row.title
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
      if (String(current.status) === "done" && (newStatusValue === "todo" || newStatusValue === "doing")) {
        await this.db.transaction((trx) => this.applyTaskReopenedPenalty(id, stringOrNull(row.project_id), trx));
      } else if (String(current.status) === "doing" && newStatusValue === "cancelled") {
        await this.db.transaction((trx) => this.applyTaskCancelledPenalty(row, trx));
      }
    } catch (error) {
      creditWarning = `Task status changed, but the credit penalty failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    return { task: await this.formatTask(row), ...(creditWarning ? { warning: creditWarning } : {}) };
  }

  // T-MEMORY-115: spawned by updateTaskStatus's changes_requested branch --
  // deliberately bypasses createTask's own "create" permission gate (pm and
  // developer only) since a Tester has review_decide but not "create", and
  // this task is a side effect of an already-authorized review decision,
  // not a fresh user-initiated create. Inherits the original's milestone
  // (same work-process grouping, so the Tasks list/Timeline/Kanban's
  // milestone view shows the whole chain together), priority, file scoping,
  // and assignee (the same person who did the flawed work is who should fix
  // it, by default -- reassignable afterward like any task). dependsOn
  // links back to the rejected task so the Dependency Flowchart shows the
  // relationship too.
  protected async createFollowUpTask(original: Row, reviewNote: string, context: NormalizedGatewayRequestContext): Promise<Row> {
    const now = nowIso();
    const row = {
      id: await this.nextId("tasks", `T-${projectKeyFromId(String(original.project_id))}`),
      project_id: original.project_id,
      title: `Fix: ${String(original.title)}`,
      status: "todo",
      milestone: original.milestone,
      priority: original.priority,
      scope: `Review of ${String(original.id)} requested changes:\n\n${reviewNote}`,
      acceptance: null,
      allowed_files: original.allowed_files,
      forbidden_files: original.forbidden_files,
      depends_on: jsonStringArray([String(original.id)]),
      notes: null,
      assignee_user_id: original.assignee_user_id,
      ...writeActorFields(context),
      created_at: now,
      updated_at: now
    };
    await this.db("tasks").insert(row);
    await setTaskAssignees(this.db, row.id, await getTaskAssigneeIds(this.db, original));
    await this.recordEventForProject(String(original.project_id), {
      type: "task.created",
      title: `Task created: ${row.title}`,
      related_id: row.id
    }, context);
    return this.formatTask(row);
  }

  protected async applyTaskReopenedPenalty(taskId: string, projectId: string | null, exec: Knex = this.db): Promise<void> {
    const lastAward = await exec("credit_transactions")
      .where({ related_type: "task", related_id: taskId, reason: "task_completed" })
      .orderBy("created_at", "desc")
      .first();
    if (!lastAward) {
      return;
    }
    await createCreditsFacade(exec).award(exec, {
      userId: String(lastAward.user_id),
      amount: -Math.abs(Number(lastAward.amount)),
      reason: "task_reopened_penalty",
      projectId,
      relatedType: "task",
      relatedId: taskId
    });
  }

  protected async applyTaskCancelledPenalty(task: Row, exec: Knex = this.db): Promise<void> {
    const activeClaim = await exec("task_claims")
      .where({ task_id: task.id })
      .orderBy("updated_at", "desc")
      .first();
    const userId = userIdFromClientId(activeClaim?.client_id) ?? userIdFromClientId(task.created_by);
    if (!userId) {
      return;
    }
    await createCreditsFacade(exec).award(exec, {
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
    return this.formatTask(row);
  }

  // T-MEMORY-105: mirrors updateTaskMilestone's shape -- a plain field edit,
  // not a lifecycle transition, so no recordEventForProject call. Backs the
  // Kanban board's inline title rename.
  protected async updateTaskTitle(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    await this.assertTaskPermission(String(current.project_id), "edit_details", context);
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        title: String(input.title),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    return this.formatTask(row);
  }

  // T-MEMORY-110: backs the full task-editing drawer -- whoever can create a
  // task (pm/developer, see task.create's own "create" gate) gets the same
  // reach to fully describe it afterward, not just rename it. priority is
  // the one field in this form that stays behind its own stricter gate
  // (reprioritize: pm only) -- checked only when priority is actually part
  // of this call, so a developer submitting the rest of the form with
  // priority left untouched never trips it.
  protected async updateTaskDetails(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    await this.assertTaskPermission(String(current.project_id), "edit_details", context);
    const patch: Row = {
      updated_by: context.clientId,
      source_instance_id: context.clientId,
      updated_at: nowIso(),
      version: Number(current.version ?? 1) + 1
    };
    if (input.title !== undefined) {
      patch.title = String(input.title);
    }
    if (input.milestone !== undefined) {
      patch.milestone = stringOrNull(input.milestone);
    }
    if (input.scope !== undefined) {
      patch.scope = stringOrNull(input.scope);
    }
    if (input.acceptance !== undefined) {
      patch.acceptance = stringOrNull(input.acceptance);
    }
    if (input.notes !== undefined) {
      patch.notes = stringOrNull(input.notes);
    }
    if (input.priority !== undefined) {
      await this.assertTaskPermission(String(current.project_id), "reprioritize", context);
      patch.priority = Number(input.priority);
    }
    const [row] = await this.db("tasks").where({ id }).update(patch).returning("*");
    return this.formatTask(row);
  }

  // T-MEMORY-105: same shape again. Backs the Kanban board's drag-to-reorder
  // within a column -- the board renumbers the affected column client-side
  // (10/20/30... spacing) and calls this once per task whose priority
  // actually changed, never introducing a new ordering column of its own.
  protected async updateTaskPriority(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    await this.assertTaskPermission(String(current.project_id), "reprioritize", context);
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        priority: Number(input.priority),
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    return this.formatTask(row);
  }

  // Replacement semantics: either a complete assignees list, or the legacy
  // single member/null field. Omission is rejected by the input schema.
  protected async updateTaskAssignee(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const initial = await this.taskRow(id, context);
    await this.db("projects").where({ id: initial.project_id }).forUpdate().first();
    const current = await this.db("tasks").where({ id }).forUpdate().first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    await this.assertProjectMember(String(current.project_id), context);
    await this.assertTaskPermission(String(current.project_id), "assign", context);
    const previous = await getTaskAssigneeIds(this.db, current);
    const assigneeUserIds = await resolveTaskAssignees(this.db, String(current.project_id), input);
    const assigneeUserId = assigneeUserIds[0] ?? null;
    await setTaskAssignees(this.db, id, assigneeUserIds);
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
    const project = await this.db("projects").where({ id: row.project_id }).first();
    if (project) await this.notifyNewTaskAssignees(row, project, assigneeUserIds, previous, context);
    const event = await this.recordEventForProject(String(row.project_id), {
      type: "task.assignees_updated", title: `Task assignees updated: ${row.title}`, related_id: id, target_user_ids: []
    }, context);
    if (previous.length !== assigneeUserIds.length || previous.some((id) => !assigneeUserIds.includes(id)))
      await enqueueTelegramTaskFeedback(this.db, row, String(event.id), "reassigned", null, previous);
    await this.enqueueTaskGitlabExport(row, context);
    return this.formatTask(row);
  }

  protected async handoffTask(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const initial = await this.taskRow(id, context);
    await this.db("projects").where({ id: initial.project_id }).forUpdate().first();
    const current = await this.db("tasks").where({ id }).forUpdate().first();
    if (!current) throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`);
    const source = await this.db("telegram_task_sources").where({ task_id: id, project_id: current.project_id }).first();
    if (!source) throw new AppError("VALIDATION_ERROR", "Stage handoff is available for Telegram-origin tasks.");
    const previous = await getTaskAssigneeIds(this.db, current);
    const actor = await this.assignmentActorUserId(context);
    const role = await this.resolveProjectRole(String(current.project_id), context);
    if (["done", "cancelled"].includes(String(current.status))) throw new AppError("VALIDATION_ERROR", "Reopen the task before handing off another stage.");
    const next = await resolveTaskAssignees(this.db, String(current.project_id), input);
    const note = String(input.note).trim();
    if (Number(current.version) !== Number(input.expectedVersion)) {
      const last = await this.db("events").where({ related_id: id, type: "task.handed_off" }).orderBy("created_at", "desc").orderBy("id", "desc").first();
      if (Number(current.version) === Number(input.expectedVersion) + 1 && last?.body === note && last.created_by === context.clientId && previous.length === next.length && previous.every((uid) => next.includes(uid)))
        return this.formatTask(current);
      throw new AppError("VALIDATION_ERROR", "Task changed; read task.get and retry with its current version.");
    }
    if (context.sessionRole === "member" && role !== "pm" && (!actor || !previous.includes(actor)))
      throw new AppError("UNAUTHORIZED", "Only a current performer or PM can hand off this task.");
    if (previous.length === next.length && previous.every((uid) => next.includes(uid)))
      throw new AppError("VALIDATION_ERROR", "Choose the next performer(s) for the handoff.");
    await this.expireTaskClaims(id);
    const claims = await this.activeTaskClaims(id);
    if (claims.length) throw new AppError("TASK_HAS_ACTIVE_CLAIMS", "Complete/release active claims before handing the task off.");
    await setTaskAssignees(this.db, id, next);
    const [row] = await this.db("tasks").where({ id }).update({ status: "todo", notes: appendText(stringOrNull(current.notes), `Stage completed and handed off: ${note}`),
      updated_by: context.clientId, source_instance_id: context.clientId, updated_at: nowIso(), version: Number(current.version) + 1 }).returning("*");
    const project = await this.db("projects").where({ id: row.project_id }).first();
    if (project) await this.notifyNewTaskAssignees(row, project, next, previous, context);
    const event = await this.recordEventForProject(String(row.project_id), {
      type: "task.handed_off", title: `Task stage handed off: ${row.title}`, body: note, related_id: id, target_user_ids: []
    }, context);
    await enqueueTelegramTaskFeedback(this.db, row, String(event.id), "handoff", note, previous.filter((uid) => !next.includes(uid)), actor);
    await this.enqueueTaskGitlabExport(row, context);
    return this.formatTask(row);
  }

  protected async notifyNewTaskAssignees(task: Row, project: Row, ids: string[], previous: string[], context: NormalizedGatewayRequestContext) {
    const actor = await this.assignmentActorUserId(context);
    for (const id of ids.filter((candidate) => !previous.includes(candidate))) {
      if (!assigneeDiffersFromOwner(id, task.created_by) && (!actor || actor === id)) continue;
      const target = assigneeNotifyTarget(id, context);
      const event = await this.recordEventForProject(String(task.project_id), {
        type: "task.assigned", title: `Task assigned: ${task.title}`, related_id: task.id,
        target_user_ids: target ? [target] : [], record_title: task.title
      }, context);
      await this.enqueueTellyTaskOfferIfEligible(event, project, task, id, context);
    }
  }

  protected async enqueueTaskGitlabExport(task: Row, context: NormalizedGatewayRequestContext) {
    if (context.metadata.source === "gitlab" || String(task.created_by).startsWith("integration:gitlab:")) return;
    const actor = await this.assignmentActorUserId(context);
    if (actor && (await getTaskAssigneeIds(this.db, task)).some((id) => actor !== id)) await enqueueIssueExport(this.db, task, actor);
  }

  protected async exportTaskGitlab(input: Row, context: NormalizedGatewayRequestContext) {
    const task = await this.taskRow(String(input.id), context);
    await this.assertTaskPermission(String(task.project_id), "assign", context);
    const actor = await this.assignmentActorUserId(context);
    if (!actor) throw new AppError("UNAUTHORIZED", "GitLab export requires an identified project member.");
    return enqueueIssueExport(this.db, task, actor, typeof input.repositoryId === "string" ? input.repositoryId : undefined);
  }

  protected async taskGitlabStatus(input: Row, context: NormalizedGatewayRequestContext) {
    await this.taskRow(String(input.id), context);
    return exportStatus(this.db, String(input.id));
  }

  // The actual delivery is intentionally outside the task mutation path: the
  // source-side durable outbox lets assignment succeed when TellyMCP is down.
  // Telly itself receives a complete snapshot and performs no outbound MCP
  // call in v1.
  protected async enqueueTellyTaskOfferIfEligible(
    event: Row,
    project: Row,
    task: Row,
    recipientUserId: string | null,
    context: NormalizedGatewayRequestContext
  ): Promise<void> {
    if (!recipientUserId || !tellyInboxEnabled()) {
      return;
    }
    const actorUserId = await this.assignmentActorUserId(context);
    if (!actorUserId || actorUserId === recipientUserId) {
      return;
    }
    const summarySource = [
      stringOrNull(task.scope),
      `Status: ${String(task.status)}; priority: ${Number(task.priority ?? 100)}.`,
      stringOrNull(task.milestone) ? `Milestone: ${String(task.milestone)}.` : null,
      stringOrNull(task.acceptance) ? `Acceptance: ${String(task.acceptance)}` : null,
      stringOrNull(task.notes)
    ].filter((part): part is string => Boolean(part)).join("\n");
    await enqueueTellyTaskOffer(this.db, {
      sourceEventId: String(event.id),
      projectId: String(project.id),
      projectSlug: String(project.slug),
      projectTitle: String(project.title),
      taskId: String(task.id),
      title: String(task.title),
      summary: summarySource ? shortText(summarySource, 600) : null,
      status: String(task.status),
      priority: Number(task.priority ?? 100),
      milestone: stringOrNull(task.milestone),
      acceptance: stringOrNull(task.acceptance),
      recipientUserId,
      actorUserId
    });
  }

  protected async assignmentActorUserId(context: NormalizedGatewayRequestContext): Promise<string | null> {
    const direct = context.sessionUserId ?? context.ownerUserId ?? userIdFromClientId(context.clientId);
    if (direct) {
      return direct;
    }
    const client = await this.db("gateway_clients").where({ id: context.clientId }).select("owner_user_id").first();
    return stringOrNull(client?.owner_user_id);
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
      // Self-declared agent-executor name (e.g. "backend"/"branch-pwa"),
      // distinct from assignee_user_id (a real project member you delegate
      // to) -- this is "who is actually working on it right now", tied to
      // the claim's own lease. Comes from the generic `agent` param every
      // tool schema now carries (service.ts's call()).
      agent_name: context.agentName,
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
    const initial = await this.taskRow(id, context);
    await this.assertTaskPermission(String(initial.project_id), "complete", context);
    await this.db("projects").where({ id: initial.project_id }).forUpdate().first();
    const current = await this.db("tasks").where({ id }).forUpdate().first();
    if (!current) throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
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
      target_user_ids: lifecycleNotifyTargets(row.created_by, await getTaskAssigneeIds(this.db, row), context),
      record_title: row.title
    }, context);

    if (current.status !== "done") await enqueueTelegramTaskFeedback(this.db, row, String(event.id), "done", evidence, [], await this.assignmentActorUserId(context));

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
        await this.db.transaction((trx) => createCreditsFacade(trx).awardTaskCompletion(trx, context.sessionUserId!, {
          projectId: stringOrNull(row.project_id), taskId: id
        }));
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
