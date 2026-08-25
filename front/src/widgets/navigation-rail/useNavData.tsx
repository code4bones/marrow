import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  AuditOutlined,
  BellOutlined,
  BugOutlined,
  DatabaseOutlined,
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
import { Badge } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import type { MenuProps } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { GET_EVENTS_PAGE, GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import { isNewSince } from '../../shared/lib/isNewSince';
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

export function buildProjectSections(t: (key: string) => string, counts?: ProjectCounts): ItemType[] {
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

export function buildGlobalItems(t: (key: string) => string): ItemType[] {
  return [
    { key: 'common', icon: <ApartmentOutlined />, label: t('common') },
  ];
}

export function getSelectedKey(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] === 'projects') {
    if (segs.length === 1) return 'projects';
    if (segs.length === 2) return 'overview';
    return segs[2] ?? 'overview';
  }
  return segs[0] ?? '';
}

export function buildAccountMenuItems(t: (key: string) => string, isAdmin: boolean, pendingApprovals: number, unreadCount: number): MenuProps['items'] {
  return [
    { key: 'profile', icon: <UserOutlined />, label: t('profile') },
    // T-context (owner's ask): the avatar badge is unreadCount + pendingApprovals
    // combined with no breakdown -- "50, а 50 чего?". Approvals already had its
    // own count here; Notifications didn't, so there was no way to tell the two
    // apart without opening each page. Both menu items now show their own share.
    { key: 'notifications', icon: <BellOutlined />, label: sectionLabel(t('notifications'), unreadCount) },
    ...(isAdmin ? [{ key: 'approvals', icon: <UserAddOutlined />, label: sectionLabel(t('approvals'), pendingApprovals) }] : []),
    ...(isAdmin ? [{ key: 'users', icon: <TeamOutlined />, label: t('users') }] : []),
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, danger: true, label: t('logout') },
  ];
}

// T-context (2026-08-26, owner's ask: mobile PWA layout): NavigationRail's
// live data/handlers used to live inline in that one component. Extracted
// here so the new mobile shell (MobileHeader/BottomNav/MoreDrawer) can
// consume the exact same sections/counts/handlers instead of re-querying
// and re-deriving them -- one source of truth for both desktop Sider and
// mobile nav. Apollo's cache-first GET_PROJECT_SUMMARY query dedupes across
// simultaneous subscribers, so calling this hook from multiple mounted
// components is not a double-fetch concern.
export function useNavData() {
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
  // T-MEMORY-051: keep nav badge counts live without a manual refresh.
  useRefetchOnVersion(
    useRealtimeStore((s) => s.tasksVersion + s.decisionsVersion + s.artifactsVersion + s.memoryVersion + s.linksVersion + s.eventsVersion),
    refetchSummary,
  );
  const projectSections = buildProjectSections(t, summaryData?.projectSummary?.counts);
  const globalItems = buildGlobalItems(t);
  const accountMenuItems = buildAccountMenuItems(t, isAdmin, pendingApprovals, unreadCount);

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

  return {
    t,
    user,
    isAdmin,
    selectedSlug,
    selectedKey,
    unreadCount,
    pendingApprovals,
    projectSections,
    globalItems,
    accountMenuItems,
    handleAccountMenuClick,
    handleMenuClick,
    handleBack,
  };
}
