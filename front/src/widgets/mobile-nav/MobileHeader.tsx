import { ArrowLeftOutlined, UserOutlined } from '@ant-design/icons';
import { Avatar, Badge, Dropdown, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { GlobalSearchBox } from '../project-overview/GlobalSearchBox';
import { MarrowMark } from '../../shared/ui/MarrowMark';
import { useNavData } from '../navigation-rail/useNavData';

// T-context (2026-08-26, owner's ask: mobile PWA layout, "сверху — как и
// принято для мобилок — header + omni search + profile"): replaces the
// desktop project-overview header row (title | search | share) on narrow
// viewports -- fixed top bar, same account-menu data as the desktop
// NavigationRail via useNavData() so nothing drifts between the two shells.
export function MobileHeader() {
  const { t } = useTranslation('nav');
  const { slug } = useParams<{ slug: string }>();
  const {
    selectedKey,
    unreadCount,
    pendingApprovals,
    accountMenuItems,
    handleAccountMenuClick,
    handleBack,
  } = useNavData();

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        height: 52,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        background: '#141414',
        borderBottom: '1px solid #303030',
      }}
    >
      {slug ? (
        <>
          <button
            onClick={handleBack}
            aria-label={t('projects')}
            style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.65)', fontSize: 18, padding: 4, cursor: 'pointer' }}
          >
            <ArrowLeftOutlined />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <GlobalSearchBox slug={slug} fullWidth />
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
          <MarrowMark size={18} />
          <Typography.Text strong style={{ fontSize: 13, letterSpacing: 1 }}>
            MARROW
          </Typography.Text>
        </div>
      )}

      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{ items: accountMenuItems, onClick: handleAccountMenuClick, selectedKeys: [selectedKey] }}
      >
        <div style={{ display: 'flex', cursor: 'pointer' }}>
          <Tooltip title={t('accountBadgeHint', { unread: unreadCount, approvals: pendingApprovals })}>
            <Badge count={unreadCount + pendingApprovals} size="small" overflowCount={99}>
              <Avatar size={28} icon={<UserOutlined />} />
            </Badge>
          </Tooltip>
        </div>
      </Dropdown>
    </div>
  );
}
