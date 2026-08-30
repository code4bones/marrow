import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { ArchiveSkillButton } from '../../features/skill/ArchiveSkillButton';
import { DeleteSkillButton } from '../../features/skill/DeleteSkillButton';
import { RecordSkillDrawer } from '../../features/skill/RecordSkillDrawer';
import { UpdateSkillDrawer } from '../../features/skill/UpdateSkillDrawer';
import { GET_SKILLS_PAGE } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import type { Paginated, Skill } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

export function SkillsPage() {
  const { t } = useTranslation('skills');
  const { slug } = useParams<{ slug: string }>();
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ skillsPage: Paginated<Skill> }>(GET_SKILLS_PAGE, {
    variables: { project: slug, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.skillsVersion), refetch);

  const pageInfo = data?.skillsPage.pageInfo;
  const { labelFor } = useActorLabels((data?.skillsPage.items ?? []).map((s) => s.createdBy));

  const columns: ColumnsType<Skill> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 140, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('name'), dataIndex: 'name', minWidth: 200, ellipsis: true },
    {
      title: t('description'), dataIndex: 'description', minWidth: 260, ellipsis: true,
      render: (v) => v ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: t('scope'), dataIndex: 'scope', width: 80, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 160,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('activations'), dataIndex: 'activationCount', width: 90, align: 'right' },
    { title: t('updated'), dataIndex: 'updatedAt', width: 150, render: (v, row) => <Timestamp value={v} author={labelFor(row.createdBy)} /> },
    {
      title: '', key: 'actions', width: 90, fixed: 'right',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 2 }}>
          <UpdateSkillDrawer skill={row} onDone={() => refetch()} />
          <ArchiveSkillButton id={row.id} onDone={() => refetch()} />
          <DeleteSkillButton id={row.id} onDone={() => refetch()} />
        </div>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('skills')}
      slug={slug}
      headerExtra={slug ? <RecordSkillDrawer projectSlug={slug} onDone={() => refetch()} /> : undefined}
    >
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      <Table<Skill>
        dataSource={data?.skillsPage.items}
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
          showTotal: (count) => t('skillsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
