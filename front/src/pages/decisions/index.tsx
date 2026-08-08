import { useQuery } from '@apollo/client/react';
import { Alert, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArchiveDecisionButton } from '../../features/decision/ArchiveDecisionButton';
import { DeleteDecisionButton } from '../../features/decision/DeleteDecisionButton';
import { RecordDecisionDrawer } from '../../features/decision/RecordDecisionDrawer';
import { GET_DECISIONS_PAGE } from '../../shared/api/queries';
import { isNewSince } from '../../shared/lib/isNewSince';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import type { Decision, Paginated } from '../../shared/model/types';
import { NewTag } from '../../shared/ui/NewTag';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const STATUS_OPTIONS = [
  { label: 'All statuses', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'Rejected', value: 'rejected' },
];

export function DecisionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState('');
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ decisionsPage: Paginated<Decision> }>(GET_DECISIONS_PAGE, {
    variables: { project: slug, status: status || undefined, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.decisionsVersion), refetch);
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);

  const pageInfo = data?.decisionsPage.pageInfo;

  const columns: ColumnsType<Decision> = [
    {
      title: 'ID', dataIndex: 'id', width: 160, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: 'Title', dataIndex: 'title', minWidth: 220, ellipsis: true,
      render: (v, row) => (
        <span>
          {v}
          {isNewSince(row.updatedAt ?? row.createdAt, notificationsSeenAt) && <NewTag />}
        </span>
      ),
    },
    { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
    {
      title: 'Tags', dataIndex: 'tags', minWidth: 180,
      render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
    },
    { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
    {
      title: '', key: 'actions', width: 60, fixed: 'right',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 2 }}>
          <ArchiveDecisionButton id={row.id} onDone={() => refetch()} />
          <DeleteDecisionButton id={row.id} onDone={() => refetch()} />
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title="Decisions"
      subtitle={slug}
      headerExtra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={status}
            onChange={(v) => { setStatus(v); onChange(1, pageSize); }}
            options={STATUS_OPTIONS}
            style={{ width: 150 }}
            size="small"
          />
          {slug && <RecordDecisionDrawer projectSlug={slug} onDone={() => refetch()} />}
        </div>
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
