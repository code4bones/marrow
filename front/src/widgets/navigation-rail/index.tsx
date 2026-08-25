import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BellOutlined,
  BugOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  InboxOutlined,
  LinkOutlined,
  LogoutOutlined,
  PartitionOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserAddOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Badge, Button, Divider, Dropdown, Menu, Tooltip, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import type { MenuProps } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { GET_EVENTS_PAGE, GET_GATEWAY_VERSION, GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import { isNewSince } from '../../shared/lib/isNewSince';
import { MarrowMark } from '../../shared/ui/MarrowMark';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import type { Event, Paginated, ProjectCounts, ProjectSummary } from '../../shared/model/types';
import { useAuthStore } from '../../shared/model/auth.store';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

// T-MEMORY-051: how far back the badge looks for unread events. A small
// window (not the full global feed) is enough to compute an accurate count
// against any realistic notifications_seen_at, and keeps this query cheap
// since it polls on every realtime version bump.
const UNREAD_WINDOW_SIZE = 50;

interface GatewayVersionData {
  gatewayVersion: { packageVersion?: string } | null;
}

/** "front vX.Y.Z · back vA.B.C" under the logo — silently omits the back half until the query resolves. */
function VersionLine() {
  const { data } = useQuery<GatewayVersionData>(GET_GATEWAY_VERSION, { fetchPolicy: 'cache-first' });
  const backVersion = data?.gatewayVersion?.packageVersion;
  return (
    <Tooltip title={backVersion ? `Frontend v${__APP_VERSION__} · Backend v${backVersion}` : `Frontend v${__APP_VERSION__}`}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 10, letterSpacing: 0.3, display: 'block', marginTop: 2, cursor: 'default' }}
      >
        v{__APP_VERSION__}
        {backVersion ? ` · api v${backVersion}` : ''}
      </Typography.Text>
    </Tooltip>
  );
}

function sectionLabel(text: string, count?: number): React.ReactNode {
  if (count == null) return text;
  return (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
      {text}
      <Badge
        count={count}
        overflowCount={999}
        showZero
        color={count > 0 ? '#177ddc' : 'rgba(255,255,255,0.15)'}
        style={{ boxShadow: 'none' }}
      />
    </span>
  );
}

function buildProjectSections(t: (key: string) => string, counts?: ProjectCounts): ItemType[] {
  return [
    { key: 'overview',   icon: <HomeOutlined />,        label: t('overview') },
    { key: 'tasks',      icon: <AuditOutlined />,       label: sectionLabel(t('tasks'), counts?.tasks) },
    { key: 'decisions',  icon: <PartitionOutlined />,   label: sectionLabel(t('decisions'), counts?.decisions) },
    { key: 'faults',     icon: <BugOutlined />,         label: sectionLabel(t('faults'), counts?.faults) },
    { key: 'artifacts',  icon: <DatabaseOutlined />,    label: sectionLabel(t('artifacts'), counts?.artifacts) },
    { key: 'events',     icon: <ThunderboltOutlined />, label: sectionLabel(t('events'), counts?.events) },
    { key: 'memory',     icon: <InboxOutlined />,       label: sectionLabel(t('memory'), counts?.items) },
    { key: 'links',      icon: <LinkOutlined />,        label: sectionLabel(t('links'), counts?.links) },
    { key: 'settings',   icon: <SettingOutlined />,     label: t('settings') },
  ];
}

function buildGlobalItems(t: (key: string) => string): ItemType[] {
  return [
    { key: 'common', icon: <ApartmentOutlined />, label: t('common') },
  ];
}

function getSelectedKey(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] === 'projects') {
    if (segs.length === 1) return 'projects';
    if (segs.length === 2) return 'overview';
    return segs[2] ?? 'overview';
  }
  return segs[0] ?? '';
}

function buildAccountMenuItems(t: (key: string) => string, isAdmin: boolean, pendingApprovals: number): MenuProps['items'] {
  return [
    { key: 'profile', icon: <UserOutlined />, label: t('profile') },
    { key: 'notifications', icon: <BellOutlined />, label: t('notifications') },
    ...(isAdmin ? [{ key: 'approvals', icon: <UserAddOutlined />, label: sectionLabel(t('approvals'), pendingApprovals) }] : []),
    ...(isAdmin ? [{ key: 'users', icon: <TeamOutlined />, label: t('users') }] : []),
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, danger: true, label: t('logout') },
  ];
}

export function NavigationRail() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const notificationsSeenAt = useAuthStore((s) => s.notificationsSeenAt);
  const fetchNotificationsSeenAt = useAuthStore((s) => s.fetchNotificationsSeenAt);
  const selectedSlug = useWorkspaceStore((s) => s.selectedProjectSlug);
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);
  const fetchPendingUsers = useAuthStore((s) => s.fetchPendingUsers);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    void fetchNotificationsSeenAt();
  }, [fetchNotificationsSeenAt]);

  // Backend now emits user.registration_pending/user.approved/user.rejected
  // as real gateway events (common-scope, projectId: null) on every
  // registration lifecycle change, so this refreshes on the same WS
  // eventsVersion bump as everything else instead of polling.
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const refreshPendingApprovals = () => {
    if (!isAdmin) return;
    fetchPendingUsers()
      .then((users) => setPendingApprovals(users.length))
      .catch(() => { /* transient — next event retries */ });
  };
  useEffect(refreshPendingApprovals, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), refreshPendingApprovals);

  // T-MEMORY-051: unread badge — a small recent-events window, re-fetched on
  // every realtime version bump the same way the dedicated pages are.
  const { data: unreadEventsData, refetch: refetchUnreadEvents } = useQuery<{ eventsPage: Paginated<Event> }>(
    GET_EVENTS_PAGE,
    { variables: { limit: UNREAD_WINDOW_SIZE, offset: 0 } },
  );
  useRefetchOnVersion(useRealtimeStore((s) => s.eventsVersion), refetchUnreadEvents);
  const unreadCount = (unreadEventsData?.eventsPage.items ?? []).filter((event) =>
    isNewSince(event.createdAt, notificationsSeenAt),
  ).length;

  const { data: summaryData, refetch: refetchSummary } = useQuery<{ projectSummary: ProjectSummary }>(GET_PROJECT_SUMMARY, {
    variables: { project: selectedSlug },
    skip: !selectedSlug,
    fetchPolicy: 'cache-first',
  });
  // T-MEMORY-051: keep nav-rail badge counts live without a manual refresh.
  useRefetchOnVersion(
    useRealtimeStore((s) => s.tasksVersion + s.decisionsVersion + s.artifactsVersion + s.memoryVersion + s.linksVersion + s.eventsVersion),
    refetchSummary,
  );
  const projectSections = buildProjectSections(t, summaryData?.projectSummary?.counts);

  const handleAccountMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'profile') { navigate('/profile'); return; }
    if (key === 'notifications') { navigate('/notifications'); return; }
    if (key === 'approvals') { navigate('/approvals'); return; }
    if (key === 'users') { navigate('/users'); return; }
    if (key === 'logout') { void logout(); }
  };

  const selectedKey = getSelectedKey(location.pathname);

  const handleBack = () => {
    setSelectedProject(null);
    navigate('/projects');
  };

  const handleMenuClick = (key: string) => {
    if (key === 'common') { navigate('/common'); return; }
    if (key === 'projects') { navigate('/projects'); return; }
    if (!selectedSlug) return;
    navigate(key === 'overview' ? `/projects/${selectedSlug}` : `/projects/${selectedSlug}/${key}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo */}
      <div style={{ padding: '16px 16px 8px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <MarrowMark size={20} />
          <Typography.Text strong style={{ fontSize: 13, letterSpacing: 1 }}>
            MARROW
          </Typography.Text>
        </div>
        <VersionLine />
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {selectedSlug ? (
          <>
            {/* Back button */}
            <div style={{ padding: '4px 8px 0' }}>
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                size="small"
                onClick={handleBack}
                style={{ width: '100%', textAlign: 'left', color: 'rgba(255,255,255,0.35)', fontSize: 12 }}
              >
                {t('projects')}
              </Button>
            </div>

            {/* Project name — prominent */}
            <div
              style={{
                margin: '8px 10px 4px',
                padding: '10px 12px',
                background: 'rgba(255,255,255,0.06)',
                borderRadius: 6,
                borderLeft: '3px solid #177ddc',
              }}
            >
              <Typography.Text
                type="secondary"
                style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 3 }}
              >
                {t('project')}
              </Typography.Text>
              <Typography.Text
                strong
                style={{
                  fontSize: 14,
                  color: '#fff',
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.3,
                }}
                title={selectedSlug}
              >
                {selectedSlug}
              </Typography.Text>
            </div>

            {/* Project sections */}
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[selectedKey]}
              items={projectSections}
              style={{ borderRight: 0, flex: 0 }}
              onClick={({ key }) => handleMenuClick(key)}
            />

            <Divider style={{ margin: '8px 0', borderColor: '#303030' }} />

            {/* Global */}
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[selectedKey]}
              items={buildGlobalItems(t)}
              style={{ borderRight: 0 }}
              onClick={({ key }) => handleMenuClick(key)}
            />
          </>
        ) : (
          <>
            {/* No project — show flat list */}
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[selectedKey]}
              items={[
                { key: 'projects', icon: <FolderOpenOutlined />, label: t('projects') },
                ...buildGlobalItems(t),
              ]}
              style={{ borderRight: 0 }}
              onClick={({ key }) => handleMenuClick(key)}
            />
          </>
        )}
      </div>

      {/* Account */}
      <div style={{ padding: 8, borderTop: '1px solid #303030', flexShrink: 0 }}>
        <Dropdown
          trigger={['click']}
          placement="top"
          menu={{ items: buildAccountMenuItems(t, isAdmin, pendingApprovals), onClick: handleAccountMenuClick, selectedKeys: [selectedKey] }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              background: ['profile', 'notifications', 'approvals', 'users'].includes(selectedKey) ? 'rgba(255,255,255,0.08)' : 'transparent',
            }}
          >
            <Badge count={unreadCount + pendingApprovals} size="small" overflowCount={99}>
              <Avatar size={24} icon={<UserOutlined />} />
            </Badge>
            <Typography.Text
              style={{
                flex: 1,
                fontSize: 12,
                color: 'rgba(255,255,255,0.85)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={user?.email}
            >
              {user?.email ?? '...'}
            </Typography.Text>
          </div>
        </Dropdown>
      </div>
    </div>
  );
}
