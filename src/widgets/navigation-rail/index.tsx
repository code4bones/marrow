import {
  ApartmentOutlined,
  AuditOutlined,
  BugOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  PartitionOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Menu, Typography } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../shared/model/auth.store';

const items = [
  { key: '/projects', icon: <FolderOpenOutlined />, label: 'Projects' },
  { key: '/tasks', icon: <AuditOutlined />, label: 'Tasks' },
  { key: '/decisions', icon: <PartitionOutlined />, label: 'Decisions' },
  { key: '/faults', icon: <BugOutlined />, label: 'Faults' },
  { key: '/artifacts', icon: <DatabaseOutlined />, label: 'Artifacts' },
  { key: '/events', icon: <ThunderboltOutlined />, label: 'Events' },
  { key: '/common', icon: <ApartmentOutlined />, label: 'Common' },
  { key: '/diagnostics', icon: <CloudServerOutlined />, label: 'Diagnostics' },
];

export function NavigationRail() {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((s) => s.logout);

  const selectedKey = items.find((i) => location.pathname.startsWith(i.key))?.key ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 16px 8px' }}>
        <Typography.Text strong style={{ fontSize: 13, letterSpacing: 1 }}>
          PMEM UI
        </Typography.Text>
      </div>
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={items}
        style={{ flex: 1, borderRight: 0 }}
        onClick={({ key }) => navigate(key)}
      />
      <div style={{ padding: 12, borderTop: '1px solid #303030' }}>
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
