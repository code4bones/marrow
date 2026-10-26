import { TaskStatusSelect } from './TaskStatusSelect';
import { shortAuthor } from '../../shared/lib/shortAuthor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Collapse, Form, Input, Modal, Select, Space, Spin, Steps, Tooltip, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { GET_TASK_WORKFLOW, HANDOFF_TASK } from '../../shared/api/queries';
import type { ProjectMemberRole, Task, TaskWorkflowPage, WorkflowParticipant } from '../../shared/model/types';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useAuthStore } from '../../shared/model/auth.store';
import { useProjectMembers } from '../../shared/lib/useProjectMembers';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Markdown } from '../../shared/ui/Markdown';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';

function people(participants: WorkflowParticipant[]): string {
  return participants.map((p) => p.label).join(', ');
}
function timestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
}

export function TaskWorkflowPanel({ task, projectId, role }: { task: Task; projectId: string | null; role: ProjectMemberRole | null }) {
  const { t } = useTranslation('tasks');
  const user = useAuthStore((s) => s.user);
  const { members } = useProjectMembers(projectId);
  const variables = useMemo(() => ({ id: task.id, limit: 30 }), [task.id]);
  const { data, loading, error, refetch, fetchMore } = useQuery<{ taskWorkflow: TaskWorkflowPage }>(GET_TASK_WORKFLOW, { variables });
  useRefetchOnVersion(useRealtimeStore((s) => s.tasksVersion), refetch);
  const [open, setOpen] = useState(false);
  const [transferVersion, setTransferVersion] = useState<number | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [form] = Form.useForm();
  const [transfer, { loading: saving }] = useMutation(HANDOFF_TASK, {
    refetchQueries: ['GetTaskWorkflow', 'GetRecord'],
    onCompleted: () => { message.success(t('workflowTransferred')); setOpen(false); form.resetFields(); },
    onError: (e) => { message.error(e.message); },
  });
  const steps = [...(data?.taskWorkflow.items ?? [])].reverse();
  const route = steps.filter((step) => step.kind !== 'status');
  const pathRef = useRef<HTMLDivElement>(null);
  const lastRouteId = route.at(-1)?.id;
  useEffect(() => {
    if (pathRef.current) pathRef.current.scrollLeft = pathRef.current.scrollWidth;
  }, [lastRouteId]);
  const currentIds = task.currentPerformerUserIds ?? [];
  const currentLabel = currentIds.map((id) => members.find((m) => m.userId === id)?.email
    ?? steps.at(-1)?.to.find((p) => p.userId === id)?.label ?? id).join(', ');
  const canTransfer = !['done', 'cancelled'].includes(task.status) && Boolean(task.version)
    && (role === 'pm' || user?.role === 'admin' || (user && currentIds.includes(user.id)));
  return (
    <div>
      {loading && !data && <Spin size="small" />}
      {error && <Alert type="error" title={error.message} action={<Button size="small" onClick={() => { void refetch(); }}>{t('workflowRetry')}</Button>} />}
      {route.length > 0 && <div ref={pathRef} aria-label={t('workflowTitle')} style={{ overflowX: 'auto', padding: '4px 0 12px', marginBottom: 6 }}>
        <Steps size="small" responsive={false} titlePlacement="vertical" current={route.length - 1}
          status={task.status === 'done' ? 'finish' : task.status === 'cancelled' ? 'error' : 'process'}
          style={{ minWidth: Math.max(260, route.length * 110) }}
          styles={{ itemTitle: { maxWidth: 110, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: 12 } }}
          items={route.map((step) => ({
            title: <Tooltip title={<div>{people(step.to) || t('workflowEmpty')}<br />{step.actorLabel} · {timestamp(step.createdAt)}<br />{step.status.toUpperCase()}{step.note && <div>{step.note}</div>}</div>}>
              <span>{step.to.map((p) => shortAuthor(p.label)).join(', ') || t('workflowEmpty')}</span>
            </Tooltip>,
          }))}
        />
      </div>}
      <Space wrap style={{ marginBottom: 6 }}>
        <TaskStatusSelect id={task.id} value={task.status} role={role} />
        <Tooltip title={`${t('workflowCurrent')}: ${currentLabel || t('workflowEmpty')}`}><Typography.Text type="secondary">{currentLabel ? currentLabel.split(', ').map(shortAuthor).join(', ') : t('workflowEmpty')}</Typography.Text></Tooltip>
        {canTransfer && <Button size="small" type="link" onClick={() => { setTransferVersion(task.version); setOpen(true); }} disabled={task.activeClaimCount > 0}>{t('workflowHandoff')}</Button>}
      </Space>
      {data?.taskWorkflow.hasMore && <Button size="small" type="link" loading={moreLoading} onClick={async () => {
        setMoreLoading(true);
        try {
          await fetchMore({ variables: { beforeVersion: data.taskWorkflow.nextBeforeVersion }, updateQuery: (previous, { fetchMoreResult }) => ({
            taskWorkflow: { ...fetchMoreResult.taskWorkflow, items: [...previous.taskWorkflow.items, ...fetchMoreResult.taskWorkflow.items].filter((step, index, all) => all.findIndex((s) => s.id === step.id) === index) },
          }) });
        } catch (e) { message.error(e instanceof Error ? e.message : String(e)); } finally { setMoreLoading(false); }
      }}>{t('workflowOlder')}</Button>}
      {steps.length > 0 && <Collapse size="small" ghost items={[{ key: 'history', label: `${t('workflowHistory')} · ${steps.length}`, children:
        <div style={{ display: 'grid', gap: 12 }}>{steps.map((step) => <div key={step.id} style={{ borderLeft: '2px solid #1668dc', paddingLeft: 10 }}>
          <Space size={4} wrap><Typography.Text strong>{t(`workflow_${step.kind}`)}</Typography.Text><StatusBadge status={step.status} /><RecordLink id={step.taskId} /></Space>
          <div>{step.kind === 'handoff' ? `${people(step.from) || '—'} → ${people(step.to) || '—'}` : people(step.to)}</div>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>{step.actorLabel} · {timestamp(step.createdAt)}</Typography.Text>
          {step.note && <Markdown>{step.note}</Markdown>}
        </div>)}</div>
      }]} />}
      <Modal open={open} title={t('workflowHandoff')} onCancel={() => { setOpen(false); form.resetFields(); }} onOk={() => form.submit()} okButtonProps={{ loading: saving }} okText={t('workflowHandoff')}>
        <Form form={form} layout="vertical" initialValues={{ status: 'todo' }} onFinish={(values: { assignees: string[]; status: string; note: string }) => {
          void transfer({ variables: { id: task.id, expectedVersion: transferVersion, ...values } }).catch(() => {});
        }}>
          <Form.Item name="assignees" label={t('workflowTo')} rules={[{ required: true }]}><Select mode="multiple" showSearch optionFilterProp="label" options={members.map((m) => ({ value: m.userId, label: m.email }))} /></Form.Item>
          <Form.Item name="status" label={t('workflowStatus')} rules={[{ required: true }]}><Select options={['todo', 'doing', 'review', 'blocked'].map((value) => ({ value, label: value.toUpperCase() }))} /></Form.Item>
          <Form.Item name="note" label={t('workflowNote')} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} maxLength={8000} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
