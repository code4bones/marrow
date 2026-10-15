import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Card, Col, Input, List, Pagination, Row, Skeleton, Tag, Tooltip, Typography } from 'antd';
import type { PaginationProps } from 'antd';
import { ClockCircleOutlined, PushpinFilled, PushpinOutlined, SortAscendingOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { CreateProjectModal } from '../../features/project/CreateProjectModal';
import { ResizeHandle } from '../../shared/ui/ResizeHandle';
import { GET_PROJECT_GROUP_MEMBERS, GET_PROJECTS_PAGE, PIN_PROJECT } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { usePage } from '../../shared/lib/usePage';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useUserPreference } from '../../shared/lib/useUserPreference';
import type { Paginated, Project } from '../../shared/model/types';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';
import { VersionTag } from '../../shared/ui/VersionTag';
import { ProjectOverview } from '../../widgets/project-overview';

// T-MEMORY-086: pin toggle -- stops the click from also bubbling to the
// row/card's own onClick (navigate into the project), same as every other
// per-row action button in this app (DeleteTaskButton etc).
function PinButton({ project, onDone }: { project: Project; onDone: () => void }) {
  const { t } = useTranslation('projects');
  const [mutate, { loading }] = useMutation(PIN_PROJECT, { onCompleted: onDone });
  return (
    <Tooltip title={project.pinned ? t('unpin') : t('pin')}>
      <Button
        size="small"
        type="text"
        icon={project.pinned ? <PushpinFilled style={{ color: '#d89614' }} /> : <PushpinOutlined />}
        loading={loading}
        onClick={(e) => {
          e.stopPropagation();
          void mutate({ variables: { id: project.id, pinned: !project.pinned } });
        }}
      />
    </Tooltip>
  );
}

// Owner's ask (2026-10-15): a project_group membership is purely logical
// (no folder, no separate entity on screen) -- its only visual effect is
// pulling co-visible members of the same `key` adjacent to each other in
// this already-sorted/searched list (at the position of whichever member
// appears first) so GroupConnector can be drawn between them. A member
// whose group-mate didn't make this page (filtered out by search, on a
// different page) just renders as an ordinary solo row -- no connector to
// something off-screen.
function groupProjectsByMembership(
  projects: Project[],
  members: { key: string; projectId: string }[],
): Project[][] {
  const keyByProjectId = new Map<string, string>();
  for (const m of members) {
    // A project in more than one group keeps its first membership here --
    // picking one key is enough for this visual-only clustering.
    if (!keyByProjectId.has(m.projectId)) keyByProjectId.set(m.projectId, m.key);
  }
  const groups: Project[][] = [];
  const groupIndexByKey = new Map<string, number>();
  for (const p of projects) {
    const key = keyByProjectId.get(p.id);
    if (key === undefined) {
      groups.push([p]);
      continue;
    }
    let idx = groupIndexByKey.get(key);
    if (idx === undefined) {
      idx = groups.length;
      groupIndexByKey.set(key, idx);
      groups.push([]);
    }
    groups[idx].push(p);
  }
  return groups;
}

// Timeline's own connector between stacked cards (DecisionTimeline.tsx's
// GapRow) is the same idea at a bigger scale -- a plain dashed line, no
// canvas/library, just enough to read as "these belong together."
function GroupConnector() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 1, height: 8, borderLeft: '1px dashed #595959' }} />
    </div>
  );
}

function ProjectRow({
  project,
  active,
  author,
  onClick,
  onPinDone,
}: {
  project: Project;
  active: boolean;
  author: string | undefined;
  onClick: () => void;
  onPinDone: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: 'pointer',
        padding: '8px 10px',
        borderRadius: 4,
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
        <Typography.Text strong style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.title}
        </Typography.Text>
        <StatusBadge status={project.status} />
        <PinButton project={project} onDone={onPinDone} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0 }}>
        <Tag color="orange" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>{project.slug}</Tag>
        {project.lastVersion && <VersionTag value={project.lastVersion} maxWidth={90} />}
      </div>
      <Timestamp value={project.updatedAt} author={author} />
    </div>
  );
}

// Below this page count, antd's own `showLessItems` truncation gives up and
// shows every page number (rc-pagination's "allPages <= 3 + bufferSize*2"
// check, bufferSize=1 here -- threshold 5) -- too wide for the 240px
// sidebar even at just 5 pages. Takes over purely for that narrow window;
// a page count above it already gets antd's own jump-prev/jump-next
// truncation, left untouched here.
const COMPACT_THRESHOLD = 5;

function compactPageItemRender(current: number, totalPages: number): NonNullable<PaginationProps['itemRender']> {
  return (page, type, element) => {
    if (type !== 'page' || totalPages > COMPACT_THRESHOLD) return element;

    const isBoundary = page === 1 || page === totalPages;
    const isNeighbor = Math.abs(page - current) <= 1;
    if (isBoundary || isNeighbor) return element;

    // One inert "…" per hidden run, placed right after the left run or
    // right before the right one; every other hidden page renders nothing.
    const isGapMarker = (page === 2 && current > 3) || (page === totalPages - 1 && current < totalPages - 2);
    if (isGapMarker) {
      return (
        <span onClick={(e) => e.stopPropagation()} style={{ cursor: 'default', padding: '0 4px' }}>
          …
        </span>
      );
    }
    return null;
  };
}

export function ProjectsPage() {
  const { t } = useTranslation('projects');
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'marrow:projects-page' });

  useEffect(() => {
    if (slug) setSelectedProject(slug);
  }, [slug, setSelectedProject]);

  const [sort, setSort] = useUserPreference<'slug' | 'createdAt'>('projectsSortOrder', 'slug');
  const { page, pageSize, offset, onChange } = usePage(20);
  // T-MEMORY-088: server-side full-text search (title/slug/description,
  // plus a plain match on the owner's email) -- transient UI state, not a
  // server-persisted preference like sort order, since there's no reason
  // to remember a search string across visits. Every keystroke re-runs the
  // query (same as the Faults page's search box), no debounce.
  const [search, setSearch] = useState('');
  const { data, loading, error, refetch } = useQuery<{ projectsPage: Paginated<Project> }>(GET_PROJECTS_PAGE, {
    variables: { sort, search: search.trim() || undefined, limit: pageSize, offset },
  });
  useRefetchOnVersion(useRealtimeStore((s) => s.projectsVersion), refetch);

  const { data: groupData } = useQuery<{ projectGroupMembers: { key: string; projectId: string }[] }>(
    GET_PROJECT_GROUP_MEMBERS,
  );

  const projects = useMemo(() => data?.projectsPage.items ?? [], [data]);
  const pageInfo = data?.projectsPage.pageInfo;
  const totalPages = pageInfo?.totalCount ? Math.ceil(pageInfo.totalCount / pageSize) : 1;
  const { labelFor } = useActorLabels(projects.map((p) => p.createdBy));
  const groupedProjects = useMemo(
    () => groupProjectsByMembership(projects, groupData?.projectGroupMembers ?? []),
    [projects, groupData],
  );

  // T-context (2026-08-26, owner's ask: mobile PWA layout, "на стартовом
  // экране плитки проектов, все идет через проваливание в них"): mobile
  // never shows list+detail side by side -- a project selected on a phone
  // means the tile grid gets out of the way entirely and MobileHeader's
  // back button (AppShell) returns here by clearing the route, not by any
  // state this page owns.
  if (isMobile) {
    if (slug) {
      // I-MEMORY-128/131: `key` forces a full unmount/remount of this whole
      // subtree on every project switch, instead of React reusing the same
      // ProjectOverview/ProjectGraphView instance across different `slug`
      // props. Without it, Apollo's per-hook ObservableQuery subscriptions
      // for the OLD project were never fully torn down before the NEW
      // project's queries started -- revisiting an already-cached project
      // touched off a runaway cross-project refetch storm (see apollo.ts's
      // nextFetchPolicy comment for the first half of this fix, which
      // capped it but didn't eliminate it). Apollo's cache itself is a
      // module-level singleton untouched by this remount, so the instant
      // cache-paint on revisit is unaffected -- only the live subscriptions
      // get a clean teardown/recreate.
      return <ProjectOverview key={slug} slug={slug} />;
    }
    return (
      <div style={{ height: '100%', overflowY: 'auto', padding: '12px 12px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Input.Search
            placeholder={t('searchProjectsPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); onChange(1, pageSize); }}
            allowClear
            style={{ flex: 1 }}
          />
          <CreateProjectModal onDone={() => refetch()} />
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <Button
            size="small"
            type={sort === 'slug' ? 'primary' : 'default'}
            icon={<SortAscendingOutlined />}
            onClick={() => { setSort('slug'); onChange(1, pageSize); }}
          >
            {t('sortAlphabetical')}
          </Button>
          <Button
            size="small"
            type={sort === 'createdAt' ? 'primary' : 'default'}
            icon={<ClockCircleOutlined />}
            onClick={() => { setSort('createdAt'); onChange(1, pageSize); }}
          >
            {t('sortNewestFirst')}
          </Button>
        </div>

        {loading && <Skeleton active />}
        {error && <Alert type="error" message={error.message} style={{ marginBottom: 12 }} />}
        {data && (
          <>
            <Row gutter={[8, 8]}>
              {projects.map((p) => (
                <Col xs={12} key={p.id}>
                  <Card size="small" hoverable onClick={() => navigate(`/projects/${p.slug}`)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <Typography.Text strong ellipsis style={{ flex: 1, fontSize: 13 }}>
                        {p.title}
                      </Typography.Text>
                      <StatusBadge status={p.status} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Tag color="orange" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>{p.slug}</Tag>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        {p.lastVersion && <VersionTag value={p.lastVersion} maxWidth={70} />}
                        <PinButton project={p} onDone={() => refetch()} />
                      </div>
                    </div>
                    <Timestamp value={p.updatedAt} author={labelFor(p.createdBy)} />
                  </Card>
                </Col>
              ))}
            </Row>
            <Pagination
              className="pagination-wrap"
              size="small"
              showLessItems
              itemRender={compactPageItemRender(page, totalPages)}
              locale={{ items_per_page: '' }}
              current={page}
              pageSize={pageSize}
              total={pageInfo?.totalCount}
              onChange={onChange}
              showSizeChanger
              pageSizeOptions={['10', '20', '50']}
              style={{ marginTop: 16, textAlign: 'center' }}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <Group
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
      style={{ height: '100%' }}
    >
      {/* Left: project list */}
      <Panel id="list" defaultSize="22" minSize="15" maxSize="40">
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* Icon toggle, not a dropdown -- owner: a full-width Select here
                read as oversized for a binary choice in this narrow sidebar.
                Left-aligned, separate from New Project on the right -- owner:
                glued together on one side read as one control. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Tooltip title={t('sortAlphabetical')}>
                <Button
                  size="small"
                  type={sort === 'slug' ? 'primary' : 'text'}
                  icon={<SortAscendingOutlined />}
                  onClick={() => { setSort('slug'); onChange(1, pageSize); }}
                />
              </Tooltip>
              <Tooltip title={t('sortNewestFirst')}>
                <Button
                  size="small"
                  type={sort === 'createdAt' ? 'primary' : 'text'}
                  icon={<ClockCircleOutlined />}
                  onClick={() => { setSort('createdAt'); onChange(1, pageSize); }}
                />
              </Tooltip>
            </div>
            <CreateProjectModal onDone={() => refetch()} />
          </div>

          <div style={{ padding: '0 16px 8px' }}>
            <Input.Search
              placeholder={t('searchProjectsPlaceholder')}
              value={search}
              onChange={(e) => { setSearch(e.target.value); onChange(1, pageSize); }}
              allowClear
              size="small"
            />
          </div>

          {/* T-MEMORY-088 follow-up: owner explicitly wanted the pager right
              under the search box, not List's own default bottom-of-list
              placement (List has no built-in "pagination at top" option,
              unlike Table's pagination.position) -- rendered as a standalone
              Pagination here instead of passed to List's `pagination` prop. */}
          <div style={{ padding: '0 16px 8px' }}>
            <Pagination
              className="pagination-wrap"
              size="small"
              showLessItems
              itemRender={compactPageItemRender(page, totalPages)}
              locale={{ items_per_page: '' }}
              current={page}
              pageSize={pageSize}
              total={pageInfo?.totalCount}
              onChange={onChange}
              showSizeChanger
              pageSizeOptions={['10', '20', '50']}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
            {loading && <Skeleton active style={{ padding: 8 }} />}
            {error && <Alert type="error" message={error.message} style={{ margin: 8 }} />}
            {data && (
              <List<Project[]>
                dataSource={groupedProjects}
                rowKey={(group) => group[0].id}
                renderItem={(group) => (
                  <List.Item style={{ padding: 0, border: 'none', display: 'block' }}>
                    {group.map((p, i) => (
                      <div key={p.id}>
                        {i > 0 && <GroupConnector />}
                        <ProjectRow
                          project={p}
                          active={slug === p.slug}
                          author={labelFor(p.createdBy)}
                          onClick={() => navigate(`/projects/${p.slug}`)}
                          onPinDone={() => refetch()}
                        />
                      </div>
                    ))}
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>
      </Panel>

      <ResizeHandle />

      {/* Right: project content */}
      <Panel id="workspace" minSize="30">
        <div style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {slug ? (
            <ProjectOverview key={slug} slug={slug} />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography.Text type="secondary">{t('selectAProject')}</Typography.Text>
            </div>
          )}
        </div>
      </Panel>
    </Group>
  );
}
