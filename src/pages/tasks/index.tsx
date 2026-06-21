import { useQuery } from '@apollo/client/react';
import { Alert, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { GET_TASKS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { Paginated, Task } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Todo', value: 'todo' },
  { label: 'Doing', value: 'doing' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
  { label: 'Cancelled', value: 'cancelled' },
];

const columns: ColumnsType<Task> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 220, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  { title: 'Pri', dataIndex: 'priority', width: 55, align: 'center', sorter: (a, b) => (a.priority ?? 0) - (b.priority ?? 0) },
  { title: 'Milestone', dataIndex: 'milestone', width: 130, ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
  { title: 'Scope', dataIndex: 'scope', width: 80, render: (v) => v ? <Tag style={{ fontSize: 11 }}>{v}</Tag> : '—' },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

export function TasksPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState('');
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error } = useQuery<{ tasksPage: Paginated<Task> }>(GET_TASKS_PAGE, {
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

  return (
    <PageLayout
      title="Tasks"
      subtitle={slug}
      headerExtra={
        <Select
          value={status}
          onChange={(v) => { setStatus(v); onChange(1, pageSize); }}
          options={STATUS_OPTIONS}
          style={{ width: 150 }}
          size="small"
        />
      }
    >
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
    </PageLayout>
  );
}
