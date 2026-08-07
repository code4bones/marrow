import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Tooltip, Typography } from 'antd';
import { useCallback, useMemo, useRef, useState } from 'react';
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

// Real timebar (owner: "по принципу timebar... экстраполировать эту шкалу
// на граф, графически"). X is real elapsed time, not topological rank —
// but real activity is bursty (weeks of silence, then a cluster of
// decisions in an hour), so a naive linear scale would either crush every
// burst into a sliver or force absurd canvas widths. Gaps above the
// threshold compress to a fixed-width "⋯ Nd ⋯" break instead; within a
// burst the scale stays linear so relative spacing still means something.
const MS_PER_HOUR = 60 * 60 * 1000;
const GAP_THRESHOLD_MS = 3 * 24 * MS_PER_HOUR;
const COMPRESSED_GAP_PX = 110;
const PX_PER_HOUR = 5;
const MIN_SPACING = NODE_W + 60;
const LANE_HEIGHT = NODE_H + 56;
const AXIS_GAP = 46;

function formatTick(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function formatDuration(ms: number): string {
  const hours = ms / MS_PER_HOUR;
  const days = hours / 24;
  if (days >= 7) return `${Math.round(days / 7)}w`;
  if (days >= 1) return `${Math.round(days)}d`;
  return `${Math.round(hours)}h`;
}

function formatFullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface TimeLayout {
  xById: Map<string, number>;
  yById: Map<string, number>;
  gapMarkers: Array<{ x: number; label: string }>;
  tickMarkers: Array<{ id: string; x: number; label: string }>;
  axisY: number;
  spanX: number;
}

function computeTimeLayout(decisions: GraphNode[]): TimeLayout {
  const xById = new Map<string, number>();
  const gapMarkers: Array<{ x: number; label: string }> = [];
  const tickMarkers: Array<{ id: string; x: number; label: string }> = [];
  let x = MIN_SPACING / 2;
  let prevTime: number | null = null;

  for (const d of decisions) {
    const t = d.createdAt ? new Date(d.createdAt).getTime() : NaN;
    if (prevTime !== null) {
      if (!Number.isNaN(t)) {
        const deltaMs = t - prevTime;
        if (deltaMs > GAP_THRESHOLD_MS) {
          gapMarkers.push({ x: x + COMPRESSED_GAP_PX / 2, label: `⋯ ${formatDuration(deltaMs)} ⋯` });
          x += COMPRESSED_GAP_PX;
        } else {
          x += Math.max(MIN_SPACING, (deltaMs / MS_PER_HOUR) * PX_PER_HOUR);
        }
      } else {
        x += MIN_SPACING;
      }
    }
    xById.set(d.id, x);
    if (d.createdAt) tickMarkers.push({ id: d.id, x, label: formatTick(d.createdAt) });
    if (!Number.isNaN(t)) prevTime = t;
  }

  // Dead branches (superseded/rejected/archived) drop below the main lane;
  // greedy interval packing keeps ones close in time from overlapping
  // instead of all piling onto lane 1.
  const laneEndX: number[] = [];
  const yById = new Map<string, number>();
  for (const d of decisions) {
    const status = d.status ?? 'active';
    const nodeX = xById.get(d.id) ?? 0;
    if (status === 'superseded' || status === 'rejected' || status === 'archived') {
      let lane = laneEndX.findIndex((endX) => endX + MIN_SPACING <= nodeX);
      if (lane === -1) {
        lane = laneEndX.length;
        laneEndX.push(nodeX);
      } else {
        laneEndX[lane] = nodeX;
      }
      yById.set(d.id, (lane + 1) * LANE_HEIGHT);
    } else {
      yById.set(d.id, 0);
    }
  }

  const axisY = (laneEndX.length + 1) * LANE_HEIGHT + AXIS_GAP;
  const spanX = Math.max(0, ...Array.from(xById.values())) + MIN_SPACING / 2;
  return { xById, yById, gapMarkers, tickMarkers, axisY, spanX };
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

function TickNode({ data }: NodeProps) {
  const { label } = data as { label: string };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 60, marginLeft: -30 }}>
      <div style={{ width: 1, height: 10, background: '#434343' }} />
      <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', whiteSpace: 'nowrap' }}>{label}</Typography.Text>
    </div>
  );
}

function GapBreakNode({ data }: NodeProps) {
  const { label } = data as { label: string };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 80, marginLeft: -40 }}>
      <div style={{ width: 1, height: 10, borderLeft: '1px dashed #595959' }} />
      <Typography.Text style={{ fontSize: 10, color: '#595959', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
        {label}
      </Typography.Text>
    </div>
  );
}

const NODE_TYPES = { decision: DecisionNode, tick: TickNode, gapBreak: GapBreakNode };

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading?: boolean;
}

export function DecisionTimeline({ nodes, edges, loading }: Props) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [centerLabel, setCenterLabel] = useState<string | null>(null);
  const { flowNodes, flowEdges, decisionCount, timePoints } = useMemo(() => {
    const decisions = nodes
      .filter((n) => n.kind === 'DECISION')
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
    const decisionIds = new Set(decisions.map((n) => n.id));

    // Any relation between two decisions draws a connecting line — not just
    // supersedes/revives. Most links between decisions in real data are
    // relates_to, not evolution edges, and dropping those left the timeline
    // looking disconnected even where real, curated links existed.
    const chainEdges = edges.filter((e) => decisionIds.has(e.from) && decisionIds.has(e.to));

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

    const layout = computeTimeLayout(decisions);

    // Explicit width/height on the node objects themselves (not just CSS on
    // the custom component) — MiniMap draws from these immediately, without
    // waiting for a measure-after-mount render pass. Without this the
    // minimap rendered every node at zero size: a plain gray/black square,
    // no colored rects, even though panning/seeking on it still worked
    // (that part only needs the canvas bounds, not per-node size).
    const decisionNodes: Node[] = decisions.map((n) => ({
      id: n.id,
      type: 'decision',
      position: { x: (layout.xById.get(n.id) ?? 0) - NODE_W / 2, y: layout.yById.get(n.id) ?? 0 },
      width: NODE_W,
      height: NODE_H,
      data: { node: n, satellites: satellitesByDecision.get(n.id) ?? [] },
    }));

    const tickNodes: Node[] = layout.tickMarkers.map((t) => ({
      id: `tick-${t.id}`,
      type: 'tick',
      position: { x: t.x, y: layout.axisY },
      width: 60,
      height: 22,
      draggable: false,
      selectable: false,
      data: { label: t.label },
    }));

    const gapNodes: Node[] = layout.gapMarkers.map((g, i) => ({
      id: `gap-${i}`,
      type: 'gapBreak',
      position: { x: g.x, y: layout.axisY },
      width: 80,
      height: 22,
      draggable: false,
      selectable: false,
      data: { label: g.label },
    }));

    const rawEdges: Edge[] = chainEdges.map((e) => {
      // Evolution edges (supersedes/revives) are strong and directional;
      // everything else (relates_to, and any other curated relation) is a
      // softer, undirected association — thinner, no arrowhead, dimmer.
      const isEvolution = e.relation === 'supersedes' || e.relation === 'revives';
      const color = e.relation === 'revives' ? '#b37feb' : isEvolution ? '#8c8c8c' : '#4a90d9';
      return {
        id: `${e.from}->${e.to}-${e.relation}`,
        source: e.from,
        target: e.to,
        type: 'smoothstep',
        zIndex: isEvolution ? 1000 : 500,
        style: {
          stroke: color,
          strokeWidth: isEvolution ? 2.5 : 1.5,
          strokeDasharray: e.relation === 'revives' ? '6 4' : isEvolution ? '5 4' : '2 4',
          opacity: isEvolution ? 1 : 0.7,
        },
        markerEnd: isEvolution ? { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } : undefined,
        label: e.relation,
        labelStyle: { fill: color, fontSize: isEvolution ? 11 : 10, fontWeight: isEvolution ? 600 : 400 },
        labelBgStyle: { fill: '#141414', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
      };
    });

    const timePoints = decisions
      .filter((d): d is GraphNode & { createdAt: string } => Boolean(d.createdAt))
      .map((d) => ({ x: layout.xById.get(d.id) ?? 0, iso: d.createdAt }))
      .sort((a, b) => a.x - b.x);

    return {
      flowNodes: [...decisionNodes, ...tickNodes, ...gapNodes],
      flowEdges: rawEdges,
      decisionCount: decisions.length,
      timePoints,
    };
  }, [nodes, edges]);

  // Owner: "когда мы его двигаем, должен появляться хотя бы тултип, куда мы
  // по дате приехали" — panning or seeking via the MiniMap fires the same
  // onMove callback, so one handler covers both. Finds whichever decision's
  // x-position is nearest the horizontal center of the viewport and shows
  // its date; nothing fancier (no interpolation) since "roughly here" is
  // the point, not a precise readout.
  const updateCenterLabel = useCallback((viewport: Viewport) => {
    if (timePoints.length === 0 || !wrapperRef.current) {
      setCenterLabel(null);
      return;
    }
    const containerWidth = wrapperRef.current.clientWidth;
    const flowCenterX = (containerWidth / 2 - viewport.x) / viewport.zoom;
    let nearest = timePoints[0];
    let nearestDist = Math.abs(nearest.x - flowCenterX);
    for (const p of timePoints) {
      const dist = Math.abs(p.x - flowCenterX);
      if (dist < nearestDist) {
        nearest = p;
        nearestDist = dist;
      }
    }
    setCenterLabel(formatFullDate(nearest.iso));
  }, [timePoints]);

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
    <div ref={wrapperRef} style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => {
          if (node.type === 'decision') setSelectedRecord(node.id, 'decision');
        }}
        onMove={(_, viewport) => updateCenterLabel(viewport)}
        onInit={(instance) => updateCenterLabel(instance.getViewport())}
        style={{ background: '#141414' }}
      >
        <Background color="#2a2a2a" gap={20} />
        <Controls style={{ background: '#1f1f1f', border: '1px solid #303030' }} />
        <MiniMap
          nodeColor={(n) => {
            if (n.type !== 'decision') return '#3a3a3a';
            const status = (n.data as { node?: GraphNode })?.node?.status ?? 'active';
            return STATUS_COLOR[status] ?? '#595959';
          }}
          nodeStrokeWidth={0}
          maskColor="rgba(0,0,0,0.35)"
          style={{ background: '#1f1f1f', border: '1px solid #303030', width: 220, height: 140 }}
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Current center date — updates on pan/zoom/minimap-seek */}
      {centerLabel && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(20,20,20,0.92)', border: '1px solid #303030', borderRadius: 6,
          padding: '4px 12px', zIndex: 10, pointerEvents: 'none',
        }}
        >
          <Typography.Text style={{ fontSize: 12, color: '#d9d9d9' }}>{centerLabel}</Typography.Text>
        </div>
      )}

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
          Gray = supersedes · purple = revives · blue dotted = relates_to
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
          {decisionCount} decision{decisionCount === 1 ? '' : 's'} · axis below shows real dates, ⋯Nd⋯ = compressed gap
        </Typography.Text>
      </div>
    </div>
  );
}
