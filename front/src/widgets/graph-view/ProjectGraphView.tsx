import { useQuery } from '@apollo/client/react';
import { Alert, Select, Space, Switch, Typography } from 'antd';
import { useState } from 'react';
import { GET_PROJECT, GET_PROJECT_GRAPH } from '../../shared/api/queries';
import type { ProjectGraph } from '../../shared/model/types';
import { DecisionTimeline } from './DecisionTimeline';
import { ROOT_KIND_OPTIONS, type RootKind } from './rootKind';

const DEPTH_OPTIONS = [
  { label: 'Depth 1', value: 1 },
  { label: 'Depth 2', value: 2 },
  { label: 'Depth 3', value: 3 },
];

interface Props {
  slug: string;
}

// I-PMEM-011: the horizontal decision timeline replaced the force-directed
// knowledge graph as the project-overview visualization entirely (owner:
// "Graph — убирай, это фигня. акцент на этом новом Timeline"). No toggle,
// no fallback — KnowledgeGraph.tsx is retired.
export function ProjectGraphView({ slug }: Props) {
  const [depth, setDepth] = useState(2);
  // D-MEMORY-024: what the baseline ribbon lists — decisions by default
  // (D-MEMORY-014's original quiet default), switchable to any kind.
  const [rootKind, setRootKind] = useState<RootKind>('DECISION');
  // T-MEMORY-045: off by default — decisions-only stays the quiet default
  // view (D-MEMORY-014), tasks are opt-in noise the owner can turn on when
  // they specifically want the fuller activity picture. Only meaningful
  // when decisions are the root — see DecisionTimeline's own guard.
  const [showTasks, setShowTasks] = useState(false);

  const { data: projectData, loading: projectLoading, error: projectError } = useQuery<{ project: { id: string } }>(
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
        <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>Timeline</Typography.Text>
        <Space size={12}>
          <Space size={6}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>Root:</Typography.Text>
            <Select
              value={rootKind}
              onChange={setRootKind}
              options={[...ROOT_KIND_OPTIONS]}
              size="small"
              style={{ width: 110 }}
            />
          </Space>
          {rootKind === 'DECISION' && (
            <Space size={6}>
              <Switch size="small" checked={showTasks} onChange={setShowTasks} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Show tasks</Typography.Text>
            </Space>
          )}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>Link depth:</Typography.Text>
          <Select
            value={depth}
            onChange={setDepth}
            options={DEPTH_OPTIONS}
            size="small"
            style={{ width: 100 }}
          />
          {graph && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {nodes.length} nodes · {edges.length} edges
            </Typography.Text>
          )}
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <DecisionTimeline
          nodes={nodes}
          edges={edges}
          loading={loading}
          projectSlug={slug}
          showTasks={rootKind === 'DECISION' && showTasks}
          rootKind={rootKind}
        />
      </div>
    </div>
  );
}
