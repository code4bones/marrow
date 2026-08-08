import { useQuery } from '@apollo/client/react';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BugOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  InboxOutlined,
  LinkOutlined,
  LogoutOutlined,
  PartitionOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Avatar, Badge, Button, Divider, Dropdown, Menu, Tooltip, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import type { MenuProps } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { GET_GATEWAY_VERSION, GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import type { ProjectCounts, ProjectSummary } from '../../shared/model/types';
import { useAuthStore } from '../../shared/model/auth.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

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

function buildProjectSections(counts?: ProjectCounts): ItemType[] {
  return [
    { key: 'overview',   icon: <HomeOutlined />,        label: 'Overview' },
    { key: 'tasks',      icon: <AuditOutlined />,       label: sectionLabel('Tasks', counts?.tasks) },
    { key: 'decisions',  icon: <PartitionOutlined />,   label: sectionLabel('Decisions', counts?.decisions) },
    { key: 'faults',     icon: <BugOutlined />,         label: 'Faults' },
    { key: 'artifacts',  icon: <DatabaseOutlined />,    label: sectionLabel('Artifacts', counts?.artifacts) },
    { key: 'events',     icon: <ThunderboltOutlined />, label: sectionLabel('Events', counts?.events) },
    { key: 'memory',     icon: <InboxOutlined />,       label: sectionLabel('Memory', counts?.items) },
    { key: 'links',      icon: <LinkOutlined />,        label: sectionLabel('Links', counts?.links) },
    { key: 'settings',   icon: <SettingOutlined />,     label: 'Settings' },
  ];
}

const GLOBAL_ITEMS: ItemType[] = [
  { key: 'common', icon: <ApartmentOutlined />, label: 'Common' },
];

function getSelectedKey(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] === 'projects') {
    if (segs.length === 1) return 'projects';
    if (segs.length === 2) return 'overview';
    return segs[2] ?? 'overview';
  }
  return segs[0] ?? '';
}

const ACCOUNT_MENU_ITEMS: MenuProps['items'] = [
  { key: 'profile', icon: <UserOutlined />, label: 'Profile' },
  { type: 'divider' },
  { key: 'logout', icon: <LogoutOutlined />, danger: true, label: 'Logout' },
];

export function NavigationRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const selectedSlug = useWorkspaceStore((s) => s.selectedProjectSlug);
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

  const { data: summaryData } = useQuery<{ projectSummary: ProjectSummary }>(GET_PROJECT_SUMMARY, {
    variables: { project: selectedSlug },
    skip: !selectedSlug,
    fetchPolicy: 'cache-first',
  });
  const projectSections = buildProjectSections(summaryData?.projectSummary?.counts);

  const handleAccountMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'profile') { navigate('/profile'); return; }
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
        <Typography.Text strong style={{ fontSize: 13, letterSpacing: 1 }}>
          MARROW
        </Typography.Text>
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
                Projects
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
                Project
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
              items={GLOBAL_ITEMS}
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
                { key: 'projects', icon: <FolderOpenOutlined />, label: 'Projects' },
                ...GLOBAL_ITEMS,
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
          menu={{ items: ACCOUNT_MENU_ITEMS, onClick: handleAccountMenuClick, selectedKeys: [selectedKey] }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              background: selectedKey === 'profile' ? 'rgba(255,255,255,0.08)' : 'transparent',
            }}
          >
            <Avatar size={24} icon={<UserOutlined />} />
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
