import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  BugOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Badge, Col, Row, Skeleton, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { GET_EVENTS_PAGE, GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import { ProjectGraphView } from '../graph-view/ProjectGraphView';
import { isNewSince } from '../../shared/lib/isNewSince';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { PREFIX_MAP, useRealtimeStore, type VersionKey } from '../../shared/model/realtime.store';
import type { Artifact, Decision, Event, Paginated, ProjectSummary, Task } from '../../shared/model/types';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

// T-MEMORY-051 follow-up: bounded recent-events window backing the
// per-category "new since last viewed" badges below — same tradeoff as the
// nav-rail's own UNREAD_WINDOW_SIZE (cheap to poll on every realtime bump,
// wide enough to be accurate against any realistic notificationsSeenAt).
const NEW_BADGE_WINDOW_SIZE = 100;

/** First PREFIX_MAP entry whose prefix matches this event's type, or null (e.g. "gitCredential." has no bucket). */
function categorizeEvent(type: string): VersionKey | null {
  return PREFIX_MAP.find(([prefix]) => type.startsWith(prefix))?.[1] ?? null;
}

/** Small count badge next to a Statistic's title — only rendered once there's something new to show. */
function StatTitle({ label, newCount }: { label: string; newCount: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      {newCount > 0 && <Badge count={newCount} size="small" overflowCount={99} color="#177ddc" />}
    </span>
  );
}

const taskColumns: ColumnsType<Task> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 200, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  { title: 'Pri', dataIndex: 'priority', width: 55, align: 'center' },
  { title: 'Milestone', dataIndex: 'milestone', width: 120, ellipsis: true, render: (v) => v ?? '—' },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const decisionColumns: ColumnsType<Decision> = [
  {
    title: 'ID', dataIndex: 'id', width: 150, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'Title', dataIndex: 'title', minWidth: 200, ellipsis: true },
  { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', width: 200,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const artifactColumns: ColumnsType<Artifact> = [
  {
    title: 'ID', dataIndex: 'id', width: 140, fixed: 'left',
    render: (v) => <RecordLink id={v} />,
  },
  {
    title: 'Path', dataIndex: 'path', minWidth: 200, ellipsis: true,
    render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
  },
  { title: 'Type', dataIndex: 'contentType', width: 180, ellipsis: true },
  { title: 'Size', dataIndex: 'sizeBytes', width: 75, align: 'right', render: (v) => v ? `${(v / 1024).toFixed(1)}k` : '—' },
  { title: 'Status', dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
  {
    title: 'Tags', dataIndex: 'tags', width: 200,
    render: (tags: string[]) => tags.map((t) => <Tag key={t} style={{ fontSize: 11 }}>{t}</Tag>),
  },
  { title: 'Updated', dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

const eventColumns: ColumnsType<Event> = [
  { title: 'Type', dataIndex: 'type', width: 160, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
  { title: 'Title', dataIndex: 'title', minWidth: 200, ellipsis: true },
  {
    title: 'Related', dataIndex: 'relatedId', width: 140,
    render: (v) => <RecordLink id={v} />,
  },
  { title: 'At', dataIndex: 'createdAt', width: 120, render: (v) => <Timestamp value={v} /> },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 8 }}
      >
        {title}
      </Typography.Text>
      {children}
    </div>
  );
}

export function ProjectOverview({ slug }: { slug: string }) {
  const { data, loading, error, refetch } = useQuery<{ projectSummary: ProjectSummary }>(
    GET_PROJECT_SUMMARY,
    { variables: { project: slug } },
  );
  // T-MEMORY-051: keep the overview live without a manual refresh.
  useRefetchOnVersion(
    useRealtimeStore((s) => s.tasksVersion + s.decisionsVersion + s.artifactsVersion + s.memoryVersion + s.linksVersion + s.eventsVersion),
    refetch,
  );

  // T-MEMORY-051 follow-up: per-category "new since last viewed" badges on
  // the stats row above — a second, independent query/refetch pair (rather
  // than folding into the summary query above) since it needs its own
  // window of raw events to bucket by type prefix, not the summary's counts.
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);
  const { data: newEventsData, refetch: refetchNewEvents } = useQuery<{ eventsPage: Paginated<Event> }>(
    GET_EVENTS_PAGE,
    { variables: { project: slug, limit: NEW_BADGE_WINDOW_SIZE, offset: 0 } },
  );
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), refetchNewEvents);

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <Alert type="error" message={error.message} />
      </div>
    );
  }

  const s = data!.projectSummary;
  const { counts } = s;

  // T-MEMORY-051 follow-up: bucket the fetched window of recent events by
  // type prefix (reusing realtime.store's own PREFIX_MAP categorization) and
  // count how many of each landed after notificationsSeenAt.
  const newEvents = (newEventsData?.eventsPage.items ?? []).filter((event) => isNewSince(event.createdAt, notificationsSeenAt));
  const newCategoryCounts = newEvents.reduce<Partial<Record<VersionKey, number>>>((acc, event) => {
    const category = categorizeEvent(event.type);
    if (category) acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});
  const newTaskCount = newCategoryCounts.tasksVersion ?? 0;
  const newDecisionCount = newCategoryCounts.decisionsVersion ?? 0;
  const newArtifactCount = newCategoryCounts.artifactsVersion ?? 0;
  const newMemoryCount = newCategoryCounts.memoryVersion ?? 0;
  // Every fetched row is itself an event, so the Events stat just counts however many of them are new.
  const newEventCount = newEvents.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Fixed header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #303030', flexShrink: 0 }}>
        <Typography.Title level={4} style={{ marginBottom: 4 }}>
          {s.project.title}
        </Typography.Title>
        {s.project.description && (
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            {s.project.description}
          </Typography.Text>
        )}
        <Row gutter={24}>
          <Col>
            <Statistic
              title={<StatTitle label="Open Tasks" newCount={newTaskCount} />}
              value={counts.openTasks}
              prefix={<CalendarOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Col>
          <Col>
            <Statistic title={<StatTitle label="All Tasks" newCount={newTaskCount} />} value={counts.tasks} valueStyle={{ fontSize: 20 }} />
          </Col>
          <Col>
            <Statistic
              title={<StatTitle label="Decisions" newCount={newDecisionCount} />}
              value={counts.decisions}
              prefix={<ApartmentOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Col>
          <Col>
            <Statistic
              title={<StatTitle label="Artifacts" newCount={newArtifactCount} />}
              value={counts.artifacts}
              prefix={<DatabaseOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Col>
          <Col>
            <Statistic
              title={<StatTitle label="Events" newCount={newEventCount} />}
              value={counts.events}
              prefix={<ThunderboltOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Col>
          <Col>
            <Statistic title={<StatTitle label="Memory" newCount={newMemoryCount} />} value={counts.items} valueStyle={{ fontSize: 20 }} />
          </Col>
          {counts.openTasks > 0 && (
            <Col>
              <Statistic
                title="Faults"
                value={0}
                prefix={<BugOutlined />}
                valueStyle={{ fontSize: 20, color: '#ff4d4f' }}
              />
            </Col>
          )}
        </Row>
      </div>

      {/* Tabs: Timeline | Summary — timeline first (I-PMEM-011): it's the
          entry point into a project's history, tables are the reference view */}
      <Tabs
        defaultActiveKey="timeline"
        size="small"
        className="tabs-fill"
        tabBarStyle={{ paddingLeft: 24, marginBottom: 0, flexShrink: 0 }}
        items={[
          {
            key: 'timeline',
            label: 'Timeline',
            children: (
              <div style={{ height: '100%' }}>
                <ProjectGraphView slug={slug} />
              </div>
            ),
          },
          {
            key: 'summary',
            label: 'Summary',
            children: (
              <div style={{ overflowY: 'auto', padding: '16px 24px', height: '100%' }}>
                {s.openTasks.length > 0 && (
                  <Section title="Open Tasks">
                    <Table<Task> dataSource={s.openTasks} columns={taskColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.decisions.length > 0 && (
                  <Section title="Active Decisions">
                    <Table<Decision> dataSource={s.decisions} columns={decisionColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.artifacts.length > 0 && (
                  <Section title="Artifacts">
                    <Table<Artifact> dataSource={s.artifacts} columns={artifactColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.recentEvents.length > 0 && (
                  <Section title="Recent Events">
                    <Table<Event> dataSource={s.recentEvents} columns={eventColumns} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
