import { Spin } from 'antd';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../../shared/model/auth.store';
import { ArtifactsPage } from '../../pages/artifacts';
import { CommonPage } from '../../pages/common';
import { DecisionsPage } from '../../pages/decisions';
import { DiagnosticsPage } from '../../pages/diagnostics';
import { EventsPage } from '../../pages/events';
import { FaultsPage } from '../../pages/faults';
import { LinksPage } from '../../pages/links';
import { LoginPage } from '../../pages/login';
import { MemoryPage } from '../../pages/memory';
import { ProjectsPage } from '../../pages/projects';
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
  return status === 'authenticated' ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRouter() {
  const status = useAuthStore((s) => s.status);
  const checkSession = useAuthStore((s) => s.checkSession);

  useEffect(() => {
    if (status === 'checking') {
      void checkSession();
    }
  }, [status, checkSession]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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

        {/* Global */}
        <Route path="common"      element={<CommonPage />} />
        <Route path="diagnostics" element={<DiagnosticsPage />} />
      </Route>
    </Routes>
  );
}
