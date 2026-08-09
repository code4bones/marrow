import { useQuery } from '@apollo/client/react';
import { Alert, Segmented, Select, Space, Switch, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GET_PROJECT, GET_PROJECT_GRAPH } from '../../shared/api/queries';
import type { ProjectGraph } from '../../shared/model/types';
import { DecisionTimeline } from './DecisionTimeline';
import { GraphTree } from './GraphTree';
import { rootKindOptions, type RootKind } from './rootKind';

type ViewMode = 'timeline' | 'tree';

function depthOptions(t: (key: string) => string) {
  return [
    { label: t('depth1'), value: 1 },
    { label: t('depth2'), value: 2 },
    { label: t('depth3'), value: 3 },
  ];
}

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
  const [depth, setDepth] = useState(2);
  // D-MEMORY-024: what the baseline ribbon lists — decisions by default
  // (D-MEMORY-014's original quiet default), switchable to any kind.
  // Timeline-only -- GraphTree's root is always the project itself, so this
  // selection (and showTasks below) just sits unused-but-preserved while
  // view === 'tree', per T-MEMORY-056's acceptance criteria.
  const [rootKind, setRootKind] = useState<RootKind>('DECISION');
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

  const { data: graphData, loading: graphLoading, error: graphError } = useQuery<{ projectGraph: ProjectGraph }>(
    GET_PROJECT_GRAPH,
    {
      variables: { projectId, depth },
      skip: !projectId,
    },
  );

  const error = projectError || graphError;
  if (error) return <Alert type="error" message={error.message} style={{ margin: 16 }} />;

  const graph = graphData?.projectGraph;
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const loading = projectLoading || graphLoading;

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
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('linkDepth')}</Typography.Text>
          <Select
            value={depth}
            onChange={setDepth}
            options={depthOptions(t)}
            size="small"
            style={{ width: 100 }}
          />
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
