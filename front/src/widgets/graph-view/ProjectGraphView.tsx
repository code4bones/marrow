import { useQuery } from '@apollo/client/react';
import { Alert, Segmented, Select, Space, Switch, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GET_PROJECT, GET_PROJECT_GRAPH } from '../../shared/api/queries';
import { useRefetchOnVersion } from '../../shared/lib/useRefetchOnVersion';
import { useUserPreference } from '../../shared/lib/useUserPreference';
import { useRealtimeStore } from '../../shared/model/realtime.store';
import type { ProjectGraph } from '../../shared/model/types';
import { DecisionTimeline } from './DecisionTimeline';
import { GraphTree } from './GraphTree';
import { rootKindOptions, type RootKind } from './rootKind';

type ViewMode = 'timeline' | 'tree';

// Owner request: no user-facing depth control -- always request the
// backend's actual maximum (graph.mixin.ts's projectGraph clamps depth to
// [1, 5] via boundedInteger) rather than the old UI-imposed cap of 3.
const MAX_LINK_DEPTH = 5;

interface Props {
  slug: string;
}

// I-PMEM-011: the horizontal decision timeline replaced the force-directed
// knowledge graph as the project-overview visualization entirely (owner:
// "Graph — убирай, это фигня. акцент на этом новом Timeline"). KnowledgeGraph.tsx
// stays retired -- T-MEMORY-056 adds a second, deliberately different toggle
// instead: a project-rooted hierarchy (GraphTree) built from the exact same
// nodes/edges as the timeline, no extra backend request.
export function ProjectGraphView({ slug }: Props) {
  const { t } = useTranslation('projects');
  const [view, setView] = useState<ViewMode>('timeline');
  const depth = MAX_LINK_DEPTH;
  // T-MEMORY-045: off by default — decisions-only stays the quiet default
  // view (D-MEMORY-014), tasks are opt-in noise the owner can turn on when
  // they specifically want the fuller activity picture. Only meaningful
  // when decisions are the root — see DecisionTimeline's own guard.
  const [showTasks, setShowTasks] = useState(false);

  const { data: projectData, loading: projectLoading, error: projectError } = useQuery<{ project: { id: string; title: string } }>(
    GET_PROJECT,
    { variables: { slug } },
  );

  const projectId = projectData?.project.id;

  // D-MEMORY-024: what the baseline ribbon lists — decisions by default
  // (D-MEMORY-014's original quiet default), switchable to any kind.
  // Timeline-only -- GraphTree's root is always the project itself, so this
  // selection (and showTasks above) just sits unused-but-preserved while
  // view === 'tree', per T-MEMORY-056's acceptance criteria. T-MEMORY-086:
  // persisted server-side per (user, project). I-MEMORY-128: keyed by
  // `slug` (this component's own prop, synchronous) rather than `projectId`
  // (GET_PROJECT's resolved id, one network round trip behind) -- the old
  // projectId-gated key briefly went null then flipped from the 'DECISION'
  // fallback to the real stored value on every project switch, same
  // multiple-sources-of-truth shape as I-MEMORY-128's nav-rail slug bug.
  // `slug` is exactly what GET_PROJECT_GRAPH's own `projectId` variable
  // already passes below (resolveProject() accepts a slug just as well).
  const [rootKind, setRootKind] = useUserPreference<RootKind>(`timelineRootKind:${slug}`, 'DECISION');

  // T-context (2026-09-02, owner's ask -- project switch felt slow): this
  // used to wait on `projectId` (resolved by the GET_PROJECT query above),
  // gating the whole graph fetch behind a round trip it doesn't actually
  // need -- projectGraph's `projectId` argument is resolved server-side via
  // resolveProject(), which already accepts a slug just as well as a real
  // id (see backend/.../projects-core.mixin.ts). Passing `slug` directly
  // lets this fire immediately, in parallel with GET_PROJECT and every
  // other overlay query, instead of waiting its turn behind GET_PROJECT --
  // measured live: this was one whole hop in an ~800ms, 15-request
  // waterfall on the project's largest project.
  const { data: graphData, loading: graphLoading, error: graphError, refetch: refetchGraph } = useQuery<{ projectGraph: ProjectGraph }>(
    GET_PROJECT_GRAPH,
    {
      variables: { projectId: slug, depth },
    },
  );
  // This query batches every kind (decisions/tasks/memory/artifacts/links)
  // into one graph, unlike the per-kind list pages -- it was never wired to
  // the realtime store at all, so Timeline/Tree only ever showed whatever
  // was true at mount. Switching the Root selector doesn't re-fetch either
  // (it just filters the same already-stale `nodes` client-side), so a tab
  // left open through any change here silently drifted until a manual
  // reload -- reported live: a task's status update showed correctly after
  // reloading one tab, but a second tab still showed the old status no
  // matter which Root kind was selected.
  useRefetchOnVersion(
    useRealtimeStore((s) => s.tasksVersion + s.decisionsVersion + s.artifactsVersion + s.memoryVersion + s.linksVersion),
    refetchGraph,
  );

  const error = projectError || graphError;
  if (error) return <Alert type="error" message={error.message} style={{ margin: 16 }} />;

  const graph = graphData?.projectGraph;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  // `&& !xData`, not just `xLoading` -- useRefetchOnVersion right above
  // calls refetchGraph() on every realtime event across every domain, and
  // Apollo flips *Loading back to true for that background refetch too, not
  // only the true first load. DecisionTimeline/GraphTree both gate their
  // entire render on this `loading` prop with an unconditional early
  // return, so passing the raw flag through swapped the whole Timeline
  // (every open column, every card) for a "Loading…" placeholder on every
  // single event anywhere in the project -- reported live as the whole
  // task list re-rendering on one task's status change. Once data exists
  // from the initial load, a background refetch updates in place instead.
  const loading = (projectLoading && !projectData) || (graphLoading && !graphData);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #303030', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          size="small"
          value={view}
          onChange={(value) => setView(value as ViewMode)}
          options={[{ label: t('timeline'), value: 'timeline' }, { label: t('tree'), value: 'tree' }]}
        />
        <Space size={12}>
          {view === 'timeline' && (
            <>
              <Space size={6}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('root')}</Typography.Text>
                <Select
                  value={rootKind}
                  onChange={setRootKind}
                  options={rootKindOptions(t)}
                  size="small"
                  style={{ width: 110 }}
                />
              </Space>
              {rootKind === 'DECISION' && (
                <Space size={6}>
                  <Switch size="small" checked={showTasks} onChange={setShowTasks} />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('showTasks')}</Typography.Text>
                </Space>
              )}
            </>
          )}
          {graph && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {t('nodesAndEdges', { nodes: nodes.length, edges: edges.length })}
            </Typography.Text>
          )}
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'timeline' ? (
          <DecisionTimeline
            nodes={nodes}
            edges={edges}
            loading={loading}
            projectSlug={slug}
            showTasks={rootKind === 'DECISION' && showTasks}
            rootKind={rootKind}
          />
        ) : (
          projectId && projectData && (
            <GraphTree
              nodes={nodes}
              edges={edges}
              loading={loading}
              projectId={projectId}
              projectTitle={projectData.project.title}
            />
          )
        )}
      </div>
    </div>
  );
}
