import { useMutation } from '@apollo/client/react';
import { PlusOutlined } from '@ant-design/icons';
import { Button, Card, Input, Tag, Typography, message } from 'antd';
import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DeleteTaskButton } from '../../features/task/DeleteTaskButton';
import { RequestChangesModal } from '../../features/task/RequestChangesModal';
import { TASK_STATUS_COLOR } from '../../features/task/taskStatusColor';
import { CREATE_TASK, UPDATE_TASK_PRIORITY, UPDATE_TASK_STATUS, UPDATE_TASK_TITLE } from '../../shared/api/queries';
import { getEntityType } from '../../shared/lib/entityId';
import { actionForStatus, canPerform } from '../../shared/lib/taskPermissions';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import type { ProjectMemberRole, Task } from '../../shared/model/types';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { RecordLink } from '../../shared/ui/RecordLink';

// T-MEMORY-115: review (submitted, awaiting a pm/tester decision) and
// changes_requested (rejected -- terminal for this card, a linked follow-up
// task carries the rework) sit between doing/blocked and done.
const COLUMN_STATUSES = ['todo', 'doing', 'blocked', 'review', 'changes_requested', 'done', 'cancelled'] as const;

// T-MEMORY-105: priority only ever governs task.next's pick order among
// open (todo) tasks -- reordering within Done/Cancelled has no operational
// meaning and those columns can be huge (dozens of historical cards), so
// drag-to-reorder (which renumbers the whole column) is scoped to the
// columns where it's both meaningful and cheap.
const REORDERABLE_STATUSES = new Set<string>(['todo', 'doing', 'blocked']);
const PRIORITY_STEP = 10;

interface MilestoneGroup {
  milestone: string | null;
  tasks: Task[];
}

// T-MEMORY-107: same milestone-grouping convention as MilestoneGroupedList
// (List tab) and DecisionTimeline's baseline grouping (Timeline tab) --
// alphabetical, "no milestone" bucket last -- so the same toggle reads the
// same way everywhere it appears. Priority-based sort/reorder logic stays
// flat underneath this; grouping is purely how cards are laid out inside a
// column, not a second axis task.next or the drag logic needs to know about.
function groupTasksByMilestone(list: Task[]): MilestoneGroup[] {
  const groups = new Map<string, Task[]>();
  const ungrouped: Task[] = [];
  for (const task of list) {
    if (task.milestone) {
      const bucket = groups.get(task.milestone) ?? [];
      bucket.push(task);
      groups.set(task.milestone, bucket);
    } else {
      ungrouped.push(task);
    }
  }
  const sorted: MilestoneGroup[] = Array.from(groups.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((milestone) => ({ milestone, tasks: groups.get(milestone) as Task[] }));
  if (ungrouped.length > 0) {
    sorted.push({ milestone: null, tasks: ungrouped });
  }
  return sorted;
}

interface TaskCardProps {
  task: Task;
  status: string;
  editing: boolean;
  draggedOver: boolean;
  editTitle: string;
  labelFor: (id: string | null | undefined) => string | null;
  canEdit: boolean;
  canDelete: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onOpen: () => void;
  onStartEdit: () => void;
  onEditChange: (value: string) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
  onDeleted: () => void;
}

function TaskCard({
  task, status, editing, draggedOver, editTitle, labelFor, canEdit, canDelete,
  onDragStart, onDragOver, onDragLeave, onDrop, onOpen, onStartEdit, onEditChange, onCommitEdit, onCancelEdit, onDeleted,
}: TaskCardProps) {
  return (
    <Card
      size="small"
      draggable={!editing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onOpen}
      style={{ cursor: 'grab', borderColor: draggedOver ? TASK_STATUS_COLOR[status] : undefined, position: 'relative' }}
      styles={{ body: { padding: 8 } }}
    >
      {canDelete && (
        <div
          style={{ position: 'absolute', top: 4, right: 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <DeleteTaskButton id={task.id} onDone={onDeleted} />
        </div>
      )}
      {editing ? (
        <Input
          size="small"
          autoFocus
          value={editTitle}
          onChange={(e) => onEditChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPressEnter={onCommitEdit}
          onBlur={onCommitEdit}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancelEdit(); }}
        />
      ) : (
        <Typography.Text
          style={{ fontSize: 13, cursor: canEdit ? 'text' : 'default', display: 'block', paddingRight: canDelete ? 22 : 0 }}
          onClick={(e) => { if (canEdit) { e.stopPropagation(); onStartEdit(); } }}
        >
          {task.title}
        </Typography.Text>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <RecordLink id={task.id} />
        {task.milestone && <Tag style={{ fontSize: 10 }}>{task.milestone}</Tag>}
        {task.assigneeDiffersFromOwner && task.assigneeUserId && (
          <Tag color="gold" style={{ fontSize: 10 }}>
            {'→'} {labelFor(`user:${task.assigneeUserId}`)}
          </Tag>
        )}
      </div>
    </Card>
  );
}

interface Props {
  tasks: Task[];
  projectSlug: string;
  /** Mirrors the Tasks page's own "Group by milestone" switch (List tab) so both views agree on the same grouping. */
  groupByMilestone: boolean;
  /** The viewer's own resolved role on this project -- gates create/edit/delete/move affordances. */
  role?: ProjectMemberRole | null;
  /** Called after a drag-drop status/priority change or a board-created task lands so the caller's own query refetches. */
  onChanged: () => void;
}

// Native HTML5 drag-and-drop -- no dnd library in this bundle yet, and a
// 5-column task board doesn't need one.
export function TaskKanbanBoard({ tasks, projectSlug, groupByMilestone, role, onChanged }: Props) {
  const { t } = useTranslation('tasks');
  const canCreate = canPerform(role, 'create');
  const canEdit = canPerform(role, 'edit_details');
  const canDelete = canPerform(role, 'delete');
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const { labelFor } = useActorLabels(tasks.map((task) => (task.assigneeUserId ? `user:${task.assigneeUserId}` : null)));
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const [addingStatus, setAddingStatus] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // T-MEMORY-115: moving a card into Changes Requested needs a mandatory
  // reason (it seeds the auto-created follow-up task's scope) -- holds the
  // task id awaiting that reason instead of firing the mutation immediately.
  const [pendingChangesRequestId, setPendingChangesRequestId] = useState<string | null>(null);

  const [mutateStatus] = useMutation(UPDATE_TASK_STATUS, {
    onError: (e) => message.error(e.message),
    onCompleted: onChanged,
  });
  const [mutateChangesRequested, { loading: requestingChanges }] = useMutation(UPDATE_TASK_STATUS, {
    onError: (e) => message.error(e.message),
    onCompleted: () => { message.success(t('followUpTaskCreated')); onChanged(); },
  });

  const moveTask = (id: string, status: string) => {
    // T-context: the action a target status requires only depends on that
    // target (done -> complete, changes_requested -> review_decide, else
    // move), same as the backend's own updateTaskStatus branching -- so a
    // single check here covers every call site (drag, quick-add-into-column).
    if (!canPerform(role, actionForStatus(status))) {
      message.error(t('actionNotAllowed'));
      return;
    }
    if (status === 'changes_requested') {
      setPendingChangesRequestId(id);
      return;
    }
    mutateStatus({ variables: { id, status } });
  };
  const [mutatePriority] = useMutation(UPDATE_TASK_PRIORITY, {
    onError: (e) => message.error(e.message),
  });
  const [mutateTitle] = useMutation(UPDATE_TASK_TITLE, {
    onError: (e) => message.error(e.message),
    onCompleted: onChanged,
  });
  const [createTask, { loading: creating }] = useMutation(CREATE_TASK, {
    onError: (e) => message.error(e.message),
  });

  const columnLabel: Record<(typeof COLUMN_STATUSES)[number], string> = {
    todo: t('statusTodo'),
    doing: t('statusDoing'),
    blocked: t('statusBlocked'),
    review: t('statusReview'),
    changes_requested: t('statusChangesRequested'),
    done: t('statusDone'),
    cancelled: t('statusCancelled'),
  };

  const byStatus = (status: string) =>
    tasks.filter((task) => task.status === status).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const openRecord = (id: string) => setSelectedRecord(id, getEntityType(id));

  const handleColumnDrop = (status: string, e: DragEvent) => {
    e.preventDefault();
    setDragOverStatus(null);
    const id = e.dataTransfer.getData('text/plain');
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task || task.status === status) {
      return;
    }
    moveTask(id, status);
  };

  // Dropping directly onto a card either moves it into that card's column
  // (same as dropping on the column body) or, if it's already in this
  // column, reorders it next to the target -- the whole column is
  // renumbered with a fresh 10/20/30... spacing so ties from historical
  // data (a lot of tasks share the default priority 100) never block a
  // reorder.
  const handleCardDrop = (status: string, targetTask: Task, e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverStatus(null);
    setDragOverTaskId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetTask.id) {
      return;
    }
    const draggedTask = tasks.find((candidate) => candidate.id === draggedId);
    if (!draggedTask) {
      return;
    }
    if (draggedTask.status !== status) {
      moveTask(draggedId, status);
      return;
    }
    if (!REORDERABLE_STATUSES.has(status)) {
      return;
    }
    // T-context: reordering within a column renumbers priority, gated the
    // same as any other priority change (pm-only) -- a Developer/Tester can
    // still drop a card back where it started, just can't reshuffle order.
    if (!canPerform(role, 'reprioritize')) {
      message.error(t('actionNotAllowed'));
      return;
    }
    const withoutDragged = byStatus(status).filter((candidate) => candidate.id !== draggedId);
    const targetIndex = withoutDragged.findIndex((candidate) => candidate.id === targetTask.id);
    withoutDragged.splice(targetIndex, 0, draggedTask);
    withoutDragged.forEach((candidate, index) => {
      const newPriority = (index + 1) * PRIORITY_STEP;
      if (candidate.priority !== newPriority) {
        mutatePriority({ variables: { id: candidate.id, priority: newPriority } });
      }
    });
    onChanged();
  };

  const startAdd = (status: string) => {
    setAddingStatus(status);
    setNewTitle('');
  };
  const submitAdd = async (status: string) => {
    const title = newTitle.trim();
    setAddingStatus(null);
    if (!title) {
      return;
    }
    try {
      const result = await createTask({ variables: { input: { project: projectSlug, title } } });
      const newId = (result.data as { createTask?: { id: string } } | undefined)?.createTask?.id;
      if (newId && status !== 'todo') {
        moveTask(newId, status);
      } else {
        onChanged();
      }
    } finally {
      setNewTitle('');
    }
  };
  const handleAddKeyDown = (status: string, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setAddingStatus(null);
      setNewTitle('');
    } else if (e.key === 'Enter') {
      void submitAdd(status);
    }
  };

  const startEditTitle = (task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
  };
  const commitEditTitle = (task: Task) => {
    const title = editTitle.trim();
    setEditingId(null);
    if (title && title !== task.title) {
      mutateTitle({ variables: { id: task.id, title } });
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, height: '100%', overflowX: 'auto', paddingBottom: 8 }}>
      {COLUMN_STATUSES.map((status) => (
        <div
          key={status}
          onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status); }}
          onDragLeave={() => setDragOverStatus((current) => (current === status ? null : current))}
          onDrop={(e) => handleColumnDrop(status, e)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 190px',
            minWidth: 190,
            background: dragOverStatus === status ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: '1px solid #303030',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              padding: '8px',
              borderBottom: '1px solid #303030',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <Typography.Text
              strong
              title={columnLabel[status]}
              style={{
                color: TASK_STATUS_COLOR[status],
                fontSize: 13,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
              }}
            >
              {columnLabel[status]}
            </Typography.Text>
            <Tag style={{ margin: 0, flexShrink: 0 }}>{byStatus(status).length}</Tag>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 80 }}>
            {groupByMilestone
              ? groupTasksByMilestone(byStatus(status)).map((group) => (
                <div key={group.milestone ?? '__no_milestone__'} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}
                  >
                    {group.milestone ?? t('noMilestone')} ({group.tasks.length})
                  </Typography.Text>
                  {group.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      status={status}
                      editing={editingId === task.id}
                      draggedOver={dragOverTaskId === task.id}
                      editTitle={editTitle}
                      labelFor={labelFor}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverTaskId(task.id); }}
                      onDragLeave={() => setDragOverTaskId((current) => (current === task.id ? null : current))}
                      onDrop={(e) => handleCardDrop(status, task, e)}
                      onOpen={() => { if (editingId !== task.id) openRecord(task.id); }}
                      onStartEdit={() => startEditTitle(task)}
                      onEditChange={setEditTitle}
                      onCommitEdit={() => commitEditTitle(task)}
                      onCancelEdit={() => setEditingId(null)}
                      onDeleted={onChanged}
                    />
                  ))}
                </div>
              ))
              : byStatus(status).map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  status={status}
                  editing={editingId === task.id}
                  draggedOver={dragOverTaskId === task.id}
                  editTitle={editTitle}
                  labelFor={labelFor}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverTaskId(task.id); }}
                  onDragLeave={() => setDragOverTaskId((current) => (current === task.id ? null : current))}
                  onDrop={(e) => handleCardDrop(status, task, e)}
                  onOpen={() => { if (editingId !== task.id) openRecord(task.id); }}
                  onStartEdit={() => startEditTitle(task)}
                  onEditChange={setEditTitle}
                  onCommitEdit={() => commitEditTitle(task)}
                  onCancelEdit={() => setEditingId(null)}
                  onDeleted={onChanged}
                />
              ))}
            {status === 'changes_requested' || !canCreate ? null : addingStatus === status ? (
              <Input
                size="small"
                autoFocus
                placeholder={t('newTask')}
                value={newTitle}
                disabled={creating}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => handleAddKeyDown(status, e)}
                onBlur={() => void submitAdd(status)}
              />
            ) : (
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => startAdd(status)}
                style={{ color: '#8c8c8c', justifyContent: 'flex-start' }}
              >
                {t('newTask')}
              </Button>
            )}
          </div>
        </div>
      ))}
      <RequestChangesModal
        open={pendingChangesRequestId !== null}
        loading={requestingChanges}
        onCancel={() => setPendingChangesRequestId(null)}
        onSubmit={(note) => {
          if (pendingChangesRequestId) {
            mutateChangesRequested({ variables: { id: pendingChangesRequestId, status: 'changes_requested', note } });
          }
          setPendingChangesRequestId(null);
        }}
      />
    </div>
  );
}
