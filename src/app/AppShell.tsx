import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { NavigationRail } from '../widgets/navigation-rail';

const { Sider, Content } = Layout;

export function AppShell() {
  return (
    <Layout style={{ height: '100%' }}>
      <Sider width={220} theme="dark" style={{ borderRight: '1px solid #303030' }}>
        <NavigationRail />
      </Sider>
      <Layout>
        <Content style={{ padding: 24, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
