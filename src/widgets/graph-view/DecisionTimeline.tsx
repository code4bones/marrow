import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Tooltip, Typography } from 'antd';
import { useMemo } from 'react';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { GraphEdge, GraphNode } from '../../shared/model/types';

// I-PMEM-010 status encoding, I-PMEM-011 horizontal orientation (owner:
// "как в фантастических фильмах про путешествия во времени" — a main line
// with dead-end branches, not a force-directed blob). Decisions only by
// default (density rule): the graph is ~80% events/tasks/items noise, and
// only decisions carry the "why" a reader comes here for.
const STATUS_COLOR: Record<string, string> = {
  active: '#52c41a',
  draft: '#d89614',
  superseded: '#8c8c8c',
  rejected: '#8c8c8c',
  archived: '#595959',
};

const REJECTED_BORDER = '#a61d24';

const STATUS_LABEL: Record<string, string> = {
  active: 'Active — current understanding',
  draft: 'Draft — under consideration',
  superseded: 'Superseded — kept for context, not current',
  rejected: 'Rejected — considered and declined',
  archived: 'Archived',
};

// Matches KnowledgeGraph.tsx's kind palette so a task/item/artifact reads
// the same color whether it's a full node there or a satellite dot here.
const SATELLITE_KIND_COLOR: Record<string, string> = {
  TASK: '#13a8a8',
  MEMORY: '#d89614',
  ARTIFACT: '#f759ab',
};
const MAX_SATELLITES_SHOWN = 8;

const MAX_NODES = 20;
const NODE_W = 240;
const NODE_H = 100;

function layoutDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 32 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

function DecisionNode({ data }: NodeProps) {
  const nd = data as { node: GraphNode; satellites: GraphNode[] };
  const n = nd.node;
  const satellites = nd.satellites;
  const status = n.status ?? 'active';
  const color = STATUS_COLOR[status] ?? '#595959';
  const borderColor = status === 'rejected' ? REJECTED_BORDER : color;
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  const shown = satellites.slice(0, MAX_SATELLITES_SHOWN);
  const overflow = satellites.length - shown.length;

  return (
    <div
      onClick={() => setSelectedRecord(n.id, 'decision')}
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: '#1f1f1f',
        border: `2px solid ${borderColor}`,
        borderRadius: 6,
        padding: '8px 12px',
        cursor: 'pointer',
        boxSizing: 'border-box',
        opacity: status === 'superseded' || status === 'archived' ? 0.72 : 1,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <Typography.Text
        style={{ fontSize: 13, color: '#e8e8e8', display: 'block', lineHeight: 1.3, marginBottom: 4 }}
        ellipsis={{ tooltip: n.title }}
      >
        {n.title}
      </Typography.Text>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace' }}>
          {n.id}
        </Typography.Text>
        <Typography.Text style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {status}
        </Typography.Text>
      </div>

      {/* Satellites: linked tasks/memory/artifacts hanging off this decision */}
      {satellites.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 'auto', paddingTop: 6, flexWrap: 'wrap' }}>
          {shown.map((s) => (
            <Tooltip key={s.id} title={`${s.kind}: ${s.title}`}>
              <div
                onClick={(e) => { e.stopPropagation(); setSelectedRecord(s.id, s.kind.toLowerCase()); }}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: SATELLITE_KIND_COLOR[s.kind] ?? '#595959',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              />
            </Tooltip>
          ))}
          {overflow > 0 && (
            <Typography.Text style={{ fontSize: 9, color: '#8c8c8c' }}>+{overflow}</Typography.Text>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

const NODE_TYPES = { decision: DecisionNode };

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading?: boolean;
}

export function DecisionTimeline({ nodes, edges, loading }: Props) {
  const { flowNodes, flowEdges, decisionCount } = useMemo(() => {
    const decisions = nodes
      .filter((n) => n.kind === 'DECISION')
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const decisionIds = new Set(decisions.map((n) => n.id));

    const chainEdges = edges.filter(
      (e) => (e.relation === 'supersedes' || e.relation === 'revives') && decisionIds.has(e.from) && decisionIds.has(e.to),
    );

    // Satellites: any other record (task/item/artifact) linked to a decision
    // by any relation — rendered as small dots on the decision node itself
    // rather than as separate nodes, so the main spine stays readable.
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const satellitesByDecision = new Map<string, GraphNode[]>();
    const addSatellite = (decisionId: string, satellite: GraphNode) => {
      const list = satellitesByDecision.get(decisionId) ?? [];
      if (!list.some((s) => s.id === satellite.id)) {
        list.push(satellite);
      }
      satellitesByDecision.set(decisionId, list);
    };
    for (const e of edges) {
      const fromNode = nodeById.get(e.from);
      const toNode = nodeById.get(e.to);
      if (!fromNode || !toNode) continue;
      if (fromNode.kind === 'DECISION' && toNode.kind !== 'DECISION' && toNode.kind !== 'PROJECT') {
        addSatellite(fromNode.id, toNode);
      } else if (toNode.kind === 'DECISION' && fromNode.kind !== 'DECISION' && fromNode.kind !== 'PROJECT') {
        addSatellite(toNode.id, fromNode);
      }
    }

    const rawNodes: Node[] = decisions.map((n) => ({
      id: n.id,
      type: 'decision',
      position: { x: 0, y: 0 },
      data: { node: n, satellites: satellitesByDecision.get(n.id) ?? [] },
    }));

    const rawEdges: Edge[] = chainEdges.map((e) => {
      const color = e.relation === 'revives' ? '#b37feb' : '#8c8c8c';
      return {
        id: `${e.from}->${e.to}-${e.relation}`,
        source: e.from,
        target: e.to,
        type: 'smoothstep',
        zIndex: 1000,
        style: {
          stroke: color,
          strokeWidth: 2.5,
          strokeDasharray: e.relation === 'revives' ? '6 4' : '5 4',
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        label: e.relation,
        labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: '#141414', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
      };
    });

    // Order-only edges between chronologically adjacent, otherwise-unrelated
    // decisions keep dagre from scattering isolated nodes at rank 0 — the
    // point is "what happened over time", so time order should still read
    // left-to-right even where there's no causal edge to draw.
    const orderEdges: Edge[] = [];
    for (let i = 1; i < decisions.length; i += 1) {
      const prev = decisions[i - 1];
      const curr = decisions[i];
      const alreadyLinked = chainEdges.some(
        (e) => (e.from === prev.id && e.to === curr.id) || (e.from === curr.id && e.to === prev.id),
      );
      if (!alreadyLinked) {
        orderEdges.push({ id: `order-${prev.id}-${curr.id}`, source: prev.id, target: curr.id, style: { opacity: 0 } });
      }
    }

    const laid = layoutDagre(rawNodes, [...rawEdges, ...orderEdges]);
    return { flowNodes: laid, flowEdges: rawEdges, decisionCount: decisions.length };
  }, [nodes, edges]);

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="secondary">Loading timeline…</Typography.Text>
      </div>
    );
  }

  if (decisionCount === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Typography.Text type="secondary">No decisions recorded yet</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          The timeline fills in as decision.record / decision.supersede are used
        </Typography.Text>
      </div>
    );
  }

  if (decisionCount > MAX_NODES) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Typography.Text type="warning">Too broad to render — {decisionCount} decisions</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          Narrow the selection (this view caps at {MAX_NODES} to stay readable)
        </Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        style={{ background: '#141414' }}
      >
        <Background color="#2a2a2a" gap={20} />
        <Controls style={{ background: '#1f1f1f', border: '1px solid #303030' }} />
      </ReactFlow>

      {/* Legend */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        background: 'rgba(20,20,20,0.92)',
        border: '1px solid #303030',
        borderRadius: 6,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 10,
        maxWidth: 240,
      }}>
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2, display: 'block' }}>
          Status
        </Typography.Text>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 10, height: 10, borderRadius: 2,
              border: `2px solid ${key === 'rejected' ? REJECTED_BORDER : STATUS_COLOR[key]}`,
              background: '#1f1f1f',
            }}
            />
            <Typography.Text style={{ fontSize: 11 }}>{label}</Typography.Text>
          </div>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 6 }}>
          Dashed gray = supersedes · dashed purple = revives
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4, display: 'block' }}>
          Dots on a card
        </Typography.Text>
        {Object.entries(SATELLITE_KIND_COLOR).map(([kind, dotColor]) => (
          <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor }} />
            <Typography.Text style={{ fontSize: 11 }}>{kind.toLowerCase()}</Typography.Text>
          </div>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 4 }}>
          {decisionCount} decision{decisionCount === 1 ? '' : 's'}
        </Typography.Text>
      </div>
    </div>
  );
}
