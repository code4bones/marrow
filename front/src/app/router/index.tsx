import { Spin } from 'antd';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../../shared/model/auth.store';
import { RealtimeProvider } from '../providers/RealtimeProvider';
import { ArtifactsPage } from '../../pages/artifacts';
import { ClaimPage } from '../../pages/claim';
import { CommonPage } from '../../pages/common';
import { DecisionsPage } from '../../pages/decisions';
import { EventsPage } from '../../pages/events';
import { FaultsPage } from '../../pages/faults';
import { LinksPage } from '../../pages/links';
import { LoginPage } from '../../pages/login';
import { MemoryPage } from '../../pages/memory';
import { NotificationsPage } from '../../pages/notifications';
import { OAuthAuthorizePage } from '../../pages/oauth-authorize';
import { ProfilePage } from '../../pages/profile';
import { ProjectInvitePage } from '../../pages/project-invite';
import { ProjectsPage } from '../../pages/projects';
import { ProjectSettingsPage } from '../../pages/projects/settings';
import { RegisterPage } from '../../pages/register';
import { TasksPage } from '../../pages/tasks';
import { AppShell } from '../AppShell';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'checking') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }
  return status === 'authenticated' ? (
    <>
      <RealtimeProvider />
      {children}
    </>
  ) : (
    <Navigate to="/login" replace />
  );
}

export function AppRouter() {
  const status = useAuthStore((s) => s.status);
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    if (status === 'checking') {
      void initialize();
    }
  }, [status, initialize]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/claim" element={<ClaimPage />} />
      <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
      <Route path="/invite/:code" element={<ProjectInvitePage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />

        {/* Project list */}
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:slug" element={<ProjectsPage />} />

        {/* Project sections */}
        <Route path="projects/:slug/tasks"      element={<TasksPage />} />
        <Route path="projects/:slug/decisions"  element={<DecisionsPage />} />
        <Route path="projects/:slug/faults"     element={<FaultsPage />} />
        <Route path="projects/:slug/artifacts"  element={<ArtifactsPage />} />
        <Route path="projects/:slug/events"     element={<EventsPage />} />
        <Route path="projects/:slug/memory"     element={<MemoryPage />} />
        <Route path="projects/:slug/links"      element={<LinksPage />} />
        <Route path="projects/:slug/settings"   element={<ProjectSettingsPage />} />

        {/* Global */}
        <Route path="common"        element={<CommonPage />} />
        <Route path="profile"       element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
    </Routes>
  );
}
