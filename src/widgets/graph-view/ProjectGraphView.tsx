import { useQuery } from '@apollo/client/react';
import { Alert } from 'antd';
import { useMemo, useState } from 'react';
import { GET_LINKS_PAGE, GET_PROJECT_SUMMARY } from '../../shared/api/queries';
import type { Link, ProjectSummary } from '../../shared/model/types';
import type { GEdge, GNode } from './KnowledgeGraph';
import { KnowledgeGraph } from './KnowledgeGraph';

const MAX_NODES = 40;

interface Props {
  slug: string;
}

function summaryToNodes(summary: ProjectSummary): GNode[] {
  const nodes: GNode[] = [];
  const seen = new Set<string>();

  const add = (id: string, kind: string, title: string, status?: string | null) => {
    if (!seen.has(id) && nodes.length < MAX_NODES) {
      seen.add(id);
      nodes.push({ id, kind, title, status });
    }
  };

  add(summary.project.id, 'PROJECT', summary.project.title, summary.project.status);
  summary.openTasks.forEach((t) => add(t.id, 'TASK', t.title, t.status));
  summary.decisions.forEach((d) => add(d.id, 'DECISION', d.title, d.status));
  summary.artifacts.forEach((a) => add(a.id, 'ARTIFACT', a.title ?? a.path, a.status));
  summary.recentEvents.slice(0, 8).forEach((e) => add(e.id, 'EVENT', e.title));
  summary.knownFaults.forEach((m) => add(m.id, 'MEMORY', m.title, m.status));

  return nodes;
}

function summaryToEdges(summary: ProjectSummary, links: Link[]): GEdge[] {
  const edges: GEdge[] = [];
  const nodeIds = new Set<string>();

  nodeIds.add(summary.project.id);
  summary.openTasks.forEach((t) => { nodeIds.add(t.id); });
  summary.decisions.forEach((d) => { nodeIds.add(d.id); });
  summary.artifacts.forEach((a) => { nodeIds.add(a.id); });
  summary.recentEvents.slice(0, 8).forEach((e) => { nodeIds.add(e.id); if (e.relatedId) nodeIds.add(e.relatedId); });
  summary.knownFaults.forEach((m) => { nodeIds.add(m.id); });

  // Links from linksPage
  links.forEach((l) => {
    if (nodeIds.has(l.fromId) && nodeIds.has(l.toId)) {
      edges.push({ from: l.fromId, to: l.toId, relation: l.relation });
    }
  });

  // relatedId edges from events
  summary.recentEvents.slice(0, 8).forEach((e) => {
    if (e.relatedId && nodeIds.has(e.relatedId) && nodeIds.has(e.id)) {
      edges.push({ from: e.id, to: e.relatedId, relation: 'related' });
    }
  });

  // project → tasks/decisions/artifacts
  summary.openTasks.forEach((t) => edges.push({ from: summary.project.id, to: t.id, relation: 'has_task' }));
  summary.decisions.forEach((d) => edges.push({ from: summary.project.id, to: d.id, relation: 'has_decision' }));
  summary.artifacts.forEach((a) => edges.push({ from: summary.project.id, to: a.id, relation: 'has_artifact' }));

  return edges;
}

export function ProjectGraphView({ slug }: Props) {
  const [fullGraph, setFullGraph] = useState(false);

  const { data: summaryData, loading: sLoading, error: sError } = useQuery<{ projectSummary: ProjectSummary }>(
    GET_PROJECT_SUMMARY,
    { variables: { project: slug } },
  );

  const { data: linksData, loading: lLoading } = useQuery<{ linksPage: { items: Link[] } }>(
    GET_LINKS_PAGE,
    { variables: { project: slug, limit: 100, offset: 0, includeCommon: false } },
  );

  const { nodes, edges } = useMemo(() => {
    if (!summaryData?.projectSummary) return { nodes: [], edges: [] };
    const s = summaryData.projectSummary;
    const links = linksData?.linksPage.items ?? [];
    return {
      nodes: summaryToNodes(s),
      edges: summaryToEdges(s, links),
    };
  }, [summaryData, linksData]);

  if (sError) return <Alert type="error" message={sError.message} />;

  return (
    <KnowledgeGraph
      nodes={nodes}
      edges={edges}
      loading={sLoading || lLoading}
      onLoadFull={!fullGraph ? () => setFullGraph(true) : undefined}
      isFullGraph={fullGraph}
    />
  );
}
