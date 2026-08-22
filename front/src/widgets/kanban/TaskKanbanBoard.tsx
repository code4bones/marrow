import { useMutation } from '@apollo/client/react';
import { Card, Tag, Typography, message } from 'antd';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TASK_STATUS_COLOR } from '../../features/task/taskStatusColor';
import { UPDATE_TASK_STATUS } from '../../shared/api/queries';
import { getEntityType } from '../../shared/lib/entityId';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import type { Task } from '../../shared/model/types';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { RecordLink } from '../../shared/ui/RecordLink';

const COLUMN_STATUSES = ['todo', 'doing', 'blocked', 'done', 'cancelled'] as const;

interface Props {
  tasks: Task[];
  /** Called after a drag-drop status change lands so the caller's own query refetches. */
  onChanged: () => void;
}

// Native HTML5 drag-and-drop -- no dnd library in this bundle yet, and a
// 5-column task board doesn't need one (no reordering within a column, no
// virtualization). draggable + dataTransfer carrying the task id is the
// whole mechanism.
export function TaskKanbanBoard({ tasks, onChanged }: Props) {
  const { t } = useTranslation('tasks');
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const { labelFor } = useActorLabels(tasks.map((task) => (task.assigneeUserId ? `user:${task.assigneeUserId}` : null)));
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [mutate] = useMutation(UPDATE_TASK_STATUS, {
    onError: (e) => message.error(e.message),
    onCompleted: onChanged,
  });

  const columnLabel: Record<(typeof COLUMN_STATUSES)[number], string> = {
    todo: t('statusTodo'),
    doing: t('statusDoing'),
    blocked: t('statusBlocked'),
    done: t('statusDone'),
    cancelled: t('statusCancelled'),
  };

  const byStatus = (status: string) =>
    tasks.filter((task) => task.status === status).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  const handleDrop = (status: string, e: DragEvent) => {
    e.preventDefault();
    setDragOverStatus(null);
    const id = e.dataTransfer.getData('text/plain');
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task || task.status === status) {
      return;
    }
    mutate({ variables: { id, status } });
  };

  const openRecord = (id: string) => setSelectedRecord(id, getEntityType(id));

  return (
    <div style={{ display: 'flex', gap: 12, height: '100%', overflowX: 'auto', paddingBottom: 8 }}>
      {COLUMN_STATUSES.map((status) => (
        <div
          key={status}
          onDragOver={(e) => { e.preventDefault(); setDragOverStatus(status); }}
          onDragLeave={() => setDragOverStatus((current) => (current === status ? null : current))}
          onDrop={(e) => handleDrop(status, e)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 260,
            flexShrink: 0,
            background: dragOverStatus === status ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: '1px solid #303030',
            borderRadius: 8,
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid #303030',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <Typography.Text strong style={{ color: TASK_STATUS_COLOR[status] }}>
              {columnLabel[status]}
            </Typography.Text>
            <Tag style={{ margin: 0 }}>{byStatus(status).length}</Tag>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 80 }}>
            {byStatus(status).map((task) => (
              <Card
                key={task.id}
                size="small"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                onClick={() => openRecord(task.id)}
                style={{ cursor: 'grab' }}
                styles={{ body: { padding: 10 } }}
              >
                <Typography.Text style={{ fontSize: 13 }}>{task.title}</Typography.Text>
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
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
