import { useQuery } from '@apollo/client/react';
import { Alert, Segmented, Select, Space, Typography } from 'antd';
import { useState } from 'react';
import { GET_PROJECT, GET_PROJECT_GRAPH } from '../../shared/api/queries';
import type { ProjectGraph } from '../../shared/model/types';
import { DecisionTimeline } from './DecisionTimeline';
import { KnowledgeGraph } from './KnowledgeGraph';

const DEPTH_OPTIONS = [
  { label: 'Depth 1', value: 1 },
  { label: 'Depth 2', value: 2 },
  { label: 'Depth 3', value: 3 },
];

interface Props {
  slug: string;
}

export function ProjectGraphView({ slug }: Props) {
  const [depth, setDepth] = useState(2);
  // Timeline first (I-PMEM-011): the story of a project reads left-to-right
  // over time, not as a force-directed blob — the graph stays available for
  // the rarer "dotty inspection of exact relationships" case.
  const [view, setView] = useState<'timeline' | 'graph'>('timeline');

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
        <Segmented
          value={view}
          onChange={(v) => setView(v as 'timeline' | 'graph')}
          size="small"
          options={[
            { label: 'Timeline', value: 'timeline' },
            { label: 'Graph', value: 'graph' },
          ]}
        />
        <Space size={8}>
          {view === 'graph' && (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>Graph depth:</Typography.Text>
              <Select
                value={depth}
                onChange={setDepth}
                options={DEPTH_OPTIONS}
                size="small"
                style={{ width: 100 }}
              />
            </>
          )}
          {graph && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {nodes.length} nodes · {edges.length} edges
            </Typography.Text>
          )}
        </Space>
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {view === 'timeline' ? (
          <DecisionTimeline nodes={nodes} edges={edges} loading={loading} />
        ) : (
          <KnowledgeGraph nodes={nodes} edges={edges} loading={loading} />
        )}
      </div>
    </div>
  );
}
