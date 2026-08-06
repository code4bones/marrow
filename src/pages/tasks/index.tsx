import { useQuery } from '@apollo/client/react';
import { Alert, Badge, Select, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreateTaskDrawer } from '../../features/task/CreateTaskDrawer';
import { DeleteTaskButton } from '../../features/task/DeleteTaskButton';
import { TaskStatusSelect } from '../../features/task/TaskStatusSelect';
import { GET_TASKS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { Paginated, Task } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';
import { TaskFlowchart } from '../../widgets/graph-view/TaskFlowchart';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Todo', value: 'todo' },
  { label: 'Doing', value: 'doing' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
];

export function TasksPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState('');
  const { page, pageSize, offset, onChange } = usePage();

  // Fetch all tasks (no status filter) for the flowchart
  const { data: allData } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
    variables: { project: slug, limit: 100, offset: 0 },
    skip: !slug,
  });

  const { data, loading, error, refetch } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
    variables: { project: slug, status: status || undefined, limit: pageSize, offset },
    skip: !slug,
  });

  if (!slug) {
    return (
      <PageLayout title="Tasks">
        <Typography.Text type="secondary">Select a project first.</Typography.Text>
      </PageLayout>
    );
  }

  const pageInfo = data?.tasksPage.pageInfo;
  const allTasks = allData?.tasksPage.items ?? [];

  const columns: ColumnsType<Task> = [
    {
      title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: 'Title', dataIndex: 'title', minWidth: 220, ellipsis: true },
    {
      title: 'Status', dataIndex: 'status', width: 120,
      render: (v, row) => <TaskStatusSelect id={row.id} value={v} onDone={() => refetch()} />,
    },
    { title: 'Pri', dataIndex: 'priority', width: 55, align: 'center', sorter: (a, b) => (a.priority ?? 0) - (b.priority ?? 0) },
    {
      title: 'Claims', dataIndex: 'activeClaimCount', width: 68, align: 'center',
      render: (v: number) => v > 0 ? <Badge count={v} color="#1668dc" /> : null,
    },
    { title: 'Milestone', dataIndex: 'milestone', width: 130, ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    {
      title: 'Scope', dataIndex: 'scope', width: 80,
      render: (v) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—',
    },
    { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
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
        options={STATUS_OPTIONS}
        style={{ width: 150 }}
        size="small"
      />
      <CreateTaskDrawer projectSlug={slug} onDone={() => refetch()} />
    </div>
  );

  return (
    <PageLayout title="Tasks" subtitle={slug} headerExtra={header} fill>
      <Tabs
        defaultActiveKey="list"
        size="small"
        className="tabs-fill"
        tabBarStyle={{ marginBottom: 8, flexShrink: 0, paddingLeft: 0 }}
        items={[
          {
            key: 'list',
            label: 'List',
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
                    showTotal: (t) => `${t} tasks`,
                  }}
                />
              </div>
            ),
          },
          {
            key: 'flowchart',
            label: 'Dependency Flowchart',
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
