import { useQuery } from '@apollo/client/react';
import { Alert, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useSectionSeenStore } from '../../shared/model/sectionSeen.store';
import type { Decision, Paginated } from '../../shared/model/types';
import { NewTag } from '../../shared/ui/NewTag';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

function statusOptions(t: (key: string) => string) {
  return [
    { label: t('allStatuses'), value: '' },
    { label: t('statusActive'), value: 'active' },
    { label: t('statusDraft'), value: 'draft' },
    { label: t('statusSuperseded'), value: 'superseded' },
    { label: t('statusRejected'), value: 'rejected' },
    { label: t('statusArchived'), value: 'archived' },
  ];
}

export function DecisionsPage() {
  const { t } = useTranslation('decisions');
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState('');
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ decisionsPage: Paginated<Decision> }>(GET_DECISIONS_PAGE, {
    variables: { project: slug, status: status || undefined, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.decisionsVersion), refetch);
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);
  const markSeen = useSectionSeenStore((s) => s.markSeen);
  useEffect(() => {
    if (slug) markSeen(slug, 'decisions');
  }, [slug, markSeen]);

  const pageInfo = data?.decisionsPage.pageInfo;

  const columns: ColumnsType<Decision> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 160, fixed: 'left',
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
    { title: t('status'), dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 180,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
    {
      title: '', key: 'actions', width: 90, fixed: 'right',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 2 }}>
          {slug && row.status !== 'superseded' && (
            <RecordDecisionDrawer projectSlug={slug} supersedesId={row.id} onDone={() => refetch()} />
          )}
          <ArchiveDecisionButton id={row.id} onDone={() => refetch()} />
          <DeleteDecisionButton id={row.id} onDone={() => refetch()} />
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('decisions')}
      subtitle={slug}
      headerExtra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={status}
            onChange={(v) => { setStatus(v); onChange(1, pageSize); }}
            options={statusOptions(t)}
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
          showTotal: (count) => t('decisionsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
