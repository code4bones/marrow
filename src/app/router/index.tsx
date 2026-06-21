import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuthStore } from '../../shared/model/auth.store';
import { LoginPage } from '../../pages/login';
import { ProjectsPage } from '../../pages/projects';
import { DiagnosticsPage } from '../../pages/diagnostics';
import { AppShell } from '../AppShell';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRouter() {
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
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:slug" element={<ProjectsPage />} />
        <Route path="projects/:slug/:section" element={<ProjectsPage />} />
        <Route path="diagnostics" element={<DiagnosticsPage />} />
      </Route>
    </Routes>
  );
}
