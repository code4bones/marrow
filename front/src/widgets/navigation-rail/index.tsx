import { useQuery } from '@apollo/client/react';
import { ArrowLeftOutlined, FolderOpenOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Badge, Button, Divider, Dropdown, Menu, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { GET_GATEWAY_VERSION } from '../../shared/api/queries';
import { MarrowMark } from '../../shared/ui/MarrowMark';
import { useNavData } from './useNavData';

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

export function NavigationRail() {
  const { t } = useTranslation('nav');
  const {
    user,
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
  } = useNavData();

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
              items={globalItems}
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
                ...globalItems,
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
          menu={{ items: accountMenuItems, onClick: handleAccountMenuClick, selectedKeys: [selectedKey] }}
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
            <Tooltip title={t('accountBadgeHint', { unread: unreadCount, approvals: pendingApprovals })}>
              <Badge count={unreadCount + pendingApprovals} size="small" overflowCount={99}>
                <Avatar size={24} icon={<UserOutlined />} />
              </Badge>
            </Tooltip>
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
