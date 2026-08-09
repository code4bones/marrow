import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ArchiveArtifactButton } from '../../features/artifact/ArchiveArtifactButton';
import { DeleteArtifactButton } from '../../features/artifact/DeleteArtifactButton';
import { PutTextArtifactDrawer } from '../../features/artifact/PutTextArtifactDrawer';
import { UpdateArtifactMetaModal } from '../../features/artifact/UpdateArtifactMetaModal';
import { GET_ARTIFACTS_PAGE } from '../../shared/api/queries';
import { isNewSince } from '../../shared/lib/isNewSince';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useSectionSeenStore } from '../../shared/model/sectionSeen.store';
import type { Artifact, Paginated } from '../../shared/model/types';
import { NewTag } from '../../shared/ui/NewTag';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

function sizeLabel(bytes: number | null) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function ArtifactsPage() {
  const { t } = useTranslation('artifacts');
  const { slug } = useParams<{ slug: string }>();
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ artifactsPage: Paginated<Artifact> }>(GET_ARTIFACTS_PAGE, {
    variables: { project: slug, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.artifactsVersion), refetch);
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);
  const markSeen = useSectionSeenStore((s) => s.markSeen);
  useEffect(() => {
    if (slug) markSeen(slug, 'artifacts');
  }, [slug, markSeen]);

  const pageInfo = data?.artifactsPage.pageInfo;

  const columns: ColumnsType<Artifact> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 140, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: t('path'), dataIndex: 'path', minWidth: 220, ellipsis: true,
      render: (v, row) => (
        <span>
          <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>
          {isNewSince(row.updatedAt ?? row.createdAt, notificationsSeenAt) && <NewTag />}
        </span>
      ),
    },
    { title: t('title'), dataIndex: 'title', minWidth: 180, ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: t('scope'), dataIndex: 'scope', width: 80, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: t('contentType'), dataIndex: 'contentType', width: 170, ellipsis: true },
    { title: t('size'), dataIndex: 'sizeBytes', width: 80, align: 'right', sorter: (a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0), render: sizeLabel },
    { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 160,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
    {
      title: '', key: 'actions', width: 70, fixed: 'right',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 2 }}>
          <UpdateArtifactMetaModal artifact={row} onDone={() => refetch()} />
          <ArchiveArtifactButton id={row.id} onDone={() => refetch()} />
          <DeleteArtifactButton id={row.id} onDone={() => refetch()} />
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('artifacts')}
      subtitle={slug}
      headerExtra={slug ? <PutTextArtifactDrawer projectSlug={slug} onDone={() => refetch()} /> : undefined}
    >
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      <Table<Artifact>
        dataSource={data?.artifactsPage.items}
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
          showTotal: (count) => t('artifactsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
