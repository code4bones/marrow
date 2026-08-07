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
import { CheckCircleOutlined, LinkOutlined, PlusCircleOutlined } from '@ant-design/icons';
import { Popover, Tag, Tooltip, Typography } from 'antd';
import { useCallback, useMemo, useRef, useState } from 'react';
import { TONE_META } from '../../features/remark/tone';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { GraphEdge, GraphNode, Link } from '../../shared/model/types';
import { type RemarkPreview, type TaskMarker, useTimelineOverlay } from './useTimelineOverlay';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

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

// T-MEMORY-045 "Show tasks" toggle. Task markers use the app's canonical
// task color (ENTITY_COLOR.task in entityId.ts) so they read as "task" at a
// glance, distinct from any decision-status color — created vs. done is a
// shape/icon difference (hollow vs. filled), not a second color, since the
// requirement is "don't blend visually with decisions", not "invent a
// second palette".
const TASK_MARKER_COLOR = '#177ddc';
const TASK_MARKER_SIZE = 22;
// Small pitch: unlike decisions (which need MIN_SPACING for a whole card),
// task markers are dots and a burst of same-minute task events shouldn't
// blow the canvas out — see the per-pair floor in computeTimeLayout below.
const TASK_MARKER_PITCH = 30;
const TASK_LANE_HEIGHT = 34;

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

// A single point on the shared time axis — either a decision (full card,
// may drop to a below lane if it's a dead branch) or a task marker (small
// dot, "Show tasks" toggle only, always lives on a lane above the main
// line). Merging both kinds into one sorted-by-time pass keeps them on the
// exact same real-time/gap-compressed scale instead of two axes that would
// drift apart.
interface TimelineEntry {
  id: string;
  createdAt: string | null;
  kind: 'decision' | 'task';
  status?: string | null;
}

function computeTimeLayout(entries: TimelineEntry[]): TimeLayout {
  const xById = new Map<string, number>();
  const gapMarkers: Array<{ x: number; label: string }> = [];
  const tickMarkers: Array<{ id: string; x: number; label: string }> = [];
  let x = MIN_SPACING / 2;
  let prevTime: number | null = null;
  let prevKind: TimelineEntry['kind'] | null = null;

  for (const entry of entries) {
    const t = entry.createdAt ? new Date(entry.createdAt).getTime() : NaN;
    // Decisions always get the full card-width floor from whatever came
    // before; two task markers in a row only need dot-sized clearance from
    // each other. This means a burst of task activity between two decisions
    // fans out tightly instead of ballooning canvas width, while a decision
    // is always at least MIN_SPACING from its nearest neighbor of either
    // kind — so enabling "Show tasks" never pushes two decision cards
    // closer together than they'd be with the toggle off.
    const floor = entry.kind === 'decision' || prevKind === 'decision' ? MIN_SPACING : TASK_MARKER_PITCH;
    if (prevTime !== null) {
      if (!Number.isNaN(t)) {
        const deltaMs = t - prevTime;
        if (deltaMs > GAP_THRESHOLD_MS) {
          gapMarkers.push({ x: x + COMPRESSED_GAP_PX / 2, label: `⋯ ${formatDuration(deltaMs)} ⋯` });
          x += COMPRESSED_GAP_PX;
        } else {
          x += Math.max(floor, (deltaMs / MS_PER_HOUR) * PX_PER_HOUR);
        }
      } else {
        x += floor;
      }
    }
    xById.set(entry.id, x);
    if (entry.kind === 'decision' && entry.createdAt) tickMarkers.push({ id: entry.id, x, label: formatTick(entry.createdAt) });
    if (!Number.isNaN(t)) prevTime = t;
    prevKind = entry.kind;
  }

  // Dead branches (superseded/rejected/archived) drop below the main lane;
  // greedy interval packing keeps ones close in time from overlapping
  // instead of all piling onto lane 1.
  const laneEndX: number[] = [];
  const yById = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== 'decision') continue;
    const status = entry.status ?? 'active';
    const nodeX = xById.get(entry.id) ?? 0;
    if (status === 'superseded' || status === 'rejected' || status === 'archived') {
      let lane = laneEndX.findIndex((endX) => endX + MIN_SPACING <= nodeX);
      if (lane === -1) {
        lane = laneEndX.length;
        laneEndX.push(nodeX);
      } else {
        laneEndX[lane] = nodeX;
      }
      yById.set(entry.id, (lane + 1) * LANE_HEIGHT);
    } else {
      yById.set(entry.id, 0);
    }
  }

  // Task markers get lane(s) above the main line (negative y) — never
  // compete for space with decision dead-branches below, never overlap the
  // decision cards themselves.
  const taskLaneEndX: number[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'task') continue;
    const nodeX = xById.get(entry.id) ?? 0;
    let lane = taskLaneEndX.findIndex((endX) => endX + TASK_MARKER_PITCH <= nodeX);
    if (lane === -1) {
      lane = taskLaneEndX.length;
      taskLaneEndX.push(nodeX);
    } else {
      taskLaneEndX[lane] = nodeX;
    }
    yById.set(entry.id, -((lane + 1) * TASK_LANE_HEIGHT));
  }

  const axisY = (laneEndX.length + 1) * LANE_HEIGHT + AXIS_GAP;
  const spanX = Math.max(0, ...Array.from(xById.values())) + MIN_SPACING / 2;
  return { xById, yById, gapMarkers, tickMarkers, axisY, spanX };
}

// Top-expand: same links a node has (excluding "annotates" — those are
// remarks, shown separately) rendered inline via the exact same
// arrow/relation/RecordLink shape as the drawer's LinksSection, so the data
// reads identically whether you expand it here or open the full drawer.
function LinksPanelContent({ id, links }: { id: string; links: Link[] }) {
  if (links.length === 0) {
    return <Typography.Text type="secondary" style={{ fontSize: 12 }}>No links yet</Typography.Text>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 260 }}>
      {links.map((l) => {
        const outgoing = l.fromId === id;
        const otherId = outgoing ? l.toId : l.fromId;
        return (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, width: 14, flexShrink: 0 }}>
              {outgoing ? '→' : '←'}
            </Typography.Text>
            <Tag style={{ fontSize: 10 }}>{l.relation}</Tag>
            <RecordLink id={otherId} />
          </div>
        );
      })}
    </div>
  );
}

function LinksExpandButton({ id, links }: { id: string; links: Link[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      trigger="click"
      placement="top"
      open={open}
      onOpenChange={setOpen}
      content={<LinksPanelContent id={id} links={links} />}
    >
      <span
        role="button"
        title={links.length > 0 ? `${links.length} link${links.length === 1 ? '' : 's'}` : 'No links yet'}
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          height: 16,
          borderRadius: 4,
          cursor: 'pointer',
          flexShrink: 0,
          color: links.length > 0 ? '#8c8c8c' : '#434343',
        }}
      >
        <LinkOutlined style={{ fontSize: 11 }} />
      </span>
    </Popover>
  );
}

// Bottom remarks indicator (D-MEMORY-015 feature, reused): read-only preview
// of the same tone-colored cards RemarkPanel renders in the drawer, minus
// the edit affordance — editing stays a drawer-only action per T-MEMORY-045
// scope ("только индикатор + разворот на чтение").
function RemarksPanelContent({ remarks }: { remarks: RemarkPreview[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 280, maxHeight: 320, overflowY: 'auto' }}>
      {remarks.map((r) => {
        const meta = TONE_META[r.tone];
        return (
          <div
            key={r.id}
            style={{
              border: `1px solid ${meta.color}55`, borderLeft: `3px solid ${meta.color}`,
              borderRadius: 4, padding: '6px 8px', background: 'rgba(255,255,255,0.02)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ color: meta.color }}>{meta.icon}</span>
              <Typography.Text style={{ fontSize: 10, color: meta.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                {meta.label}
              </Typography.Text>
            </div>
            {r.body && (
              <Typography.Paragraph style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {r.body}
              </Typography.Paragraph>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 10 }}>
              <Timestamp value={r.updatedAt ?? r.createdAt} />
            </Typography.Text>
          </div>
        );
      })}
      <Typography.Text type="secondary" style={{ fontSize: 10 }}>
        Edit remarks from the record&apos;s detail drawer.
      </Typography.Text>
    </div>
  );
}

function RemarksIndicator({ remarks }: { remarks: RemarkPreview[] }) {
  const [open, setOpen] = useState(false);
  // Only rendered for decisions that actually have remarks — no indicator
  // at all otherwise, per acceptance criteria (not a zero-state badge).
  if (remarks.length === 0) return null;
  const meta = TONE_META[remarks[0].tone];
  return (
    <Popover trigger="click" placement="bottom" open={open} onOpenChange={setOpen} content={<RemarksPanelContent remarks={remarks} />}>
      <span
        role="button"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer',
          border: `1px solid ${meta.color}66`, borderRadius: 10, padding: '1px 6px',
          color: meta.color, fontSize: 10, flexShrink: 0,
        }}
      >
        {meta.icon}
        {remarks.length}
      </span>
    </Popover>
  );
}

function DecisionNode({ data }: NodeProps) {
  const nd = data as { node: GraphNode; satellites: GraphNode[]; links: Link[]; remarks: RemarkPreview[] };
  const n = nd.node;
  const satellites = nd.satellites;
  const links = nd.links;
  const remarks = nd.remarks;
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

      {/* Top-expand: links/related objects of this decision, read in place. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 4 }}>
        <Typography.Text
          style={{ fontSize: 13, color: '#e8e8e8', flex: 1, minWidth: 0, lineHeight: 1.3 }}
          ellipsis={{ tooltip: n.title }}
        >
          {n.title}
        </Typography.Text>
        <LinksExpandButton id={n.id} links={links} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace' }}>
          {n.id}
        </Typography.Text>
        <Typography.Text style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {status}
        </Typography.Text>
      </div>

      {/* Satellites (left) + bottom remarks indicator (right, only if any remarks exist) */}
      {(satellites.length > 0 || remarks.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 'auto', paddingTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
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
          <RemarksIndicator remarks={remarks} />
        </div>
      )}
      <Handle type="source" position={Position.Right} style={{ background: color }} />
    </div>
  );
}

// T-MEMORY-045 "Show tasks" toggle: task create/done events plotted on the
// same time axis as decisions, rendered as small pins (not full cards) on a
// lane above the main line so they never visually blend with decision
// nodes. Created = hollow, done = filled — same color, different fill, so
// "task" reads at a glance without inventing a second palette.
function TaskMarkerNode({ data }: NodeProps) {
  const td = data as { marker: TaskMarker };
  const m = td.marker;
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const Icon = m.kind === 'done' ? CheckCircleOutlined : PlusCircleOutlined;
  const label = m.kind === 'done' ? 'Completed' : 'Created';

  return (
    <Tooltip title={`${label}: ${m.title} (${m.taskId})`}>
      <div
        onClick={(e) => { e.stopPropagation(); setSelectedRecord(m.taskId, 'task'); }}
        style={{
          width: TASK_MARKER_SIZE,
          height: TASK_MARKER_SIZE,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: m.kind === 'done' ? TASK_MARKER_COLOR : '#1f1f1f',
          border: `2px solid ${TASK_MARKER_COLOR}`,
          color: m.kind === 'done' ? '#141414' : TASK_MARKER_COLOR,
          cursor: 'pointer',
          fontSize: 11,
          boxSizing: 'border-box',
        }}
      >
        <Icon />
      </div>
    </Tooltip>
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

const NODE_TYPES = { decision: DecisionNode, tick: TickNode, gapBreak: GapBreakNode, taskMarker: TaskMarkerNode };

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading?: boolean;
  /** Project slug — needed to batch-fetch links/remarks/task-events for the whole timeline in one shot each (T-MEMORY-045). */
  projectSlug: string | null;
  /** "Show tasks" toggle state, owned by the parent (default off) — see ProjectGraphView. */
  showTasks: boolean;
}

export function DecisionTimeline({ nodes, edges, loading, projectSlug, showTasks }: Props) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [centerLabel, setCenterLabel] = useState<string | null>(null);

  // Fetched once per (projectSlug, showTasks) — not per rendered node. See
  // useTimelineOverlay.ts for why this satisfies the "no N+1" requirement.
  const overlay = useTimelineOverlay(projectSlug, showTasks);

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
    // "annotates" edges are excluded — those are remarks, and now have their
    // own dedicated bottom indicator (T-MEMORY-045), so showing them again
    // as a generic dot here would just be the same fact twice.
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
      if (e.relation === 'annotates') continue;
      const fromNode = nodeById.get(e.from);
      const toNode = nodeById.get(e.to);
      if (!fromNode || !toNode) continue;
      if (fromNode.kind === 'DECISION' && toNode.kind !== 'DECISION' && toNode.kind !== 'PROJECT') {
        addSatellite(fromNode.id, toNode);
      } else if (toNode.kind === 'DECISION' && fromNode.kind !== 'DECISION' && fromNode.kind !== 'PROJECT') {
        addSatellite(toNode.id, fromNode);
      }
    }

    // Merge decisions with task create/done markers (when the toggle is on)
    // into one time-sorted sequence so both share the exact same real-time /
    // gap-compressed axis — see computeTimeLayout's per-pair spacing floor.
    const taskEntries: TimelineEntry[] = overlay.taskMarkers.map((m) => ({
      id: `task-${m.id}`,
      createdAt: m.createdAt,
      kind: 'task' as const,
    }));
    const decisionEntries: TimelineEntry[] = decisions.map((d) => ({
      id: d.id,
      createdAt: d.createdAt,
      kind: 'decision' as const,
      status: d.status,
    }));
    const timelineEntries = [...decisionEntries, ...taskEntries].sort(
      (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
    );

    const layout = computeTimeLayout(timelineEntries);

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
      data: {
        node: n,
        satellites: satellitesByDecision.get(n.id) ?? [],
        links: overlay.linksByRecord.get(n.id) ?? [],
        remarks: overlay.remarksByTarget.get(n.id) ?? [],
      },
    }));

    const taskMarkerNodes: Node[] = overlay.taskMarkers.map((m) => {
      const id = `task-${m.id}`;
      return {
        id,
        type: 'taskMarker',
        position: { x: (layout.xById.get(id) ?? 0) - TASK_MARKER_SIZE / 2, y: layout.yById.get(id) ?? 0 },
        width: TASK_MARKER_SIZE,
        height: TASK_MARKER_SIZE,
        selectable: false,
        data: { marker: m },
      };
    });

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

      // Owner: repeating the relation name on every edge label is
      // redundant (arrows + color already say who-relates-to-whom, and the
      // legend explains what the color means) and gets genuinely crowded
      // where one decision has several relates_to edges close together.
      // Only evolution edges get a label, and it's real information — how
      // much time actually passed between the two decisions — not the
      // relation name repeated a second time.
      let label: string | undefined;
      if (isEvolution) {
        const fromNode = nodeById.get(e.from);
        const toNode = nodeById.get(e.to);
        if (fromNode?.createdAt && toNode?.createdAt) {
          const deltaMs = Math.abs(new Date(fromNode.createdAt).getTime() - new Date(toNode.createdAt).getTime());
          label = formatDuration(deltaMs);
        }
      }

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
        label,
        labelStyle: { fill: color, fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: '#141414', fillOpacity: 0.9 },
        labelBgPadding: [4, 2] as [number, number],
      };
    });

    const timePoints = decisions
      .filter((d): d is GraphNode & { createdAt: string } => Boolean(d.createdAt))
      .map((d) => ({ x: layout.xById.get(d.id) ?? 0, iso: d.createdAt }))
      .sort((a, b) => a.x - b.x);

    return {
      flowNodes: [...decisionNodes, ...taskMarkerNodes, ...tickNodes, ...gapNodes],
      flowEdges: rawEdges,
      decisionCount: decisions.length,
      timePoints,
    };
  }, [nodes, edges, overlay]);

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
            if (n.type === 'taskMarker') return TASK_MARKER_COLOR;
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
          Gray = supersedes · purple = revives · blue dotted = relates_to. Label on gray/purple = time between them.
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
        <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
          <LinkOutlined style={{ marginRight: 4 }} />
          on a card opens its links in place · colored badge = has remarks
        </Typography.Text>
        {showTasks && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4, display: 'block' }}>
              Tasks (above axis)
            </Typography.Text>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PlusCircleOutlined style={{ color: TASK_MARKER_COLOR, fontSize: 12 }} />
              <Typography.Text style={{ fontSize: 11 }}>created</Typography.Text>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircleOutlined style={{ color: TASK_MARKER_COLOR, fontSize: 12 }} />
              <Typography.Text style={{ fontSize: 11 }}>done</Typography.Text>
            </div>
          </>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 4 }}>
          {decisionCount} decision{decisionCount === 1 ? '' : 's'} · axis below shows real dates, ⋯Nd⋯ = compressed gap
        </Typography.Text>
      </div>
    </div>
  );
}
