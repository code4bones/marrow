import { useQuery } from '@apollo/client/react';
import { Alert, Badge, Select, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CreateTaskDrawer } from '../../features/task/CreateTaskDrawer';
import { DeleteTaskButton } from '../../features/task/DeleteTaskButton';
import { TaskStatusSelect } from '../../features/task/TaskStatusSelect';
import { GET_TASKS_PAGE } from '../../shared/api/queries';
import { isNewSince } from '../../shared/lib/isNewSince';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import type { Paginated, Task } from '../../shared/model/types';
import { NewTag } from '../../shared/ui/NewTag';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';
import { TaskFlowchart } from '../../widgets/graph-view/TaskFlowchart';

function statusOptions(t: (key: string) => string) {
  return [
    { label: t('allStatuses'), value: '' },
    { label: t('statusTodo'), value: 'todo' },
    { label: t('statusDoing'), value: 'doing' },
    { label: t('statusBlocked'), value: 'blocked' },
    { label: t('statusDone'), value: 'done' },
    { label: t('statusCancelled'), value: 'cancelled' },
  ];
}

// T-MEMORY-051 follow-up: server-driven sort. Values are "<TaskSortField>:<SortDirection>"
// GraphQL enum pairs, split apart before being sent as query variables.
function sortOptions(t: (key: string) => string) {
  return [
    { label: t('sortUpdatedNewest'), value: 'UPDATED_AT:DESC' },
    { label: t('sortCreatedNewest'), value: 'CREATED_AT:DESC' },
    { label: t('priority'), value: 'PRIORITY:ASC' },
  ];
}
const DEFAULT_SORT = 'UPDATED_AT:DESC';

export function TasksPage() {
  const { t } = useTranslation('tasks');
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState(DEFAULT_SORT);
  const { page, pageSize, offset, onChange } = usePage();
  const [sortField, sortDirection] = sort.split(':');

  // Fetch all tasks (no status filter) for the flowchart
  const { data: allData } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
    variables: { project: slug, limit: 100, offset: 0 },
    skip: !slug,
  });

  const { data, loading, error, refetch } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
    variables: { project: slug, status: status || undefined, sortField, sortDirection, limit: pageSize, offset },
    skip: !slug,
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.tasksVersion), refetch);
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);

  if (!slug) {
    return (
      <PageLayout title={t('tasks')}>
        <Typography.Text type="secondary">{t('selectProjectFirst')}</Typography.Text>
      </PageLayout>
    );
  }

  const pageInfo = data?.tasksPage.pageInfo;
  const allTasks = allData?.tasksPage.items ?? [];

  const columns: ColumnsType<Task> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: t('title'), dataIndex: 'title', minWidth: 220, ellipsis: true,
      render: (v, row) => (
        <span>
          {v}
          {isNewSince(row.updatedAt ?? row.createdAt, notificationsSeenAt) && <NewTag />}
        </span>
      ),
    },
    {
      title: t('status'), dataIndex: 'status', width: 120,
      render: (v, row) => <TaskStatusSelect id={row.id} value={v} onDone={() => refetch()} />,
    },
    { title: t('priorityShort'), dataIndex: 'priority', width: 55, align: 'center', sorter: (a, b) => (a.priority ?? 0) - (b.priority ?? 0) },
    {
      title: t('claims'), dataIndex: 'activeClaimCount', width: 68, align: 'center',
      render: (v: number) => v > 0 ? <Badge count={v} color="#1668dc" /> : null,
    },
    { title: t('milestone'), dataIndex: 'milestone', width: 130, ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    {
      title: t('scope'), dataIndex: 'scope', width: 80,
      render: (v) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—',
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
    {
      title: '', key: 'actions', width: 40, fixed: 'right',
      render: (_, row) => <DeleteTaskButton id={row.id} onDone={() => refetch()} />,
    },
  ];

  const header = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Select
        value={status}
        onChange={(v) => { setStatus(v); onChange(1, pageSize); }}
        options={statusOptions(t)}
        style={{ width: 150 }}
        size="small"
      />
      <Select
        value={sort}
        onChange={(v) => { setSort(v); onChange(1, pageSize); }}
        options={sortOptions(t)}
        style={{ width: 160 }}
        size="small"
      />
      <CreateTaskDrawer projectSlug={slug} onDone={() => refetch()} />
    </div>
  );

  return (
    <PageLayout title={t('tasks')} subtitle={slug} headerExtra={header} fill>
      <Tabs
        defaultActiveKey="list"
        size="small"
        className="tabs-fill"
        tabBarStyle={{ marginBottom: 8, flexShrink: 0, paddingLeft: 0 }}
        items={[
          {
            key: 'list',
            label: t('list'),
            children: (
              <div style={{ height: '100%', overflowY: 'auto', padding: '0 0 8px' }}>
                {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
                <Table<Task>
                  dataSource={data?.tasksPage.items}
                  columns={columns}
                  rowKey="id"
                  size="small"
                  loading={loading}
                  scroll={{ x: 'max-content' }}
                  pagination={{
                    current: page,
                    pageSize,
                    total: pageInfo?.totalCount,
                    onChange,
                    showSizeChanger: true,
                    pageSizeOptions: ['15', '25', '50', '100'],
                    showTotal: (count) => t('tasksCount', { count }),
                  }}
                />
              </div>
            ),
          },
          {
            key: 'flowchart',
            label: t('dependencyFlowchart'),
            children: (
              <div style={{ height: '100%', minHeight: 400 }}>
                <TaskFlowchart tasks={allTasks} />
              </div>
            ),
          },
        ]}
      />
    </PageLayout>
  );
}
