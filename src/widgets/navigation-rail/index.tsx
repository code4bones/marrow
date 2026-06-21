import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  AuditOutlined,
  BugOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  LogoutOutlined,
  PartitionOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Divider, Menu, Typography } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../shared/model/auth.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

const PROJECT_SECTIONS: ItemType[] = [
  { key: 'overview',   icon: <HomeOutlined />,        label: 'Overview' },
  { key: 'tasks',      icon: <AuditOutlined />,       label: 'Tasks' },
  { key: 'decisions',  icon: <PartitionOutlined />,   label: 'Decisions' },
  { key: 'faults',     icon: <BugOutlined />,         label: 'Faults' },
  { key: 'artifacts',  icon: <DatabaseOutlined />,    label: 'Artifacts' },
  { key: 'events',     icon: <ThunderboltOutlined />, label: 'Events' },
];

const GLOBAL_ITEMS: ItemType[] = [
  { key: 'common',      icon: <ApartmentOutlined />,  label: 'Common' },
  { key: 'diagnostics', icon: <CloudServerOutlined />, label: 'Diagnostics' },
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

export function NavigationRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);
  const selectedSlug = useWorkspaceStore((s) => s.selectedProjectSlug);
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

  const selectedKey = getSelectedKey(location.pathname);

  const handleBack = () => {
    setSelectedProject(null);
    navigate('/projects');
  };

  const handleMenuClick = (key: string) => {
    if (key === 'common') { navigate('/common'); return; }
    if (key === 'diagnostics') { navigate('/diagnostics'); return; }
    if (key === 'projects') { navigate('/projects'); return; }
    if (!selectedSlug) return;
    navigate(key === 'overview' ? `/projects/${selectedSlug}` : `/projects/${selectedSlug}/${key}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Logo */}
      <div style={{ padding: '16px 16px 8px', flexShrink: 0 }}>
        <Typography.Text strong style={{ fontSize: 13, letterSpacing: 1 }}>
          PMEM UI
        </Typography.Text>
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
              items={PROJECT_SECTIONS}
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

      {/* Logout */}
      <div style={{ padding: 12, borderTop: '1px solid #303030', flexShrink: 0 }}>
        <Button
          type="text"
          icon={<LogoutOutlined />}
          danger
          size="small"
          onClick={logout}
          style={{ width: '100%', textAlign: 'left' }}
        >
          Logout
        </Button>
      </div>
    </div>
  );
}
