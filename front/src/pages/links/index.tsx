import { useQuery } from '@apollo/client/react';
import { Alert, Checkbox, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { CreateLinkModal } from '../../features/link/CreateLinkModal';
import { DeleteLinkButton } from '../../features/link/DeleteLinkButton';
import { GET_LINKS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { Link, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

export function LinksPage() {
  const { t } = useTranslation('links');
  const { slug } = useParams<{ slug: string }>();
  const [relation, setRelation] = useState('');
  const [includeCommon, setIncludeCommon] = useState(false);
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error, refetch } = useQuery<{ linksPage: Paginated<Link> }>(GET_LINKS_PAGE, {
    variables: { project: slug, relation: relation || undefined, includeCommon, limit: pageSize, offset },
  });

  const pageInfo = data?.linksPage.pageInfo;

  const columns: ColumnsType<Link> = [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('from'), dataIndex: 'fromId', width: 160, render: (v) => <RecordLink id={v} /> },
    {
      title: t('relation'), dataIndex: 'relation', width: 180,
      render: (v) => <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace' }}>{v}</span>,
    },
    { title: t('to'), dataIndex: 'toId', width: 160, render: (v) => <RecordLink id={v} /> },
    { title: t('at'), dataIndex: 'createdAt', width: 120, render: (v) => <Timestamp value={v} /> },
    {
      title: '', key: 'actions', width: 40, fixed: 'right',
      render: (_, row) => <DeleteLinkButton id={row.id} onDone={() => refetch()} />,
    },
  ];

  return (
    <PageLayout
      title={t('links')}
      subtitle={slug}
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Input
            placeholder={t('filterRelationPlaceholder')}
            value={relation}
            onChange={(e) => { setRelation(e.target.value); onChange(1, pageSize); }}
            allowClear
            style={{ width: 200 }}
            size="small"
          />
          <Checkbox
            checked={includeCommon}
            onChange={(e) => { setIncludeCommon(e.target.checked); onChange(1, pageSize); }}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}
          >
            {t('plusCommon')}
          </Checkbox>
          {slug && <CreateLinkModal projectSlug={slug} onDone={() => refetch()} />}
        </div>
      }
    >
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      <Table<Link>
        dataSource={data?.linksPage.items}
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
          showTotal: (count) => t('linksCount', { count }),
        }}
      />
    </PageLayout>
  );
}
