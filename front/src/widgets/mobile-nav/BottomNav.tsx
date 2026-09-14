import { AuditOutlined, EllipsisOutlined, FolderOpenOutlined, HomeOutlined, InboxOutlined, PartitionOutlined } from '@ant-design/icons';
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
// [...]"): fixed bottom bar on mobile. Reuses useNavData() (the same
// source NavigationRail's desktop Sider consumes) for selection state and
// the "..." overflow contents, so the two shells never drift out of sync
// as sections are added/removed.
//
// T-context (2026-09-14, owner's ask): originally only rendered inside a
// project ("если выбрано Projects — я вижу сетку плашек... но уже не могу
// выбрать что-то из sidebar (тот же Ask Marrow)... до него можно
// добраться только если провалиться в проект") -- the desktop Sider's
// global items (Projects/Common/Ask Marrow) had NO mobile entry point at
// all outside a project. Now renders at the top level too, with those
// global items as direct tabs (mirrors NavigationRail's own "no project —
// flat list" merge of `[{key:'projects',...}, ...globalItems]") -- no
// "More" needed there since account items (Profile/Notifications/...)
// are already reachable via MobileHeader's own avatar dropdown on every
// screen, project or not.
export function BottomNav() {
  const { t } = useTranslation('nav');
  const isMobile = useIsMobile();
  const { slug } = useParams<{ slug: string }>();
  const [moreOpen, setMoreOpen] = useState(false);
  const { selectedKey, projectSections, globalItems, accountMenuItems, handleMenuClick, handleAccountMenuClick } = useNavData();

  if (!isMobile) return null;

  if (!slug) {
    const topLevelTabs: ItemType[] = [
      { key: 'projects', icon: <FolderOpenOutlined />, label: t('projects') },
      ...globalItems,
    ];
    return (
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
        {topLevelTabs.map((item) => item && 'key' in item && (
          <button key={item.key} onClick={() => handleMenuClick(String(item.key))} style={tabButtonStyle(selectedKey === item.key)}>
            <span style={{ fontSize: 18 }}>{'icon' in item ? item.icon : null}</span>
            {'label' in item ? item.label : null}
          </button>
        ))}
      </nav>
    );
  }

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
