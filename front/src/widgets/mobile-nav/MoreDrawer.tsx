import { Divider, Drawer, Menu } from 'antd';
import type { MenuProps } from 'antd';
import type { ItemType } from 'antd/es/menu/interface';
import { useTranslation } from 'react-i18next';

interface MoreDrawerProps {
  open: boolean;
  onClose: () => void;
  selectedKey: string;
  sections: ItemType[];
  globalItems: ItemType[];
  accountMenuItems: MenuProps['items'];
  onSectionClick: (key: string) => void;
  onAccountClick: MenuProps['onClick'];
}

// T-context (2026-08-26, owner's ask: mobile PWA layout, "[...] — открывает
// остальное меню"): bottom-sheet holding everything BottomNav's 3 promoted
// items didn't fit -- same projectSections/globalItems/accountMenuItems
// from useNavData() the desktop Sider uses, so a new section added there
// automatically shows up here too instead of needing a second edit.
export function MoreDrawer({ open, onClose, selectedKey, sections, globalItems, accountMenuItems, onSectionClick, onAccountClick }: MoreDrawerProps) {
  const { t } = useTranslation('nav');
  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="bottom"
      height="60%"
      title={t('more')}
      styles={{ body: { padding: '8px 0' } }}
    >
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={sections}
        style={{ borderRight: 0 }}
        onClick={({ key }) => { onClose(); onSectionClick(key); }}
      />
      <Divider style={{ margin: '8px 0', borderColor: '#303030' }} />
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={globalItems}
        style={{ borderRight: 0 }}
        onClick={({ key }) => { onClose(); onSectionClick(key); }}
      />
      <Divider style={{ margin: '8px 0', borderColor: '#303030' }} />
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={accountMenuItems}
        style={{ borderRight: 0 }}
        onClick={(info) => { onClose(); onAccountClick?.(info); }}
      />
    </Drawer>
  );
}
