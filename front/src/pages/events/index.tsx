import { useQuery } from '@apollo/client/react';
import { Alert, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { DeleteEventButton } from '../../features/event/DeleteEventButton';
import { RecordEventModal } from '../../features/event/RecordEventModal';
import { GET_EVENTS_PAGE } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { usePage } from '../../shared/lib/usePage';
import { shortAuthor } from '../../shared/lib/shortAuthor';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useSectionSeenStore } from '../../shared/model/sectionSeen.store';
import type { Event, Paginated } from '../../shared/model/types';
import { PageLayout } from '../../shared/ui/PageLayout';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

export function EventsPage() {
  const { t } = useTranslation('events');
  const { slug } = useParams<{ slug: string }>();
  const { page, pageSize, offset, onChange } = usePage(100);

  const { data, loading, error, refetch } = useQuery<{ eventsPage: Paginated<Event> }>(GET_EVENTS_PAGE, {
    variables: { project: slug, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), refetch);
  const markSeen = useSectionSeenStore((s) => s.markSeen);
  useEffect(() => {
    if (slug) markSeen(slug, 'events');
  }, [slug, markSeen]);

  const pageInfo = data?.eventsPage.pageInfo;
  const { labelFor } = useActorLabels((data?.eventsPage.items ?? []).map((e) => e.credentialId));

  const columns: ColumnsType<Event> = [
    {
      // agentName (any event, any domain -- base.ts's recordEventForProject)
      // renders as "owner (agent)" folded into the existing author line
      // rather than its own column: it's a qualifier on who did this, not
      // an independent fact deserving separate table real estate.
      title: t('at'), dataIndex: 'createdAt', width: 160, fixed: 'left',
      render: (v, row) => {
        // shortAuthor() up front, not left to Timestamp's own internal call
        // -- Timestamp's shortAuthor(author) truncates at the first "@", and
        // an unshortened "user@host (agent)" string has one inside the
        // owner part, which would swallow the "(agent)" suffix along with
        // the domain.
        const owner = labelFor(row.credentialId);
        const shortOwner = owner ? shortAuthor(owner) : null;
        const author = shortOwner && row.agentName ? `${shortOwner} (${row.agentName})` : shortOwner;
        return <Timestamp value={v} author={author} />;
      },
    },
    { title: t('type'), dataIndex: 'type', width: 180, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: t('title'), dataIndex: 'title', minWidth: 240, ellipsis: true },
    {
      title: t('related'), dataIndex: 'relatedId', width: 160,
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: '', key: 'actions', width: 40, fixed: 'right',
      render: (_, row) => <DeleteEventButton id={row.id} onDone={() => refetch()} />,
    },
  ];

  return (
    <PageLayout
      title={t('events')}
      slug={slug}
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
          showTotal: (count) => t('eventsCount', { count }),
        }}
      />
    </PageLayout>
  );
}
