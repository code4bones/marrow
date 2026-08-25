import { Layout } from 'antd';
import { useEffect } from 'react';
import { Outlet, useSearchParams } from 'react-router-dom';
import { getEntityType } from '../shared/lib/entityId';
import { useWorkspaceStore } from '../shared/model/workspace.store';
import { DetailDrawer } from '../widgets/detail-drawer';
import { NavigationRail } from '../widgets/navigation-rail';
import { UpdateAnnouncementModal } from '../widgets/update-announcement';

const { Sider, Content } = Layout;

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
  return (
    <Layout style={{ height: '100%' }}>
      <Sider width={220} theme="dark" style={{ borderRight: '1px solid #303030' }}>
        <NavigationRail />
      </Sider>
      <Layout>
        <Content style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </Content>
      </Layout>
      <DetailDrawer />
      <UpdateAnnouncementModal />
    </Layout>
  );
}
