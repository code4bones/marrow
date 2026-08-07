import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useParams } from 'react-router-dom';
import { ArchiveArtifactButton } from '../../features/artifact/ArchiveArtifactButton';
import { DeleteArtifactButton } from '../../features/artifact/DeleteArtifactButton';
import { PutTextArtifactDrawer } from '../../features/artifact/PutTextArtifactDrawer';
import { UpdateArtifactMetaModal } from '../../features/artifact/UpdateArtifactMetaModal';
import { GET_ARTIFACTS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import type { Artifact, Paginated } from '../../shared/model/types';
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
  const { slug } = useParams<{ slug: string }>();
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ artifactsPage: Paginated<Artifact> }>(GET_ARTIFACTS_PAGE, {
    variables: { project: slug, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.artifactsVersion), refetch);

  const pageInfo = data?.artifactsPage.pageInfo;

  const columns: ColumnsType<Artifact> = [
    {
      title: 'ID', dataIndex: 'id', width: 140, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: 'Path', dataIndex: 'path', minWidth: 220, ellipsis: true,
      render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
    },
    { title: 'Title', dataIndex: 'title', minWidth: 180, ellipsis: true, render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text> },
    { title: 'Scope', dataIndex: 'scope', width: 80, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: 'Type', dataIndex: 'contentType', width: 170, ellipsis: true },
    { title: 'Size', dataIndex: 'sizeBytes', width: 80, align: 'right', sorter: (a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0), render: sizeLabel },
    { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: 'Tags', dataIndex: 'tags', minWidth: 160,
      render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
    },
    { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
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
      title="Artifacts"
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
          showTotal: (t) => `${t} artifacts`,
        }}
      />
    </PageLayout>
  );
}
