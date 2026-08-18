import { useQuery } from '@apollo/client/react';
import { Alert, Checkbox, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ArchiveMemoryButton } from '../../features/memory/ArchiveMemoryButton';
import { CreateMemoryDrawer } from '../../features/memory/CreateMemoryDrawer';
import { DeleteMemoryButton } from '../../features/memory/DeleteMemoryButton';
import { GET_MEMORY_ITEMS_PAGE } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { isNewSince } from '../../shared/lib/isNewSince';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useSectionSeenStore } from '../../shared/model/sectionSeen.store';
import type { MemoryRecord, Paginated } from '../../shared/model/types';
import { NewTag } from '../../shared/ui/NewTag';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

function typeOptions(t: (key: string) => string) {
  return [
    { label: t('allTypes'), value: '' },
    { label: t('typeHandoff'), value: 'handoff' },
    { label: t('typeNote'), value: 'note' },
    { label: t('typeFault'), value: 'failed_attempt' },
    { label: t('typeConvention'), value: 'convention' },
    { label: t('typeArchitecture'), value: 'architecture_question' },
    { label: t('typeSmokeTest'), value: 'smoke-test' },
  ];
}

export function MemoryPage() {
  const { t } = useTranslation('memory');
  const { slug } = useParams<{ slug: string }>();
  const [type, setType] = useState('');
  const [includeCommon, setIncludeCommon] = useState(false);
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ memoryItemsPage: Paginated<MemoryRecord> }>(GET_MEMORY_ITEMS_PAGE, {
    variables: { project: slug, type: type || undefined, includeCommon, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.memoryVersion), refetch);
  const markSeen = useSectionSeenStore((s) => s.markSeen);
  useEffect(() => {
    if (slug) markSeen(slug, 'memory');
  }, [slug, markSeen]);
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);

  const pageInfo = data?.memoryItemsPage.pageInfo;
  const { labelFor } = useActorLabels((data?.memoryItemsPage.items ?? []).map((item) => item.createdBy));

  const columns: ColumnsType<MemoryRecord> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('type'), dataIndex: 'type', width: 150, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    {
      title: t('title'), dataIndex: 'title', minWidth: 240, ellipsis: true,
      render: (v, row) => (
        <span>
          {v}
          {isNewSince(row.updatedAt ?? row.createdAt, notificationsSeenAt) && <NewTag />}
        </span>
      ),
    },
    { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('excerpt'), dataIndex: 'excerpt', minWidth: 260, ellipsis: true,
      render: (v) => v
        ? <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>{v}</span>
        : null,
    },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 180,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 150, render: (v, row) => <Timestamp value={v} author={labelFor(row.createdBy)} /> },
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
      title={t('memory')}
      slug={slug}
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Select
            value={type}
            onChange={(v) => { setType(v); onChange(1, pageSize); }}
            options={typeOptions(t)}
            style={{ width: 160 }}
            size="small"
          />
          <Checkbox
            checked={includeCommon}
            onChange={(e) => { setIncludeCommon(e.target.checked); onChange(1, pageSize); }}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}
          >
            {t('plusCommon')}
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
          showTotal: (count) => t('itemsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
