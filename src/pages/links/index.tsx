import { useQuery } from '@apollo/client/react';
import { Alert, Checkbox, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { GET_LINKS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { Link, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

const columns: ColumnsType<Link> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'From',     dataIndex: 'fromId',   width: 160, render: (v) => <RecordLink id={v} /> },
  {
    title: 'Relation', dataIndex: 'relation', width: 180,
    render: (v) => <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', fontFamily: 'monospace' }}>{v}</span>,
  },
  { title: 'To',       dataIndex: 'toId',     width: 160, render: (v) => <RecordLink id={v} /> },
  { title: 'At',       dataIndex: 'createdAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

export function LinksPage() {
  const { slug } = useParams<{ slug: string }>();
  const [relation, setRelation] = useState('');
  const [includeCommon, setIncludeCommon] = useState(false);
  const { page, pageSize, offset, onChange } = usePage();

  const { data, loading, error } = useQuery<{ linksPage: Paginated<Link> }>(GET_LINKS_PAGE, {
    variables: { project: slug, relation: relation || undefined, includeCommon, limit: pageSize, offset },
  });

  const pageInfo = data?.linksPage.pageInfo;

  return (
    <PageLayout
      title="Links"
      subtitle={slug}
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Input
            placeholder="Filter relation…"
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
            + common
          </Checkbox>
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
          showTotal: (t) => `${t} links`,
        }}
      />
    </PageLayout>
  );
}
