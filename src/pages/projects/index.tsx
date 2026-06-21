import { useQuery } from '@apollo/client/react';
import { Alert, List, Skeleton, Typography } from 'antd';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GET_PROJECTS } from '../../shared/api/queries';
import type { Project } from '../../shared/model/types';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';
import { ProjectOverview } from '../../widgets/project-overview';

export function ProjectsPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

  useEffect(() => {
    if (slug) setSelectedProject(slug);
  }, [slug, setSelectedProject]);
  const { data, loading, error } = useQuery<{ projects: Project[] }>(GET_PROJECTS);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: project list */}
      <div
        style={{
          width: 240,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #303030',
        }}
      >
        <div style={{ padding: '16px 16px 8px' }}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}
          >
            Projects
          </Typography.Text>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {loading && <Skeleton active style={{ padding: 8 }} />}
          {error && <Alert type="error" message={error.message} style={{ margin: 8 }} />}
          {data && (
            <List<Project>
              dataSource={data.projects}
              rowKey="id"
              renderItem={(p) => (
                <List.Item
                  onClick={() => navigate(`/projects/${p.slug}`)}
                  style={{
                    cursor: 'pointer',
                    padding: '8px 10px',
                    borderRadius: 4,
                    background: slug === p.slug ? 'rgba(255,255,255,0.06)' : 'transparent',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 2,
                    border: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
                    <Typography.Text
                      strong
                      style={{
                        fontSize: 13,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.title}
                    </Typography.Text>
                    <StatusBadge status={p.status} />
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {p.slug}
                  </Typography.Text>
                  <Timestamp value={p.updatedAt} />
                </List.Item>
              )}
            />
          )}
        </div>
      </div>

      {/* Right: project content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {slug ? (
          <ProjectOverview slug={slug} />
        ) : (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography.Text type="secondary">Select a project</Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
