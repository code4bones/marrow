import { CheckCircleOutlined, InfoCircleOutlined, PlusCircleOutlined, RightOutlined } from '@ant-design/icons';
import { Popover, Tag, Tooltip, Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TONE_META } from '../../features/remark/tone';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { GraphEdge, GraphNode, Link } from '../../shared/model/types';
import { type RemarkPreview, type TaskMarker, useTimelineOverlay } from './useTimelineOverlay';
import { RecordLink } from '../../shared/ui/RecordLink';
import { Timestamp } from '../../shared/ui/Timestamp';

// D-MEMORY-021 (supersedes D-MEMORY-020): vertical ribbon, chronological
// top-to-bottom, native mouse-wheel scroll per column — no custom
// scroll-hijacking, no canvas pan/zoom. Clicking a D*-node's drill toggle
// opens a Miller-column (Finder column view) to the right, rooted at that
// node, rendered in the exact same visual style as the baseline ribbon
// (I-MEMORY-045 clarification: NOT a force-directed graph with connector
// lines to scattered nodes — a linear chain of columns, breadcrumb-style).
// This is why @xyflow/react is gone from this file: a canvas that needs
// hijacked wheel handling for pan/zoom can't also deliver "feels native"
// scrolling, so the whole widget moved to plain DOM flow + overflow:auto.
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

// Matches KnowledgeGraph.tsx's (retired) kind palette so a task/item/artifact
// reads the same color whether it's a dot here or elsewhere.
const SATELLITE_KIND_COLOR: Record<string, string> = {
  TASK: '#13a8a8',
  MEMORY: '#d89614',
  ARTIFACT: '#f759ab',
};
const MAX_SATELLITES_SHOWN = 8;

const TASK_MARKER_COLOR = '#177ddc';

const COLUMN_CARD_W = 240;
const COLUMN_OUTER_W = 278;

// Branch-line geometry for a drill column's link list — a persistent trunk
// down the gutter with a stub connecting to each card, not a flat row of
// arrow+tag text (owner's explicit ask after seeing the flat-list version).
const GUTTER_W = 22;
const STUB_Y = 20;
const TRUNK_COLOR = '#434343';

const MS_PER_HOUR = 60 * 60 * 1000;
const GAP_THRESHOLD_MS = 3 * 24 * MS_PER_HOUR;

function formatDuration(ms: number): string {
  const hours = ms / MS_PER_HOUR;
  const days = hours / 24;
  if (days >= 7) return `${Math.round(days / 7)}w`;
  if (days >= 1) return `${Math.round(days)}d`;
  return `${Math.round(hours)}h`;
}

const COLUMN_OUTER_STYLE: CSSProperties = {
  width: COLUMN_OUTER_W,
  flexShrink: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderRight: '1px solid #262626',
};

const COLUMN_TITLE_STYLE: CSSProperties = {
  flexShrink: 0,
  padding: '8px 16px',
  borderBottom: '1px solid #262626',
  background: '#181818',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const COLUMN_SCROLL_STYLE: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '14px 19px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

// Bottom remarks indicator (D-MEMORY-015 feature, reused): read-only preview
// of the same tone-colored cards RemarkPanel renders in the drawer, minus
// the edit affordance — editing stays a drawer-only action.
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

// Drill indicator — purely visual now (the whole card is the click target
// for opening/closing its column, Finder-style; see DecisionCard's own
// onClick). Filled/accent style signals "this is the currently open root
// at its slot in the chain".
function DrillIndicator({ count, isOpen }: { count: number; isOpen: boolean }) {
  const title = isOpen ? 'Open — click card to collapse' : count > 0 ? `${count} link${count === 1 ? '' : 's'} — click card to open as a column` : 'No links yet';
  return (
    <Tooltip title={title}>
      <span
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 18, borderRadius: 4, flexShrink: 0,
          background: isOpen ? '#177ddc' : 'transparent',
          color: isOpen ? '#fff' : count > 0 ? '#8c8c8c' : '#434343',
        }}
      >
        <RightOutlined style={{ fontSize: 11 }} />
      </span>
    </Tooltip>
  );
}

// Opens the full record drawer — the card's own click now drives the drill
// column instead (see DecisionCard's onClick), so viewing full details
// moved to this small dedicated trigger rather than being the card's
// primary action.
function DetailsTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip title="Open full details">
      <span
        role="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 18, borderRadius: 4, cursor: 'pointer', flexShrink: 0, color: '#595959',
        }}
      >
        <InfoCircleOutlined style={{ fontSize: 12 }} />
      </span>
    </Tooltip>
  );
}

interface RelationBadge {
  relation: string;
  direction: 'out' | 'in';
}

// Branch: a fixed-height gutter carrying the trunk line + a stub to the
// child card, with the relation tag floating at the junction — replaces
// the old flat "arrow + tag row above the card" layout. `isLast` stops the
// trunk right after this stub instead of running it the full row height,
// giving the last entry in a column the expected "└" terminator look.
function TreeBranch({ relation, direction, isLast, children }: RelationBadge & { isLast: boolean; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', width: COLUMN_CARD_W, marginBottom: 10 }}>
      <div style={{ width: GUTTER_W, position: 'relative', flexShrink: 0, alignSelf: 'stretch' }}>
        <div style={{ position: 'absolute', left: GUTTER_W / 2, top: 0, width: 1, background: TRUNK_COLOR, height: isLast ? STUB_Y : '100%' }} />
        <div style={{ position: 'absolute', left: GUTTER_W / 2, top: STUB_Y, width: GUTTER_W / 2, height: 1, background: TRUNK_COLOR }} />
        <div style={{ position: 'absolute', left: GUTTER_W / 2 - 2, top: STUB_Y - 2, width: 5, height: 5, borderRadius: '50%', background: TRUNK_COLOR }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2, marginLeft: 2 }}>
          <Typography.Text type="secondary" style={{ fontSize: 10 }}>{direction === 'out' ? '→' : '←'}</Typography.Text>
          <Tag style={{ fontSize: 9, lineHeight: '14px', margin: 0, padding: '0 4px' }}>{relation}</Tag>
        </div>
        {children}
      </div>
    </div>
  );
}

interface DecisionCardProps {
  node: GraphNode;
  satellites: GraphNode[];
  remarks: RemarkPreview[];
  linkCount: number;
  isOpen: boolean;
  onToggleDrill: () => void;
}

// The one card shape reused everywhere: baseline ribbon, a column's own
// root header, and any decision entry inside a column's link list — same
// component, same interaction, per D-MEMORY-021's "тот же визуальный
// стиль, что и baseline-лента" requirement.
function DecisionCard({ node, satellites, remarks, linkCount, isOpen, onToggleDrill }: DecisionCardProps) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const status = node.status ?? 'active';
  const color = STATUS_COLOR[status] ?? '#595959';
  const borderColor = status === 'rejected' ? REJECTED_BORDER : color;
  // T-MEMORY-048 pt.3: last remark's tone now colors the node itself (left
  // edge stripe), not just the bottom counter badge.
  const toneColor = remarks.length > 0 ? TONE_META[remarks[0].tone].color : null;
  const shown = satellites.slice(0, MAX_SATELLITES_SHOWN);
  const overflow = satellites.length - shown.length;

  return (
    <div style={{ width: '100%', marginBottom: 10 }}>
      <div
        onClick={onToggleDrill}
        style={{
          minHeight: 84,
          background: isOpen ? '#1c2a38' : '#1f1f1f',
          border: `2px solid ${borderColor}`,
          borderRadius: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          boxSizing: 'border-box',
          opacity: status === 'superseded' || status === 'archived' ? 0.72 : 1,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: toneColor ? `inset 4px 0 0 0 ${toneColor}` : undefined,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 4 }}>
          <Typography.Text
            style={{ fontSize: 13, color: '#e8e8e8', flex: 1, minWidth: 0, lineHeight: 1.3 }}
            ellipsis={{ tooltip: node.title }}
          >
            {node.title}
          </Typography.Text>
          <DetailsTrigger onClick={() => setSelectedRecord(node.id, 'decision')} />
          <DrillIndicator count={linkCount} isOpen={isOpen} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace' }}>
            {node.id}
          </Typography.Text>
          <Typography.Text style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {status}
          </Typography.Text>
        </div>

        {(satellites.length > 0 || remarks.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 'auto', paddingTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {shown.map((s) => (
                <Tooltip key={s.id} title={`${s.kind}: ${s.title}`}>
                  <div
                    onClick={(e) => { e.stopPropagation(); setSelectedRecord(s.id, s.kind.toLowerCase()); }}
                    style={{ width: 9, height: 9, borderRadius: '50%', background: SATELLITE_KIND_COLOR[s.kind] ?? '#595959', cursor: 'pointer', flexShrink: 0 }}
                  />
                </Tooltip>
              ))}
              {overflow > 0 && <Typography.Text style={{ fontSize: 9, color: '#8c8c8c' }}>+{overflow}</Typography.Text>}
            </div>
            <RemarksIndicator remarks={remarks} />
          </div>
        )}
      </div>
    </div>
  );
}

// Non-decision entries inside a drill column (task/memory/artifact) — click
// opens the record drawer directly, same as a satellite dot; only D*-nodes
// spawn further columns.
function SatelliteEntryRow({ node }: { node: GraphNode }) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const dotColor = SATELLITE_KIND_COLOR[node.kind] ?? '#595959';
  return (
    <div style={{ width: '100%', marginBottom: 10 }}>
      <div
        onClick={() => setSelectedRecord(node.id, node.kind.toLowerCase())}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid #303030', borderRadius: 6, background: '#1a1a1a', cursor: 'pointer' }}
      >
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <Typography.Text style={{ fontSize: 12, color: '#d9d9d9', flex: 1, minWidth: 0 }} ellipsis={{ tooltip: node.title }}>
          {node.title}
        </Typography.Text>
        <Typography.Text style={{ fontSize: 9, color: '#595959', fontFamily: 'monospace' }}>{node.kind}</Typography.Text>
      </div>
    </div>
  );
}

// A link whose other end isn't in the currently loaded graph nodes (depth
// limit) — still shown so the link isn't silently dropped, via the same
// RecordLink chip used elsewhere in the app.
function UnresolvedEntryRow({ id }: { id: string }) {
  return (
    <div style={{ width: '100%', marginBottom: 10 }}>
      <RecordLink id={id} />
    </div>
  );
}

// T-MEMORY-045 "Show tasks" toggle, reoriented as a compact vertical-list
// row instead of a lane-positioned pin (there's no more x/y canvas to pin
// it to). Created = hollow, done = filled, same as before.
function TaskMarkerRow({ marker }: { marker: TaskMarker }) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const Icon = marker.kind === 'done' ? CheckCircleOutlined : PlusCircleOutlined;
  const label = marker.kind === 'done' ? 'Completed' : 'Created';
  return (
    <div style={{ width: COLUMN_CARD_W, marginBottom: 10 }}>
      <div
        onClick={() => setSelectedRecord(marker.taskId, 'task')}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', border: `1px dashed ${TASK_MARKER_COLOR}66`, borderRadius: 14, cursor: 'pointer' }}
      >
        <Icon style={{ color: TASK_MARKER_COLOR, fontSize: 12 }} />
        <Typography.Text style={{ fontSize: 11, color: '#bfbfbf', flex: 1, minWidth: 0 }} ellipsis={{ tooltip: marker.title }}>
          {marker.title}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 9 }}>{label}</Typography.Text>
      </div>
    </div>
  );
}

// Big time gap between consecutive entries — the vertical-axis analog of
// the old "⋯Nd⋯" horizontal compression break.
function GapRow({ label }: { label: string }) {
  return (
    <div style={{ width: COLUMN_CARD_W, marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <div style={{ width: 1, height: 14, borderLeft: '1px dashed #595959' }} />
      <Typography.Text type="secondary" style={{ fontSize: 10, fontStyle: 'italic' }}>{label}</Typography.Text>
      <div style={{ width: 1, height: 14, borderLeft: '1px dashed #595959' }} />
    </div>
  );
}

// `headerIso` is set on a row when a sticky day-header should render just
// above it (first row of a new calendar day) — computed once here, in a
// plain data-building pass, rather than by mutating a variable inside the
// JSX-producing .map() in the column components (which the React Compiler
// correctly refuses to treat as pure).
type BaselineRow =
  | { kind: 'decision'; node: GraphNode; headerIso: string | null }
  | { kind: 'task'; marker: TaskMarker; headerIso: string | null }
  | { kind: 'gap'; label: string };

function buildBaselineRows(decisions: GraphNode[], taskMarkers: TaskMarker[]): BaselineRow[] {
  const decisionEntries = decisions.map((d) => ({ kind: 'decision' as const, node: d, createdAt: d.createdAt }));
  const taskEntries = taskMarkers.map((m) => ({ kind: 'task' as const, marker: m, createdAt: m.createdAt as string | null }));
  const merged = [...decisionEntries, ...taskEntries].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

  const rows: BaselineRow[] = [];
  let prevTime: number | null = null;
  let lastDay: string | null = null;
  for (const entry of merged) {
    const t = entry.createdAt ? new Date(entry.createdAt).getTime() : NaN;
    if (prevTime !== null && !Number.isNaN(t)) {
      const delta = t - prevTime;
      if (delta > GAP_THRESHOLD_MS) rows.push({ kind: 'gap', label: `⋯ ${formatDuration(delta)} ⋯` });
    }
    if (!Number.isNaN(t)) prevTime = t;
    const day = dayKey(entry.createdAt);
    const headerIso = day && day !== lastDay ? entry.createdAt : null;
    if (day) lastDay = day;
    rows.push(entry.kind === 'decision' ? { kind: 'decision', node: entry.node, headerIso } : { kind: 'task', marker: entry.marker, headerIso });
  }
  return rows;
}

type DrillRow =
  | { kind: 'entry'; id: string; link: Link; node: GraphNode | null; headerIso: string | null }
  | { kind: 'gap'; label: string };

function buildDrillRows(rootId: string, linksByRecord: Map<string, Link[]>, nodeById: Map<string, GraphNode>): DrillRow[] {
  const links = linksByRecord.get(rootId) ?? [];
  const resolved = links.map((link) => {
    const otherId = link.fromId === rootId ? link.toId : link.fromId;
    return { link, id: otherId, node: nodeById.get(otherId) ?? null };
  });
  // Chronological when we know the other end's date; unresolvable/undated
  // ones keep the query's own order at the end rather than being dropped.
  const withDate = resolved.filter((r) => r.node?.createdAt).sort((a, b) => (a.node!.createdAt as string).localeCompare(b.node!.createdAt as string));
  const withoutDate = resolved.filter((r) => !r.node?.createdAt);
  const ordered = [...withDate, ...withoutDate];

  const rows: DrillRow[] = [];
  let prevTime: number | null = null;
  // Seeded with the root's own day so an entry sharing the root's date
  // doesn't render a redundant header right under the root card.
  let lastDay: string | null = dayKey(nodeById.get(rootId)?.createdAt);
  for (const r of ordered) {
    const t = r.node?.createdAt ? new Date(r.node.createdAt).getTime() : NaN;
    if (prevTime !== null && !Number.isNaN(t)) {
      const delta = t - prevTime;
      if (delta > GAP_THRESHOLD_MS) rows.push({ kind: 'gap', label: `⋯ ${formatDuration(delta)} ⋯` });
    }
    if (!Number.isNaN(t)) prevTime = t;
    const day = dayKey(r.node?.createdAt);
    const headerIso = day && day !== lastDay ? (r.node?.createdAt ?? null) : null;
    if (day) lastDay = day;
    rows.push({ kind: 'entry', id: r.id, link: r.link, node: r.node, headerIso });
  }
  return rows;
}

// Sticky "where am I" date, replacing the old horizontal MiniMap/seek per
// D-MEMORY-020/021's recommendation ("sticky-дата сбоку при скролле"
// instead of a full thumbnail minimap). Implemented as native CSS
// `position: sticky` day-group headers threaded through the row list —
// the browser pins the current day's label to the top of the column
// while you scroll past it, for free, with no scroll listener, no ref
// bookkeeping, and no derived-state effect to keep in sync.
function dayKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '?';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STICKY_DAY_STYLE: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  width: COLUMN_CARD_W,
  marginBottom: 8,
  padding: '3px 0',
  background: '#141414',
  borderBottom: '1px solid #262626',
};

function StickyDayLabel({ iso }: { iso: string }) {
  return (
    <div style={STICKY_DAY_STYLE}>
      <Typography.Text type="secondary" style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.4 }}>
        {formatDayLabel(iso)}
      </Typography.Text>
    </div>
  );
}

interface ColumnCommonProps {
  nodeById: Map<string, GraphNode>;
  satellitesByDecision: Map<string, GraphNode[]>;
  linksByRecord: Map<string, Link[]>;
  remarksByTarget: Map<string, RemarkPreview[]>;
  chain: string[];
  onToggle: (id: string, level: number) => void;
}

function BaselineColumn({ rows, ...common }: { rows: BaselineRow[] } & ColumnCommonProps) {
  const { satellitesByDecision, linksByRecord, remarksByTarget, chain, onToggle } = common;

  return (
    <div style={COLUMN_OUTER_STYLE}>
      <div style={COLUMN_TITLE_STYLE}>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Timeline
        </Typography.Text>
      </div>
      <div style={COLUMN_SCROLL_STYLE}>
        {rows.map((row, i) => {
          if (row.kind === 'gap') return <GapRow key={`gap-${i}`} label={row.label} />;
          const rowKey = row.kind === 'task' ? `task-${row.marker.id}` : row.node.id;
          const body = row.kind === 'task'
            ? <TaskMarkerRow marker={row.marker} />
            : (
              <DecisionCard
                node={row.node}
                satellites={satellitesByDecision.get(row.node.id) ?? []}
                remarks={remarksByTarget.get(row.node.id) ?? []}
                linkCount={(linksByRecord.get(row.node.id) ?? []).length}
                isOpen={chain[0] === row.node.id}
                onToggleDrill={() => onToggle(row.node.id, 0)}
              />
            );
          return (
            <div key={rowKey} style={{ display: 'flex', flexDirection: 'column', width: COLUMN_CARD_W }}>
              {row.headerIso && <StickyDayLabel iso={row.headerIso} />}
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DrillColumn({ rootId, level, ...common }: { rootId: string; level: number } & ColumnCommonProps) {
  const { nodeById, satellitesByDecision, linksByRecord, remarksByTarget, chain, onToggle } = common;
  const rootNode = nodeById.get(rootId);
  const rows = useMemo(() => (rootNode ? buildDrillRows(rootId, linksByRecord, nodeById) : []), [rootNode, rootId, linksByRecord, nodeById]);

  if (!rootNode) return null;
  const activeChildId = chain[level + 1];

  return (
    <div style={COLUMN_OUTER_STYLE}>
      <div style={COLUMN_TITLE_STYLE}>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }} ellipsis={{ tooltip: `Links of ${rootId}` }}>
          Links of {rootId}
        </Typography.Text>
      </div>
      <div style={COLUMN_SCROLL_STYLE}>
        <div style={{ width: COLUMN_CARD_W }}>
          <DecisionCard
            node={rootNode}
            satellites={satellitesByDecision.get(rootId) ?? []}
            remarks={remarksByTarget.get(rootId) ?? []}
            linkCount={(linksByRecord.get(rootId) ?? []).length}
            isOpen
            onToggleDrill={() => onToggle(rootId, level)}
          />
        </div>
        <div style={{ width: COLUMN_CARD_W, height: 1, background: '#303030', margin: '2px 0 10px' }} />
        {rows.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>No links yet</Typography.Text>
        )}
        {(() => {
          // Index of the last 'entry' row (ignoring gap rows in between) —
          // that entry's branch stops its trunk right after its own stub
          // instead of running the line further down (the "└" terminator).
          const lastEntryIdx = rows.reduce((acc, r, i) => (r.kind === 'entry' ? i : acc), -1);
          return rows.map((row, i) => {
            if (row.kind === 'gap') return <GapRow key={`gap-${i}`} label={row.label} />;
            const direction: 'out' | 'in' = row.link.fromId === rootId ? 'out' : 'in';
            const header = row.headerIso ? <StickyDayLabel key={`day-${row.link.id}`} iso={row.headerIso} /> : null;
            const isLast = i === lastEntryIdx;

            const inner = row.node?.kind === 'DECISION'
              ? (
                <DecisionCard
                  node={row.node}
                  satellites={satellitesByDecision.get(row.node.id) ?? []}
                  remarks={remarksByTarget.get(row.node.id) ?? []}
                  linkCount={(linksByRecord.get(row.node.id) ?? []).length}
                  isOpen={activeChildId === row.node.id}
                  onToggleDrill={() => onToggle(row.node!.id, level + 1)}
                />
              )
              : row.node
                ? <SatelliteEntryRow node={row.node} />
                : <UnresolvedEntryRow id={row.id} />;

            return (
              <div key={row.link.id} style={{ display: 'flex', flexDirection: 'column', width: COLUMN_CARD_W }}>
                {header}
                <TreeBranch relation={row.link.relation} direction={direction} isLast={isLast}>
                  {inner}
                </TreeBranch>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

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
  const rowRef = useRef<HTMLDivElement>(null);
  // The one open Miller-column chain (D-MEMORY-021: linear, breadcrumb-
  // style, exactly one path open at a time). chain[i] is the decision id
  // whose links are shown as column i (0-based, displayed right of the
  // baseline ribbon or of column i-1).
  const [chain, setChain] = useState<string[]>([]);

  // Fetched once per (projectSlug, showTasks) — not per rendered node. See
  // useTimelineOverlay.ts for why this satisfies the "no N+1" requirement.
  const overlay = useTimelineOverlay(projectSlug, showTasks);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const { decisions, satellitesByDecision } = useMemo(() => {
    const decisions = nodes
      .filter((n) => n.kind === 'DECISION')
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

    // Satellites: any other record (task/item/artifact) linked to a decision
    // by any relation — rendered as small dots on the decision card. Reused
    // for every DecisionCard instance, wherever it's rendered (baseline,
    // column header, column entry), since the map covers every decision id
    // discovered anywhere in the loaded graph.
    const satellitesByDecision = new Map<string, GraphNode[]>();
    const addSatellite = (decisionId: string, satellite: GraphNode) => {
      const list = satellitesByDecision.get(decisionId) ?? [];
      if (!list.some((s) => s.id === satellite.id)) list.push(satellite);
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
    return { decisions, satellitesByDecision };
  }, [nodes, edges, nodeById]);

  const baselineRows = useMemo(() => buildBaselineRows(decisions, overlay.taskMarkers), [decisions, overlay.taskMarkers]);

  // Defensive: if a graph refetch drops an id mid-chain (rare — depth
  // change, project switch), truncate rather than render a column with no
  // root. Click-time ids are always valid, so this only ever fires on data
  // changing out from under an open chain.
  const validChain = useMemo(() => {
    const out: string[] = [];
    for (const id of chain) {
      if (!nodeById.has(id)) break;
      out.push(id);
    }
    return out;
  }, [chain, nodeById]);

  // The single rule implementing D-MEMORY-021's click mechanics for every
  // slot in the chain at once (baseline click, a column's own root card,
  // or an entry inside a column's link list): re-clicking whatever is
  // already open at this slot collapses it and everything to its right;
  // clicking anything else opens it here and drops everything past it.
  const handleToggle = useCallback((id: string, level: number) => {
    setChain((prev) => (prev[level] === id ? prev.slice(0, level) : [...prev.slice(0, level), id]));
  }, []);

  // Mirrors Finder auto-scrolling to reveal a freshly opened column instead
  // of leaving it clipped off the right edge.
  useEffect(() => {
    if (validChain.length === 0 || !rowRef.current) return;
    rowRef.current.scrollTo({ left: rowRef.current.scrollWidth, behavior: 'smooth' });
  }, [validChain.length]);

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="secondary">Loading timeline…</Typography.Text>
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Typography.Text type="secondary">No decisions recorded yet</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          The timeline fills in as decision.record / decision.supersede are used
        </Typography.Text>
      </div>
    );
  }

  const common: ColumnCommonProps = {
    nodeById,
    satellitesByDecision,
    linksByRecord: overlay.linksByRecord,
    remarksByTarget: overlay.remarksByTarget,
    chain: validChain,
    onToggle: handleToggle,
  };

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div ref={rowRef} style={{ height: '100%', display: 'flex', overflowX: 'auto', overflowY: 'hidden', background: '#141414' }}>
        <BaselineColumn rows={baselineRows} {...common} />
        {validChain.map((rootId, idx) => (
          <DrillColumn key={`${rootId}@${idx}`} rootId={rootId} level={idx} {...common} />
        ))}
      </div>

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
        pointerEvents: 'none',
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
          <RightOutlined style={{ marginRight: 4 }} />
          opens a card&apos;s links as a column to the right · left edge = last remark tone · badge = remark count
        </Typography.Text>
        {showTasks && (
          <>
            <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4, display: 'block' }}>
              Tasks
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
          {decisions.length} decision{decisions.length === 1 ? '' : 's'} · ⋯Nd⋯ = compressed gap · one open column chain at a time
        </Typography.Text>
      </div>
    </div>
  );
}
