import dagre from '@dagrejs/dagre';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Typography } from 'antd';
import { useMemo } from 'react';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { Task } from '../../shared/model/types';

const STATUS_COLOR: Record<string, string> = {
  todo:      '#595959',
  doing:     '#177ddc',
  blocked:   '#a61d24',
  done:      '#389e0d',
  cancelled: '#303030',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'Todo', doing: 'Doing', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled',
};

const NODE_W = 200;
const NODE_H = 60;

function layoutDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 60, nodesep: 20 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } };
  });
}

function TaskNode({ data }: NodeProps) {
  const td = data as { task: Task };
  const t = td.task;
  const color = STATUS_COLOR[t.status] ?? '#595959';
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  return (
    <div
      onClick={() => setSelectedRecord(t.id, 'task')}
      style={{
        width: NODE_W,
        minHeight: NODE_H,
        background: '#1f1f1f',
        border: `2px solid ${color}`,
        borderRadius: 6,
        padding: '6px 10px',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: color }} />
      <Typography.Text
        style={{ fontSize: 11, color, fontFamily: 'monospace', display: 'block', marginBottom: 2 }}
      >
        {t.id}
      </Typography.Text>
      <Typography.Text
        style={{ fontSize: 12, color: '#d9d9d9', display: 'block', lineHeight: 1.3 }}
        ellipsis={{ tooltip: t.title }}
      >
        {t.title}
      </Typography.Text>
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

const NODE_TYPES = { task: TaskNode };

interface Props {
  tasks: Task[];
}

export function TaskFlowchart({ tasks }: Props) {
  const { nodes, edges } = useMemo(() => {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const rawNodes: Node[] = tasks.map((t) => ({
      id: t.id,
      type: 'task',
      position: { x: 0, y: 0 },
      data: { task: t },
    }));

    const rawEdges: Edge[] = tasks.flatMap((t) =>
      (t.dependsOn ?? [])
        .filter((dep) => taskMap.has(dep))
        .map((dep) => ({
          id: `${dep}->${t.id}`,
          source: dep,
          target: t.id,
          animated: t.status === 'doing',
          style: { stroke: STATUS_COLOR[t.status] ?? '#595959', strokeWidth: 1.5 },
        })),
    );

    const laid = layoutDagre(rawNodes, rawEdges);
    return { nodes: laid, edges: rawEdges };
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography.Text type="secondary">No tasks</Typography.Text>
      </div>
    );
  }

  if (edges.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8 }}>
        <Typography.Text type="secondary">No dependencies defined</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>Tasks with dependsOn links will appear here</Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
        <MiniMap
          nodeColor={(n) => STATUS_COLOR[(n.data as { task?: Task }).task?.status ?? ''] ?? '#595959'}
          style={{ background: '#1f1f1f', border: '1px solid #303030' }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      {/* Status legend */}
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
      }}>
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2, display: 'block' }}>
          Status
        </Typography.Text>
        {Object.entries(STATUS_LABEL).map(([key, label]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: STATUS_COLOR[key] }} />
            <Typography.Text style={{ fontSize: 11 }}>{label}</Typography.Text>
          </div>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 4 }}>
          Arrow = "blocks"
        </Typography.Text>
      </div>
    </div>
  );
}
