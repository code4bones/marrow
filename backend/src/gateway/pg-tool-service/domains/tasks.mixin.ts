import { nowIso } from "../../../shared/dates.js";
import { AppError } from "../../../shared/errors.js";
import { projectKeyFromId } from "../../../shared/ids/id.service.js";
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

export function TasksMixin<TBase extends Constructor<MemoryInstance>>(Base: TBase) {
  return class extends Base {
  protected async createTask(input: Row, context: NormalizedGatewayRequestContext) {
    const project = await this.resolveProject(input.project, context);
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

  protected async getTask(id: string) {
    const row = await this.taskSelectWithActiveClaimCount(this.db("tasks")).where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    return taskOut(row);
  }

  protected async deleteTask(input: Row, context: NormalizedGatewayRequestContext) {
    const id = String(input.id);
    const current = await this.db("tasks").where({ id }).first();
    if (!current) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
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
    if (String(input.status) === "done") {
      return (await this.completeTask(
        {
          id,
          acceptanceEvidence: stringOrNull(input.note) ?? undefined,
          force: input.force,
          reason: input.reason
        },
        context
      )).task;
    }
    const note = stringOrNull(input.note);
    const notes = note ? (current.notes ? `${current.notes}\n\n${note}` : note) : current.notes;
    const [row] = await this.db("tasks")
      .where({ id })
      .update({
        status: String(input.status),
        notes,
        updated_by: context.clientId,
        source_instance_id: context.clientId,
        updated_at: nowIso(),
        version: Number(current.version ?? 1) + 1
      })
      .returning("*");
    await this.recordEventForProject(row.project_id, {
      type: eventTypeForStatus(String(input.status)),
      title: `Task status changed: ${row.title}`,
      body: note,
      related_id: row.id
    }, context);
    return taskOut(row);
  }

  protected async claimTask(input: Row, context: NormalizedGatewayRequestContext) {
    const taskId = String(input.taskId);
    const task = await this.taskRow(taskId);
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
      task: await this.getTask(taskId),
      event
    };
  }

  protected async heartbeatTaskClaim(input: Row, context: NormalizedGatewayRequestContext) {
    const claim = await this.activeTaskClaim(String(input.claimId));
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
    const claim = await this.activeTaskClaim(String(input.claimId));
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
    const task = await this.getTask(String(row.task_id));
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

  protected async listTaskClaims(input: Row) {
    const taskId = String(input.taskId);
    await this.assertTaskExists(taskId);
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
    const current = await this.taskRow(id);
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
      related_id: id
    }, context);
    return {
      task: await this.getTask(id),
      completedClaim,
      event
    };
  }

  protected async addTaskNote(input: Row, context: NormalizedGatewayRequestContext) {
    const task = await this.getTask(String(input.taskId));
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

  protected async assertTaskExists(id: string): Promise<void> {
    await this.taskRow(id);
  }

  protected async taskRow(id: string): Promise<Row> {
    const row = await this.db("tasks").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_NOT_FOUND", `Task ${id} does not exist.`, { id });
    }
    return row;
  }

  protected async taskClaimRow(id: string): Promise<Row> {
    const row = await this.db("task_claims").where({ id }).first();
    if (!row) {
      throw new AppError("TASK_CLAIM_NOT_FOUND", `Task claim ${id} does not exist.`, { id });
    }
    return row;
  }

  protected async activeTaskClaim(id: string): Promise<Row> {
    const row = await this.taskClaimRow(id);
    await this.expireTaskClaims(String(row.task_id));
    const current = await this.taskClaimRow(id);
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
