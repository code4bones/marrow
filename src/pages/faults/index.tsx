import { useQuery } from '@apollo/client/react';
import { Alert, Input, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { GET_FAULTS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { MemoryRecord, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const columns: ColumnsType<MemoryRecord> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 240, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Excerpt', dataIndex: 'excerpt', minWidth: 300, ellipsis: true,
    render: (v) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text>,
  },
  {
    title: 'Tags', dataIndex: 'tags', minWidth: 160,
    render: (tags: string[]) =>
      tags.filter((t) => t !== 'failed_attempt').map((t) => (
        <Tag key={t} color={t === 'known-fault' ? 'red' : undefined} style={{ fontSize: 11 }}>{t}</Tag>
      )),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

export function FaultsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useState('fault');
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error } = useQuery<{ memorySearchPage: Paginated<MemoryRecord> }>(GET_FAULTS_PAGE, {
    variables: { project: slug, query: search || 'fault', limit: pageSize, offset },
  });

  const pageInfo = data?.memorySearchPage.pageInfo;

  return (
    <PageLayout
      title="Known Faults"
      subtitle={slug}
      headerExtra={
        <Input.Search
          placeholder="Search faults…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
          size="small"
          allowClear
          onClear={() => setSearch('fault')}
        />
      }
    >
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      <Table<MemoryRecord>
        dataSource={data?.memorySearchPage.items}
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
          showTotal: (t) => `${t} faults`,
        }}
      />
    </PageLayout>
  );
}
