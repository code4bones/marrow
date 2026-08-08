import { useQuery } from '@apollo/client/react';
import { useEffect } from 'react';
import { Alert, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { GET_EVENTS_PAGE } from '../../shared/api/queries';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import type { Event, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

// T-MEMORY-051: global notifications feed — same row shape as
// pages/events/index.tsx, but eventsPage is called with no `project`
// variable, which the gateway (events.mixin.ts's eventsPage fix) now
// resolves to "every project this session is a member of, plus common
// events" instead of the pre-fix "every project system-wide".
export function NotificationsPage() {
  const { t } = useTranslation('notifications');
  const { page, pageSize, offset, onChange } = usePage(100);
  const markNotificationsSeen = useAuthStore((s) => s.markNotificationsSeen);

  const { data, loading, error, refetch } = useQuery<{ eventsPage: Paginated<Event> }>(GET_EVENTS_PAGE, {
    variables: { limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), refetch);

  // Mark everything seen once, on mount — same "opening the page clears the
  // badge" convention as most notification centers.
  useEffect(() => {
    void markNotificationsSeen();
  }, [markNotificationsSeen]);

  const pageInfo = data?.eventsPage.pageInfo;

  const columns: ColumnsType<Event> = [
    { title: t('at'), dataIndex: 'createdAt', width: 130, fixed: 'left', render: (v) => <Timestamp value={v} /> },
    { title: t('type'), dataIndex: 'type', width: 180, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: t('title'), dataIndex: 'title', minWidth: 240, ellipsis: true },
    {
      title: t('related'), dataIndex: 'relatedId', width: 160,
      render: (v) => <RecordLink id={v} />,
    },
  ];

  return (
    <PageLayout title={t('notifications')}>
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
          showTotal: (count) => t('eventsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
