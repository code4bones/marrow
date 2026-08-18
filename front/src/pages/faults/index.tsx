import { useQuery } from '@apollo/client/react';
import { Alert, Input, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { GET_FAULTS_PAGE } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { usePage } from '../../shared/lib/usePage';
import type { MemoryRecord, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

function buildColumns(t: (key: string) => string, labelFor: (id: string | null | undefined) => string | null): ColumnsType<MemoryRecord> {
  return [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('title'), dataIndex: 'title', minWidth: 240, ellipsis: true },
    { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('excerpt'), dataIndex: 'excerpt', minWidth: 300, ellipsis: true,
      render: (v) => <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text>,
    },
    {
      title: t('tagsCol'), dataIndex: 'tags', minWidth: 160,
      render: (tags: string[]) =>
        tags.filter((tag) => tag !== 'failed_attempt').map((tag) => (
          <Tag key={tag} color={tag === 'known-fault' ? 'red' : undefined} style={{ fontSize: 11 }}>{tag}</Tag>
        )),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 150, render: (v, row) => <Timestamp value={v} author={labelFor(row.createdBy)} /> },
  ];
}

export function FaultsPage() {
  const { t } = useTranslation('faults');
  const { slug } = useParams<{ slug: string }>();
  const [search, setSearch] = useState('fault');
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error } = useQuery<{ memorySearchPage: Paginated<MemoryRecord> }>(GET_FAULTS_PAGE, {
    variables: { project: slug, query: search || 'fault', limit: pageSize, offset },
  });

  const pageInfo = data?.memorySearchPage.pageInfo;
  const { labelFor } = useActorLabels((data?.memorySearchPage.items ?? []).map((item) => item.createdBy));
  const columns = buildColumns(t, labelFor);

  return (
    <PageLayout
      title={t('knownFaults')}
      slug={slug}
      headerExtra={
        <Input.Search
          placeholder={t('searchFaultsPlaceholder')}
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
          showTotal: (count) => t('faultsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
