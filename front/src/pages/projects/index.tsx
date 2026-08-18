import { useMutation, useQuery } from '@apollo/client/react';
import { Alert, Button, Input, List, Skeleton, Tag, Tooltip, Typography } from 'antd';
import { ClockCircleOutlined, PushpinFilled, PushpinOutlined, SortAscendingOutlined } from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { CreateProjectModal } from '../../features/project/CreateProjectModal';
import { GET_PROJECTS, PIN_PROJECT } from '../../shared/api/queries';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useUserPreference } from '../../shared/lib/useUserPreference';
import type { Project } from '../../shared/model/types';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Timestamp } from '../../shared/ui/Timestamp';
import { ProjectOverview } from '../../widgets/project-overview';

// T-MEMORY-086: pin toggle -- stops the click from also bubbling to the
// List.Item's own onClick (navigate into the project), same as every other
// per-row action button in this app (DeleteTaskButton etc).
function PinButton({ project, onDone }: { project: Project; onDone: () => void }) {
  const { t } = useTranslation('projects');
  const [mutate, { loading }] = useMutation(PIN_PROJECT, { onCompleted: onDone });
  return (
    <Tooltip title={project.pinned ? t('unpin') : t('pin')}>
      <Button
        size="small"
        type="text"
        icon={project.pinned ? <PushpinFilled style={{ color: '#d89614' }} /> : <PushpinOutlined />}
        loading={loading}
        onClick={(e) => {
          e.stopPropagation();
          void mutate({ variables: { id: project.id, pinned: !project.pinned } });
        }}
      />
    </Tooltip>
  );
}

export function ProjectsPage() {
  const { t } = useTranslation('projects');
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const setSelectedProject = useWorkspaceStore((s) => s.setSelectedProject);

  useEffect(() => {
    if (slug) setSelectedProject(slug);
  }, [slug, setSelectedProject]);

  const [sort, setSort] = useUserPreference<'slug' | 'createdAt'>('projectsSortOrder', 'slug');
  const { data, loading, error, refetch } = useQuery<{ projects: Project[] }>(GET_PROJECTS, { variables: { sort } });
  useRefetchOnVersion(useRealtimeStore((s) => s.projectsVersion), refetch);

  // T-MEMORY-087: filters the already-loaded, already-sorted (pinned-first)
  // list in place -- no popup, no separate result set, no jump-to-project.
  // Transient UI state (not a server-persisted preference like sort order)
  // since there's no reason to remember a search string across visits.
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
  const filteredProjects = (data?.projects ?? []).filter(
    (p) => !normalizedSearch || p.title.toLowerCase().includes(normalizedSearch) || p.slug.toLowerCase().includes(normalizedSearch),
  );
  const { labelFor } = useActorLabels(filteredProjects.map((p) => p.createdBy));

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Left: project list */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #303030' }}>
        <div style={{ padding: '12px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Icon toggle, not a dropdown -- owner: a full-width Select here
              read as oversized for a binary choice in this narrow sidebar.
              Left-aligned, separate from New Project on the right -- owner:
              glued together on one side read as one control. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Tooltip title={t('sortAlphabetical')}>
              <Button
                size="small"
                type={sort === 'slug' ? 'primary' : 'text'}
                icon={<SortAscendingOutlined />}
                onClick={() => setSort('slug')}
              />
            </Tooltip>
            <Tooltip title={t('sortNewestFirst')}>
              <Button
                size="small"
                type={sort === 'createdAt' ? 'primary' : 'text'}
                icon={<ClockCircleOutlined />}
                onClick={() => setSort('createdAt')}
              />
            </Tooltip>
          </div>
          <CreateProjectModal onDone={() => refetch()} />
        </div>

        <div style={{ padding: '0 16px 8px' }}>
          <Input.Search
            placeholder={t('searchProjectsPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            size="small"
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {loading && <Skeleton active style={{ padding: 8 }} />}
          {error && <Alert type="error" message={error.message} style={{ margin: 8 }} />}
          {data && (
            <List<Project>
              dataSource={filteredProjects}
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
                    <PinButton project={p} onDone={() => refetch()} />
                  </div>
                  <Tag color="orange" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>{p.slug}</Tag>
                  <Timestamp value={p.updatedAt} author={labelFor(p.createdBy)} />
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
