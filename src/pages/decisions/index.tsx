import { useQuery } from '@apollo/client/react';
import { Alert, Select, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { GET_DECISIONS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { Decision, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'Rejected', value: 'rejected' },
];

const columns: ColumnsType<Decision> = [
  {
    title: 'ID', dataIndex: 'id', width: 160, fixed: 'left',
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 220, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', minWidth: 180,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

export function DecisionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState('');
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error } = useQuery<{ decisionsPage: Paginated<Decision> }>(GET_DECISIONS_PAGE, {
    variables: { project: slug, status: status || undefined, limit: pageSize, offset },
  });

  const pageInfo = data?.decisionsPage.pageInfo;

  return (
    <PageLayout
      title="Decisions"
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
      <Table<Decision>
        dataSource={data?.decisionsPage.items}
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
          showTotal: (t) => `${t} decisions`,
        }}
      />
    </PageLayout>
  );
}
