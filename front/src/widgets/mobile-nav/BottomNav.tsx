import { AuditOutlined, EllipsisOutlined, HomeOutlined, InboxOutlined, PartitionOutlined } from '@ant-design/icons';
import type { ItemType } from 'antd/es/menu/interface';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useIsMobile } from '../../shared/lib/useIsMobile';
import { useNavData } from '../navigation-rail/useNavData';
import { MoreDrawer } from './MoreDrawer';

// T-context (2026-08-26, owner's ask: "главный то экран у нас Overview, в
// bottom bar, перед Tasks"): Overview leads the promoted row -- it's the
// mobile home for a project, not just another section.
const PROMOTED: Array<{ key: string; icon: React.ReactNode }> = [
  { key: 'overview', icon: <HomeOutlined /> },
  { key: 'tasks', icon: <AuditOutlined /> },
  { key: 'decisions', icon: <PartitionOutlined /> },
  { key: 'memory', icon: <InboxOutlined /> },
];
const PROMOTED_KEYS = new Set(PROMOTED.map((p) => p.key));

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 11,
    color: active ? '#177ddc' : 'rgba(255,255,255,0.65)',
  };
}

// T-context (2026-08-26, owner's ask: mobile PWA layout, "bottom nav bar —
// самые значимые места — [Tasks][Decisions][Mem], на что не хватило места
// [...]"): fixed bottom bar shown only inside a project on mobile. Reuses
// useNavData() (the same source NavigationRail's desktop Sider consumes)
// for selection state and the "..." overflow contents, so the two shells
// never drift out of sync as sections are added/removed.
export function BottomNav() {
  const { t } = useTranslation('nav');
  const isMobile = useIsMobile();
  const { slug } = useParams<{ slug: string }>();
  const [moreOpen, setMoreOpen] = useState(false);
  const { selectedKey, projectSections, globalItems, accountMenuItems, handleMenuClick, handleAccountMenuClick } = useNavData();

  if (!isMobile || !slug) return null;

  const restSections = projectSections.filter(
    (item): item is ItemType & { key: string } => item != null && 'key' in item && !PROMOTED_KEYS.has(String(item.key)),
  );

  return (
    <>
      <nav
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          display: 'flex',
          height: 56,
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: '#141414',
          borderTop: '1px solid #303030',
        }}
      >
        {PROMOTED.map(({ key, icon }) => (
          <button key={key} onClick={() => handleMenuClick(key)} style={tabButtonStyle(selectedKey === key)}>
            <span style={{ fontSize: 18 }}>{icon}</span>
            {t(key)}
          </button>
        ))}
        <button onClick={() => setMoreOpen(true)} style={tabButtonStyle(false)}>
          <span style={{ fontSize: 18 }}>
            <EllipsisOutlined />
          </span>
          {t('more')}
        </button>
      </nav>
      <MoreDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        selectedKey={selectedKey}
        sections={restSections}
        globalItems={globalItems}
        accountMenuItems={accountMenuItems}
        onSectionClick={handleMenuClick}
        onAccountClick={handleAccountMenuClick}
      />
    </>
  );
}
