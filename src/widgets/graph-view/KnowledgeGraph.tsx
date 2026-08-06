import * as d3 from 'd3-force';
import { Button, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '../../shared/model/workspace.store';

export interface GNode {
  id: string;
  kind: string;
  title: string;
  status?: string | null;
}

export interface GEdge {
  from: string;
  to: string;
  relation: string;
}

// Colors by kind (spec: project=purple, task=teal, decision=coral, artifact=pink, memory=amber, event=gray)
const KIND_COLOR: Record<string, string> = {
  PROJECT:  '#9254de',
  TASK:     '#13a8a8',
  DECISION: '#ff7875',
  ARTIFACT: '#f759ab',
  MEMORY:   '#d89614',
  EVENT:    '#595959',
  LINK:     '#fa8c16',
};

const KIND_LABEL: Record<string, string> = {
  PROJECT: 'Project', TASK: 'Task', DECISION: 'Decision',
  ARTIFACT: 'Artifact', MEMORY: 'Memory', EVENT: 'Event',
};

const NODE_R = 24;

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  kind: string;
  title: string;
  status?: string | null;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  relation: string;
}

interface Props {
  nodes: GNode[];
  edges: GEdge[];
  loading?: boolean;
}

export function KnowledgeGraph({ nodes, edges, loading }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [simLinks, setSimLinks] = useState<SimLink[]>([]);
  const [svgSize, setSvgSize] = useState({ width: 800, height: 600 });
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  const restart = useCallback(() => {
    const nodeMap = new Map<string, SimNode>();
    const nextNodes: SimNode[] = nodes.map((n) => {
      const existing = nodesRef.current.find((sn) => sn.id === n.id);
      const sn: SimNode = { ...n, x: existing?.x, y: existing?.y };
      nodeMap.set(n.id, sn);
      return sn;
    });

    const nextLinks: SimLink[] = edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({ source: e.from, target: e.to, relation: e.relation }));

    nodesRef.current = nextNodes;
    linksRef.current = nextLinks;
    setSimNodes(nextNodes);
    setSimLinks(nextLinks);

    simRef.current?.stop();
    simRef.current = d3.forceSimulation<SimNode, SimLink>(nextNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(nextLinks).id((d) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .on('tick', () => {
        setSimNodes([...nodesRef.current]);
        setSimLinks([...linksRef.current]);
      });
  }, [nodes, edges]);

  useEffect(() => {
    restart();
    return () => { simRef.current?.stop(); };
  }, [restart]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSvgSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // SVG pan/zoom via wheel + drag
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.2, Math.min(3, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).closest('.graph-node')) return;
    dragging.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    setIsDragging(true);
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({ x: dragging.current.px + (e.clientX - dragging.current.sx), y: dragging.current.py + (e.clientY - dragging.current.sy) });
  };
  const onMouseUp = () => { dragging.current = null; setIsDragging(false); };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="secondary">Loading graph…</Typography.Text>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="secondary">No nodes</Typography.Text>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', background: '#141414', overflow: 'hidden' }}>
      <svg
        ref={svgRef}
        style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="6" refX="26" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#434343" />
          </marker>
        </defs>
        <g transform={`translate(${svgSize.width / 2 + pan.x},${svgSize.height / 2 + pan.y}) scale(${zoom})`}>
          {/* Edges */}
          {simLinks.map((link, i) => {
            const s = link.source as SimNode;
            const t = link.target as SimNode;
            if (!s.x || !t.x) return null;
            return (
              <line
                key={i}
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke="#303030" strokeWidth={1.5}
                markerEnd="url(#arrow)"
              />
            );
          })}

          {/* Nodes */}
          {simNodes.map((n) => {
            if (!n.x) return null;
            const color = KIND_COLOR[n.kind] ?? '#595959';
            const shortTitle = n.title.length > 28 ? n.title.slice(0, 26) + '…' : n.title;
            return (
              <g
                key={n.id}
                className="graph-node"
                transform={`translate(${n.x},${n.y})`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedRecord(n.id, n.kind.toLowerCase())}
              >
                <circle r={NODE_R} fill="#1f1f1f" stroke={color} strokeWidth={2} />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill={color}
                  fontFamily="monospace"
                  y={-6}
                >
                  {n.kind}
                </text>
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill="#d9d9d9"
                  y={6}
                >
                  {n.id.length > 12 ? n.id.slice(-10) : n.id}
                </text>
                {/* Label below */}
                <text
                  textAnchor="middle"
                  y={NODE_R + 14}
                  fontSize={10}
                  fill="rgba(255,255,255,0.55)"
                >
                  {shortTitle}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Controls overlay */}
      <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6 }}>
        <Button size="small" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }}>Reset</Button>
      </div>

      {/* Kind legend */}
      <div style={{
        position: 'absolute', top: 10, right: 10,
        background: 'rgba(20,20,20,0.92)',
        border: '1px solid #303030',
        borderRadius: 6,
        padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 4,
        zIndex: 10,
      }}>
        <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2, display: 'block' }}>
          Node type
        </Typography.Text>
        {Object.entries(KIND_LABEL).map(([kind, label]) => (
          <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${KIND_COLOR[kind]}`, background: '#1f1f1f' }} />
            <Typography.Text style={{ fontSize: 11 }}>{label}</Typography.Text>
          </div>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 4 }}>
          {simNodes.length} nodes · {simLinks.length} edges
        </Typography.Text>
      </div>
    </div>
  );
}
