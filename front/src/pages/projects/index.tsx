import { useQuery } from '@apollo/client/react';
import { Alert, List, Select, Skeleton, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateProjectModal } from '../../features/project/CreateProjectModal';
import { GET_PROJECTS } from '../../shared/api/queries';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import type { Project } from '../../shared/model/types';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';
import { ProjectOverview } from '../../widgets/project-overview';

export function ProjectsPage() {
  const { t } = useTranslation('projects');
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

  useEffect(() => {
    if (slug) setSelectedProject(slug);
  }, [slug, setSelectedProject]);

  const [sort, setSort] = useState<'slug' | 'createdAt'>('slug');
  const { data, loading, error, refetch } = useQuery<{ projects: Project[] }>(GET_PROJECTS, { variables: { sort } });
  useRefetchOnVersion(useRealtimeStore((s) => s.projectsVersion), refetch);

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: project list */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #303030' }}>
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography.Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('projects')}
          </Typography.Text>
          <CreateProjectModal onDone={() => refetch()} />
        </div>

        <div style={{ padding: '0 8px 8px' }}>
          <Select<'slug' | 'createdAt'>
            value={sort}
            onChange={setSort}
            size="small"
            style={{ width: '100%' }}
            options={[
              { label: t('sortAlphabetical'), value: 'slug' },
              { label: t('sortNewestFirst'), value: 'createdAt' },
            ]}
          />
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
                    <Typography.Text strong style={{ fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title}
                    </Typography.Text>
                    <StatusBadge status={p.status} />
                  </div>
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>{p.slug}</Typography.Text>
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
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography.Text type="secondary">{t('selectAProject')}</Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
