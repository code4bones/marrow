import { Layout } from 'antd';
import { useEffect } from 'react';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { Outlet, useSearchParams } from 'react-router-dom';
import { getEntityType } from '../shared/lib/entityId';
import { useIsMobile } from '../shared/lib/useIsMobile';
import { useWorkspaceStore } from '../shared/model/workspace.store';
import { ResizeHandle } from '../shared/ui/ResizeHandle';
import { DetailDrawer } from '../widgets/detail-drawer';
import { NavigationRail } from '../widgets/navigation-rail';
import { BottomNav } from '../widgets/mobile-nav/BottomNav';
import { MobileHeader } from '../widgets/mobile-nav/MobileHeader';
import { UpdateAnnouncementModal } from '../widgets/update-announcement';

const { Content } = Layout;

// T-context (owner's ask, 2026-08-22): Telegram notification links land
// here (any authenticated route renders AppShell once) carrying ?record=<id>
// -- opens that record straight into the detail drawer instead of leaving
// the owner to hunt for it themselves, then strips the param so a refresh
// or navigating away and back doesn't reopen it.
function useRecordDeepLink() {
  const [searchParams, setSearchParams] = useSearchParams();
  const recordId = searchParams.get('record');
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  useEffect(() => {
    if (!recordId) {
      return;
    }
    setSelectedRecord(recordId, getEntityType(recordId));
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('record');
        return next;
      },
      { replace: true },
    );
  }, [recordId, setSelectedRecord, setSearchParams]);
}

export function AppShell() {
  useRecordDeepLink();
  const isMobile = useIsMobile();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({ id: 'marrow:app-shell' });

  return (
    <Layout style={{ height: '100%' }}>
      {isMobile ? (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <MobileHeader />
          <Content
            style={{
              flex: 1,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              paddingTop: 52,
              // T-context (2026-09-14): BottomNav now renders at the top
              // level too (Projects/Common/Ask Marrow tabs), not just
              // inside a project -- padding is unconditional to match.
              paddingBottom: 56,
            }}
          >
            <Outlet />
          </Content>
          <BottomNav />
        </div>
      ) : (
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          style={{ height: '100%' }}
        >
          <Panel id="nav" defaultSize="15" minSize="10" maxSize="30">
            <div style={{ height: '100%', background: '#001529' }}>
              <NavigationRail />
            </div>
          </Panel>
          <ResizeHandle />
          <Panel id="content" minSize="40">
            <Content style={{ height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Outlet />
            </Content>
          </Panel>
        </Group>
      )}
      <DetailDrawer />
      <UpdateAnnouncementModal />
    </Layout>
  );
}
