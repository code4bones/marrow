import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useParams } from 'react-router-dom';
import { DeleteEventButton } from '../../features/event/DeleteEventButton';
import { RecordEventModal } from '../../features/event/RecordEventModal';
import { GET_EVENTS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import type { Event, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

export function EventsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { page, pageSize, offset, onChange } = usePage(100);

  const { data, loading, error, refetch } = useQuery<{ eventsPage: Paginated<Event> }>(GET_EVENTS_PAGE, {
    variables: { project: slug, limit: pageSize, offset },
  });

  const pageInfo = data?.eventsPage.pageInfo;

  const columns: ColumnsType<Event> = [
    { title: 'At', dataIndex: 'createdAt', width: 130, fixed: 'left', render: (v) => <Timestamp value={v} /> },
    { title: 'Type', dataIndex: 'type', width: 180, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: 'Title', dataIndex: 'title', minWidth: 240, ellipsis: true },
    {
      title: 'Related', dataIndex: 'relatedId', width: 160,
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: '', key: 'actions', width: 40, fixed: 'right',
      render: (_, row) => <DeleteEventButton id={row.id} onDone={() => refetch()} />,
    },
  ];

  return (
    <PageLayout
      title="Events"
      subtitle={slug}
      headerExtra={slug ? <RecordEventModal projectSlug={slug} onDone={() => refetch()} /> : undefined}
    >
      {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
      <Table<Event>
        dataSource={data?.eventsPage.items}
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
          showTotal: (t) => `${t} events`,
        }}
      />
    </PageLayout>
  );
}
