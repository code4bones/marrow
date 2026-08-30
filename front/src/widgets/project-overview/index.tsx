import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  BugOutlined,
  BulbOutlined,
  CalendarOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Badge, Col, Row, Segmented, Skeleton, Statistic, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { GET_EVENTS_PAGE, GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import { ShareProjectButton } from '../../features/project/ShareProjectButton';
import { GlobalSearchBox } from './GlobalSearchBox';
import { ProjectGraphView } from '../graph-view/ProjectGraphView';
import { ENTITY_COLOR, SATELLITE_KIND_COLOR } from '../../shared/lib/entityId';
import { isNewSince } from '../../shared/lib/isNewSince';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useAuthStore } from '../../shared/model/auth.store';
import { PREFIX_MAP, useRealtimeStore, type VersionKey } from '../../shared/model/realtime.store';
import { useSectionSeenStore, type SectionKey } from '../../shared/model/sectionSeen.store';
import type { Artifact, Decision, Event, Paginated, ProjectSummary, Task } from '../../shared/model/types';
import { RecordLink } from '../../shared/ui/RecordLink';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';

// T-MEMORY-051 follow-up: bounded recent-events window backing the
// per-category "new since last viewed" badges below — same tradeoff as the
// nav-rail's own UNREAD_WINDOW_SIZE (cheap to poll on every realtime bump,
// wide enough to be accurate against any realistic notificationsSeenAt).
const NEW_BADGE_WINDOW_SIZE = 100;

// Owner's ask: color each stat row icon with the same domain color already
// painted on screen elsewhere — specifically the colors shown in the
// Timeline's own legend ("dotsOnACard") and as the small satellite dots on
// its record cards (SATELLITE_KIND_COLOR, shared/lib/entityId.ts). NOT
// ENTITY_COLOR (also in entityId.ts) — that's a different mapping that
// disagrees with SATELLITE_KIND_COLOR for task/artifact; SATELLITE_KIND_COLOR
// is the one the owner is visually comparing against. It has no EVENT entry
// (events are never a satellite dot), so Events falls back to ENTITY_COLOR
// there, which has no existing on-screen precedent to conflict with.
const STAT_COLOR_TASK = SATELLITE_KIND_COLOR.TASK;
const STAT_COLOR_DECISION = SATELLITE_KIND_COLOR.DECISION;
const STAT_COLOR_ARTIFACT = SATELLITE_KIND_COLOR.ARTIFACT;
const STAT_COLOR_MEMORY = SATELLITE_KIND_COLOR.MEMORY;
const STAT_COLOR_EVENT = ENTITY_COLOR.event;
// Skills, like Events, has no on-screen satellite-dot precedent to match
// (never rendered as a Timeline card satellite) -- same ENTITY_COLOR fallback.
const STAT_COLOR_SKILL = ENTITY_COLOR.skill;

/** First PREFIX_MAP entry whose prefix matches this event's type, or null (e.g. "gitCredential." has no bucket). */
function categorizeEvent(type: string): VersionKey | null {
  return PREFIX_MAP.find(([prefix]) => type.startsWith(prefix))?.[1] ?? null;
}

// I-MEMORY-audit: the badge counts events of this category since
// notificationsSeenAt -- a "recent activity" signal, unrelated to the
// Statistic's own value (a current total/count). Shown side by side with
// no explanation, the two numbers read as if they should agree (they
// don't: e.g. finishing several tasks today shows up here as high recent
// activity even while the open-tasks total drops to 0). A tooltip spells
// out what the badge actually counts so it can't be misread as "N of
// these are new" or "N still open".
function StatTitle({ label, newCount }: { label: string; newCount: number }) {
  const { t } = useTranslation('projects');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {label}
      {newCount > 0 && (
        <Tooltip title={t('recentActivityCount', { count: newCount })}>
          <Badge count={newCount} size="small" overflowCount={99} color="#177ddc" />
        </Tooltip>
      )}
    </span>
  );
}

/** Makes a stat card act like a link into that section (tasks/decisions/memory/...), keyboard-accessible. */
function ClickableStat({ to, children }: { to: string; children: React.ReactNode }) {
  const navigate = useNavigate();
  const activate = () => navigate(to);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      }}
      className="project-overview-stat"
      style={{ cursor: 'pointer', borderRadius: 6, padding: 4, margin: -4, textAlign: 'center' }}
    >
      {children}
    </div>
  );
}

function taskColumns(t: (key: string) => string): ColumnsType<Task> {
  return [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('title'), dataIndex: 'title', minWidth: 200, ellipsis: true },
    { title: t('status'), dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
    { title: t('priorityShort'), dataIndex: 'priority', width: 55, align: 'center' },
    { title: t('milestone'), dataIndex: 'milestone', width: 120, ellipsis: true, render: (v) => v ?? '—' },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
  ];
}

function decisionColumns(t: (key: string) => string): ColumnsType<Decision> {
  return [
    {
      title: t('idCol'), dataIndex: 'id', width: 150, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('title'), dataIndex: 'title', minWidth: 200, ellipsis: true },
    { title: t('status'), dataIndex: 'status', width: 110, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', width: 200,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
  ];
}

function artifactColumns(t: (key: string) => string): ColumnsType<Artifact> {
  return [
    {
      title: t('idCol'), dataIndex: 'id', width: 140, fixed: 'left',
      render: (v) => <RecordLink id={v} />,
    },
    {
      title: t('path'), dataIndex: 'path', minWidth: 200, ellipsis: true,
      render: (v) => <Typography.Text code style={{ fontSize: 11 }}>{v}</Typography.Text>,
    },
    { title: t('contentType'), dataIndex: 'contentType', width: 180, ellipsis: true },
    { title: t('size'), dataIndex: 'sizeBytes', width: 75, align: 'right', render: (v) => v ? `${(v / 1024).toFixed(1)}k` : '—' },
    { title: t('status'), dataIndex: 'status', width: 90, render: (v) => <StatusBadge status={v} /> },
    {
      title: t('tagsCol'), dataIndex: 'tags', width: 200,
      render: (tags: string[]) => tags.map((tag) => <Tag key={tag} style={{ fontSize: 11 }}>{tag}</Tag>),
    },
    { title: t('updated'), dataIndex: 'updatedAt', width: 120, render: (v) => <Timestamp value={v} /> },
  ];
}

function eventColumns(t: (key: string) => string): ColumnsType<Event> {
  return [
    { title: t('type'), dataIndex: 'type', width: 160, render: (v) => <Tag style={{ fontSize: 11 }}>{v}</Tag> },
    { title: t('title'), dataIndex: 'title', minWidth: 200, ellipsis: true },
    {
      title: t('related'), dataIndex: 'relatedId', width: 140,
      render: (v) => <RecordLink id={v} />,
    },
    { title: t('at'), dataIndex: 'createdAt', width: 120, render: (v) => <Timestamp value={v} /> },
  ];
}

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
  const { t } = useTranslation('projects');
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [overviewTab, setOverviewTab] = useState('timeline');
  const { data, loading, error, refetch } = useQuery<{ projectSummary: ProjectSummary }>(
    GET_PROJECT_SUMMARY,
    { variables: { project: slug } },
  );
  // T-MEMORY-051: keep the overview live without a manual refresh.
  useRefetchOnVersion(
    useRealtimeStore((s) => s.tasksVersion + s.decisionsVersion + s.artifactsVersion + s.memoryVersion + s.linksVersion + s.skillsVersion + s.eventsVersion),
    refetch,
  );

  // T-MEMORY-051 follow-up: per-category "new since last viewed" badges on
  // the stats row above — a second, independent query/refetch pair (rather
  // than folding into the summary query above) since it needs its own
  // window of raw events to bucket by type prefix, not the summary's counts.
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);
  const getSeenAt = useSectionSeenStore((st) => st.getSeenAt);
  const { data: newEventsData, refetch: refetchNewEvents } = useQuery<{ eventsPage: Paginated<Event> }>(
    GET_EVENTS_PAGE,
    { variables: { project: slug, limit: NEW_BADGE_WINDOW_SIZE, offset: 0 } },
  );
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), refetchNewEvents);

  // `&& !data`, not just `loading` -- Apollo's refetch() (T-MEMORY-051's
  // own realtime hook right above) can flip loading back to true for the
  // *background* refetch too, not only the true first load. Gating on
  // loading alone swapped this entire subtree for a Skeleton element on
  // every realtime event, which unmounts everything under it -- including
  // ProjectGraphView's own Root-kind selector state, reported live: it
  // silently reset to the "Decisions" default on every single status
  // change elsewhere, no matter how many times it was switched back.
  // Once `data` exists from the initial load, never show the skeleton
  // again -- a background refetch updates in place instead.
  if (loading && !data) {
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

  // Owner's expectation: opening a section (Tasks, Decisions, ...) clears
  // that section's own badge here, not a global "mark everything as read"
  // action. Each badge now reads its own (project, section) last-visited
  // timestamp from sectionSeen.store (set by that section's list page on
  // mount) instead of one shared notificationsSeenAt -- falling back to
  // notificationsSeenAt only when the section has never been visited under
  // this newer mechanism, so existing usage doesn't see every badge as
  // freshly "new" the moment this ships.
  const seenAtFor = (section: SectionKey) => getSeenAt(slug, section) ?? notificationsSeenAt;

  // T-MEMORY-051 follow-up: bucket the fetched window of recent events by
  // type prefix (reusing realtime.store's own PREFIX_MAP categorization),
  // then count how many in each bucket are newer than THAT bucket's own
  // seen-at.
  const allRecentEvents = newEventsData?.eventsPage.items ?? [];
  const eventsByCategory = allRecentEvents.reduce<Partial<Record<VersionKey, Event[]>>>((acc, event) => {
    const category = categorizeEvent(event.type);
    if (category) (acc[category] ??= []).push(event);
    return acc;
  }, {});
  const countNewSince = (events: Event[] | undefined, seenAt: string | null) =>
    (events ?? []).filter((event) => isNewSince(event.createdAt, seenAt)).length;
  const newTaskCount = countNewSince(eventsByCategory.tasksVersion, seenAtFor('tasks'));
  const newDecisionCount = countNewSince(eventsByCategory.decisionsVersion, seenAtFor('decisions'));
  const newArtifactCount = countNewSince(eventsByCategory.artifactsVersion, seenAtFor('artifacts'));
  const newMemoryCount = countNewSince(eventsByCategory.memoryVersion, seenAtFor('memory'));
  // Every fetched row is itself an event, so the Events stat just counts however many of them are new for that section.
  const newEventCount = countNewSince(allRecentEvents, seenAtFor('events'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Fixed header -- on mobile this row is dropped entirely: AppShell's
          MobileHeader (back + omni search + profile) already fills the
          same role above the page, so duplicating title/search/share here
          would just eat vertical space on a phone viewport. */}
      <div style={{ padding: isMobile ? '12px 12px 8px' : '20px 24px 16px', borderBottom: '1px solid #303030', flexShrink: 0 }}>
        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
            <Typography.Title level={4} style={{ marginBottom: 0, flexShrink: 0 }}>
              {s.project.title}
            </Typography.Title>
            <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
              <GlobalSearchBox slug={slug} />
            </div>
            <ShareProjectButton slug={slug} />
          </div>
        )}
        <style>{`.project-overview-stat:hover { background: rgba(255, 255, 255, 0.06); }`}</style>
        <Row gutter={isMobile ? [8, 12] : 24} wrap>
          {[
            {
              key: 'openTasks',
              to: `/projects/${slug}/tasks`,
              // Badge intentionally omitted here (kept on "All tasks" below
              // instead): newTaskCount counts ALL task-related activity,
              // completions included, which pulls this exact number in the
              // opposite direction of "open" -- pairing it with this stat
              // specifically read as if N tasks had just become open.
              title: <StatTitle label={t('openTasksStat')} newCount={0} />,
              value: counts.openTasks,
              prefix: <CalendarOutlined style={{ color: STAT_COLOR_TASK }} />,
              color: STAT_COLOR_TASK,
            },
            {
              key: 'allTasks',
              to: `/projects/${slug}/tasks`,
              title: <StatTitle label={t('allTasks')} newCount={newTaskCount} />,
              value: counts.tasks,
              color: STAT_COLOR_TASK,
            },
            {
              key: 'decisions',
              to: `/projects/${slug}/decisions`,
              title: <StatTitle label={t('decisions')} newCount={newDecisionCount} />,
              value: counts.decisions,
              prefix: <ApartmentOutlined style={{ color: STAT_COLOR_DECISION }} />,
              color: STAT_COLOR_DECISION,
            },
            {
              key: 'artifacts',
              to: `/projects/${slug}/artifacts`,
              title: <StatTitle label={t('artifacts')} newCount={newArtifactCount} />,
              value: counts.artifacts,
              prefix: <DatabaseOutlined style={{ color: STAT_COLOR_ARTIFACT }} />,
              color: STAT_COLOR_ARTIFACT,
            },
            {
              key: 'skills',
              to: `/projects/${slug}/skills`,
              title: t('skills'),
              value: counts.skills,
              prefix: <BulbOutlined style={{ color: STAT_COLOR_SKILL }} />,
              color: STAT_COLOR_SKILL,
            },
            {
              key: 'events',
              to: `/projects/${slug}/events`,
              title: <StatTitle label={t('events')} newCount={newEventCount} />,
              value: counts.events,
              prefix: <ThunderboltOutlined style={{ color: STAT_COLOR_EVENT }} />,
              color: STAT_COLOR_EVENT,
            },
            {
              key: 'memory',
              to: `/projects/${slug}/memory`,
              title: <StatTitle label={t('memory')} newCount={newMemoryCount} />,
              value: counts.items,
              color: STAT_COLOR_MEMORY,
            },
            {
              key: 'faults',
              to: `/projects/${slug}/faults`,
              title: t('faults'),
              value: counts.faults,
              prefix: <BugOutlined />,
              color: '#ff4d4f',
            },
          ].map((item) => (
            // T-context (2026-08-26, owner's ask: mobile PWA layout follow-up,
            // "верхний блок со статистикой не умещается"): the desktop row is
            // content-sized and never wraps (there's always room), which on a
            // phone meant 7 stats spilling past the viewport edge with no
            // obvious way to reach the rest. Mobile instead wraps into a
            // 2-per-row grid (span=12 of 24) so everything is visible without
            // any horizontal scrolling.
            <Col key={item.key} {...(isMobile ? { span: 12 } : {})}>
              <ClickableStat to={item.to}>
                <Statistic title={item.title} value={item.value} prefix={item.prefix} valueStyle={{ fontSize: 20, color: item.color }} />
              </ClickableStat>
            </Col>
          ))}
        </Row>
      </div>

      {/* Tabs: Timeline | Kanban | Summary — timeline first (I-PMEM-011):
          it's the entry point into a project's history, tables are the
          reference view. Kanban isn't a real inline panel here (it lives on
          the Tasks page, T-MEMORY-102) -- owner asked for a direct shortcut
          because nothing else pointed at it ("канбан не зная где он - не
          найдешь"), so its onChange below intercepts that one key and
          navigates instead of switching panels.

          T-context (2026-08-26, owner's ask: mobile PWA layout follow-up):
          T-MEMORY-130 dropped this whole section on mobile, which read as
          "Overview - пустой экран" (empty) once live -- the Timeline needs
          to stay, just not as desktop's horizontal multi-column Miller
          layout. Mobile gets a compact Segmented (Timeline/Kanban only, no
          Summary) instead of the full Tabs bar; DecisionTimeline itself
          (via ProjectGraphView) renders its own single-column drill-in
          variant on mobile (T-MEMORY-131) -- no prop needed here, it reads
          the same useIsMobile() internally. */}
      {isMobile ? (
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', flexShrink: 0 }}>
            <Segmented
              size="small"
              value="timeline"
              onChange={(key) => {
                if (key === 'kanban') navigate(`/projects/${slug}/tasks?tab=kanban`);
              }}
              options={[{ label: t('timeline'), value: 'timeline' }, { label: t('kanban'), value: 'kanban' }]}
            />
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ProjectGraphView slug={slug} />
          </div>
        </div>
      ) : (
      <Tabs
        activeKey={overviewTab}
        onChange={(key) => {
          if (key === 'kanban') {
            navigate(`/projects/${slug}/tasks?tab=kanban`);
            return;
          }
          setOverviewTab(key);
        }}
        size="small"
        className="tabs-fill"
        tabBarStyle={{ paddingLeft: 24, marginBottom: 0, flexShrink: 0 }}
        items={[
          {
            key: 'timeline',
            label: t('timeline'),
            children: (
              <div style={{ height: '100%' }}>
                <ProjectGraphView slug={slug} />
              </div>
            ),
          },
          {
            key: 'kanban',
            label: t('kanban'),
            children: null,
          },
          {
            key: 'summary',
            label: t('summary'),
            children: (
              <div style={{ overflowY: 'auto', padding: '16px 24px', height: '100%' }}>
                {s.openTasks.length > 0 && (
                  <Section title={t('openTasks')}>
                    <Table<Task> dataSource={s.openTasks} columns={taskColumns(t)} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.decisions.length > 0 && (
                  <Section title={t('activeDecisions')}>
                    <Table<Decision> dataSource={s.decisions} columns={decisionColumns(t)} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.artifacts.length > 0 && (
                  <Section title={t('artifacts')}>
                    <Table<Artifact> dataSource={s.artifacts} columns={artifactColumns(t)} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
                {s.recentEvents.length > 0 && (
                  <Section title={t('recentEvents')}>
                    <Table<Event> dataSource={s.recentEvents} columns={eventColumns(t)} rowKey="id" size="small" pagination={false} scroll={{ x: 'max-content' }} />
                  </Section>
                )}
              </div>
            ),
          },
        ]}
      />
      )}
    </div>
  );
}

