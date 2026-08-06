import { useQuery } from '@apollo/client/react';
import { Alert, Checkbox, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArchiveMemoryButton } from '../../features/memory/ArchiveMemoryButton';
import { CreateMemoryDrawer } from '../../features/memory/CreateMemoryDrawer';
import { DeleteMemoryButton } from '../../features/memory/DeleteMemoryButton';
import { GET_MEMORY_ITEMS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { MemoryRecord, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

const TYPE_OPTIONS = [
  { label: 'All types', value: '' },
  { label: 'Handoff', value: 'handoff' },
  { label: 'Note', value: 'note' },
  { label: 'Fault', value: 'failed_attempt' },
  { label: 'Convention', value: 'convention' },
  { label: 'Architecture', value: 'architecture_question' },
  { label: 'Smoke test', value: 'smoke-test' },
];

export function MemoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const [type, setType] = useState('');
  const [includeCommon, setIncludeCommon] = useState(false);
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ memoryItemsPage: Paginated<MemoryRecord> }>(GET_MEMORY_ITEMS_PAGE, {
    variables: { project: slug, type: type || undefined, includeCommon, limit: pageSize, offset },
  });

  const pageInfo = data?.memoryItemsPage.pageInfo;

  const columns: ColumnsType<MemoryRecord> = [
    {
      title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: 'Type', dataIndex: 'type', width: 150, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: 'Title', dataIndex: 'title', minWidth: 240, ellipsis: true },
    { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: 'Excerpt', dataIndex: 'excerpt', minWidth: 260, ellipsis: true,
      render: (v) => v
        ? <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{v}</span>
        : null,
    },
    {
      title: 'Tags', dataIndex: 'tags', minWidth: 180,
      render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
    },
    { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
    {
      title: '', key: 'actions', width: 60, fixed: 'right',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 2 }}>
          <ArchiveMemoryButton id={row.id} onDone={() => refetch()} />
          <DeleteMemoryButton id={row.id} onDone={() => refetch()} />
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title="Memory"
      subtitle={slug}
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Select
            value={type}
            onChange={(v) => { setType(v); onChange(1, pageSize); }}
            options={TYPE_OPTIONS}
            style={{ width: 160 }}
            size="small"
          />
          <Checkbox
            checked={includeCommon}
            onChange={(e) => { setIncludeCommon(e.target.checked); onChange(1, pageSize); }}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}
          >
            + common
          </Checkbox>
          {slug && <CreateMemoryDrawer projectSlug={slug} onDone={() => refetch()} />}
        </div>
      }
    >
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      <Table<MemoryRecord>
        dataSource={data?.memoryItemsPage.items}
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
          showTotal: (t) => `${t} items`,
        }}
      />
    </PageLayout>
  );
}
