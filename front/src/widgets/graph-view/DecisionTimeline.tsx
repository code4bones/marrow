import {
  CheckCircleOutlined, CloseOutlined, InfoCircleOutlined, PlusCircleOutlined, RightOutlined, SearchOutlined,
} from '@ant-design/icons';
import { AutoComplete, Input, Popover, Spin, Tag, Tooltip, Typography } from 'antd';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TONE_META } from '../../features/remark/tone';
import { TASK_STATUS_COLOR } from '../../features/task/taskStatusColor';
import { ENTITY_COLOR, SATELLITE_KIND_COLOR } from '../../shared/lib/entityId';
import { formatGraphTimestamp } from '../../shared/lib/graphTimestamp';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { GraphEdge, GraphNode, Link, RecordWrapper } from '../../shared/model/types';
import { type RemarkPreview, type TaskMarker, useTimelineOverlay } from './useTimelineOverlay';
import { apolloClient } from '../../shared/api/apollo';
import { GET_RECORD } from '../../shared/api/queries';
import { RecordLink } from '../../shared/ui/RecordLink';
import { rootKindEmptyHint, rootKindLabel, type RootKind } from './rootKind';
import { STATUS_COLORS as GENERIC_STATUS_COLORS } from '../../shared/ui/statusColors';
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
// "accepted" (formerly "active", then "current" -- see migrations 037 and
// 041) means "adopted and still in force, not superseded". Decision-only:
// memory/artifact statuses still use "current" (see GENERIC_STATUS_COLORS
// below), decisions do not.
const STATUS_COLOR: Record<string, string> = {
  accepted: '#52c41a',
  draft: '#d89614',
  superseded: '#8c8c8c',
  rejected: '#8c8c8c',
  archived: '#595959',
};

const REJECTED_BORDER = '#a61d24';

// Right-hand gutter reserved on RecordCard's title area for the top-right
// status badge (see RecordCard) — sized for the longest realistic status
// value ("superseded", "cancelled") at the badge's 9px font plus its own
// pill padding/border, with a little slack. A tighter 62px was tried first
// and visually clipped even 8-letter values like "accepted"/"archived"/
// "rejected" into "ACCEPT…"/"ARCHIV…"/"REJECT…" — 92px was the smallest
// that read every status in full at a live check.
const STATUS_BADGE_RESERVE_PX = 92;

function statusLabels(t: (key: string) => string): Record<string, string> {
  return {
    accepted: t('legendStatusAccepted'),
    draft: t('legendStatusDraft'),
    superseded: t('legendStatusSuperseded'),
    rejected: t('legendStatusRejected'),
    archived: t('legendStatusArchived'),
  };
}

// D-MEMORY-022: drill is no longer decision-only, so the card's status
// swatch has to make sense for any kind. Rather than invent a fourth
// palette, this reuses whatever's already canonical for that kind:
//   - DECISION keeps the hex map above (unchanged — it's what the legend
//     and the always-visible baseline ribbon already show).
//   - TASK reuses TASK_STATUS_COLOR, the exact mapping the Tasks list page
//     renders in its status column (features/task/TaskStatusSelect).
//   - everything else (MEMORY, ARTIFACT, and any future kind) reuses
//     shared/ui/StatusBadge's mapping — the one component already rendered
//     for memory/artifact/project/fault statuses everywhere else in the
//     app — translated from antd's named Tag colors to hex so it can drive
//     this card's border/text the same way the decision palette does.
//     (StatusBadge's own map is missing a few real task values like
//     "todo"/"doing"/"cancelled" — pre-existing gap in that shared
//     component, not touched here; that's exactly why TASK gets its own
//     branch above instead of falling through to this one.)
const ANTD_TAG_HEX: Record<string, string> = {
  green: '#52c41a', blue: '#177ddc', orange: '#d89614', red: '#a61d24', purple: '#722ed1', default: '#595959',
};

function statusColorFor(kind: string, status: string): string {
  if (kind === 'DECISION') return STATUS_COLOR[status] ?? '#595959';
  if (kind === 'TASK') return TASK_STATUS_COLOR[status] ?? '#595959';
  return ANTD_TAG_HEX[GENERIC_STATUS_COLORS[status] ?? 'default'] ?? '#595959';
}

// A lot of titles in this project follow a "Scope: actual title" convention
// (e.g. "PMemUI Timeline: вертикальная лента..."). Repeated verbatim on
// every card, that scope prefix used to eat the single-line ellipsis
// budget before the actually-distinguishing text ever showed (owner:
// "мы на каждой ноде пишем [project-name]:xxxx, зачем?"). Split it out into
// a small muted label instead of dropping it — it's still real information
// (which area a decision/task belongs to), just not the headline.
const TITLE_PREFIX_RE = /^([^:]{2,40}):\s+(.+)$/s;

function splitTitlePrefix(title: string): { prefix: string | null; rest: string } {
  const m = TITLE_PREFIX_RE.exec(title);
  return m ? { prefix: m[1], rest: m[2] } : { prefix: null, rest: title };
}

// Small kind-identity dot used in the root-search dropdown (id/title match
// across all kinds) — reuses the app's one canonical kind→color mapping
// (shared/lib/entityId.ts, the same one RecordLink chips use) rather than
// SATELLITE_KIND_COLOR (also imported from entityId.ts), which only covers
// non-decision satellite dots and doesn't include decision itself.
function kindDotColor(kind: string): string {
  return ENTITY_COLOR[kind.toLowerCase() as keyof typeof ENTITY_COLOR] ?? ENTITY_COLOR.unknown;
}

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
  const { t } = useTranslation('decisions');
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
        {t('editRemarksFromDrawer')}
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
// for opening/closing its column, Finder-style; see RecordCard's own
// onClick). Filled/accent style signals "this is the currently open root
// at its slot in the chain".
function DrillIndicator({ count, isOpen }: { count: number; isOpen: boolean }) {
  const { t } = useTranslation('decisions');
  const title = isOpen ? t('openClickToCollapse') : count > 0 ? t('linksClickToOpenColumn', { count }) : t('noLinksYet');
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
// column instead (see RecordCard's onClick), so viewing full details
// moved to this small dedicated trigger rather than being the card's
// primary action.
function DetailsTrigger({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('decisions');
  return (
    <Tooltip title={t('openFullDetails')}>
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

interface RecordCardProps {
  node: GraphNode;
  satellites: GraphNode[];
  remarks: RemarkPreview[];
  linkCount: number;
  isOpen: boolean;
  onToggleDrill: () => void;
  /**
   * False for the header card at the top of an already-open drill column —
   * that card IS the column (its own links are already showing right below
   * it), so there is no further "drill into it" action for a click to do.
   * Making it clickable anyway meant a click there could only ever collapse
   * the column, which reads as "the node I clicked just disappeared"
   * (reported after v0.9.1 shipped click-to-drill) — the fix is to make
   * that card inert and give the column an explicit close control instead
   * (see DrillColumn's title bar). Defaults true for every other usage
   * (baseline ribbon, entries inside a column's link list).
   */
  interactive?: boolean;
}

// The one card shape reused everywhere: baseline ribbon (decisions only),
// a column's own root header, and any entry inside a column's link list —
// same component, same interaction, per D-MEMORY-021's "тот же визуальный
// стиль, что и baseline-лента" requirement. D-MEMORY-022 generalized this
// from decisions-only to any kind (decision/task/memory/artifact) — the
// card itself was already kind-agnostic in shape, it just needed its status
// swatch to stop assuming decision statuses (see statusColorFor above) and
// its details-trigger to stop hardcoding 'decision' as the drawer type.
function RecordCard({ node, satellites, remarks, linkCount, isOpen, onToggleDrill, interactive = true }: RecordCardProps) {
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const status = node.status ?? 'active';
  const color = statusColorFor(node.kind, status);
  const borderColor = node.kind === 'DECISION' && status === 'rejected' ? REJECTED_BORDER : color;
  // T-MEMORY-048 pt.3: last remark's tone now colors the node itself (left
  // edge stripe), not just the bottom counter badge.
  const toneColor = remarks.length > 0 ? TONE_META[remarks[0].tone].color : null;
  const shown = satellites.slice(0, MAX_SATELLITES_SHOWN);
  const overflow = satellites.length - shown.length;
  const { prefix: titlePrefix, rest: titleRest } = splitTitlePrefix(node.title);
  const stamp = formatGraphTimestamp(node.createdAt);

  return (
    <div style={{ width: '100%', marginBottom: 10 }}>
      <div
        onClick={interactive ? onToggleDrill : undefined}
        style={{
          minHeight: 84,
          background: isOpen ? '#1c2a38' : '#1f1f1f',
          border: `2px solid ${borderColor}`,
          borderRadius: 6,
          padding: '8px 12px',
          cursor: interactive ? 'pointer' : 'default',
          boxSizing: 'border-box',
          opacity: status === 'superseded' || status === 'archived' || status === 'cancelled' ? 0.72 : 1,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: toneColor ? `inset 4px 0 0 0 ${toneColor}` : undefined,
          // Anchors the top-right status badge below (position: absolute)
          // to this card rather than to the page.
          position: 'relative',
        }}
      >
        {/* Reserves a right-hand gutter (STATUS_BADGE_RESERVE_PX) across
            BOTH the optional title-prefix line and the title row, so the
            absolutely-positioned status badge below never overlaps the
            title text, the title-prefix's own ellipsis, or the title row's
            own DetailsTrigger/DrillIndicator icon cluster — regardless of
            which of those are present for a given card. */}
        <div style={{ paddingRight: STATUS_BADGE_RESERVE_PX }}>
          {titlePrefix && (
            <Typography.Text
              style={{ fontSize: 9.5, color: '#8c8c8c', textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 1 }}
              ellipsis={{ tooltip: titlePrefix }}
            >
              {titlePrefix}
            </Typography.Text>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 4 }}>
            <Typography.Text
              style={{ fontSize: 13, color: '#e8e8e8', flex: 1, minWidth: 0, lineHeight: 1.3 }}
              ellipsis={{ tooltip: node.title }}
            >
              {titleRest}
            </Typography.Text>
            {/* Was hardcoded to 'decision' before D-MEMORY-022 generalized
                this card to any kind — a task/memory/artifact root card
                would have opened the wrong drawer type otherwise. */}
            <DetailsTrigger onClick={() => setSelectedRecord(node.id, node.kind.toLowerCase())} />
            {interactive && <DrillIndicator count={linkCount} isOpen={isOpen} />}
          </div>
        </div>

        {/* Status used to share the id/timestamp row below, which squeezed
            it out on longer ids/timestamps or narrower cards. Now a small
            pill straddling the card's top-right corner instead (top: 0 +
            translateY(-50%), the usual "floating" badge treatment — half
            outside the border, half inside) — borderColor above already
            conveys status via the card's border color, this is just the
            label. Plain antd Tag rather than a hand-rolled div: a raw div
            with a translucent background looked washed-out floating over
            two different backdrops (card interior vs. the gap behind it),
            and Typography.Text's own line-height sat the text low inside
            the pill. Tag's custom-color mode gives a solid fill with
            correctly-centered text for free. */}
        <Tag
          color={color}
          style={{
            position: 'absolute',
            top: 0,
            right: 10,
            transform: 'translateY(-50%)',
            zIndex: 1,
            margin: 0,
            maxWidth: STATUS_BADGE_RESERVE_PX - 4,
            padding: '0 6px',
            lineHeight: '16px',
            fontSize: 9,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {status}
        </Tag>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace' }}>
            {node.id}
          </Typography.Text>
          {stamp && (
            <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace' }}>
              {stamp}
            </Typography.Text>
          )}
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

// A link whose other end isn't in the currently loaded graph nodes (depth
// limit) *and* hasn't come back from the lazy point-lookup yet (or the
// lookup failed) — still shown so the link isn't silently dropped, via the
// same RecordLink chip used elsewhere in the app. D-MEMORY-022: this used
// to be permanent for anything outside the loaded graph; now it's just the
// brief/failure state while DrillColumn's resolve effect (below) fetches
// the missing node via a point `record(id)` lookup.
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
  const { t } = useTranslation('decisions');
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);
  const Icon = marker.kind === 'done' ? CheckCircleOutlined : PlusCircleOutlined;
  const label = marker.kind === 'done' ? t('completed') : t('createdLabel');
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
  // Matches shared/ui/Timestamp.tsx's convention: dates always render in
  // ru-RU formatting regardless of UI language (not translation-key driven,
  // a deliberate app-wide choice) -- this was previously hardcoded to
  // 'en-GB', so a Russian-language session still saw English month
  // abbreviations ("09 Aug 2026") in these sticky day headers.
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
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
  satellitesByRecord: Map<string, GraphNode[]>;
  linksByRecord: Map<string, Link[]>;
  remarksByTarget: Map<string, RemarkPreview[]>;
  chain: string[];
  onToggle: (id: string, level: number) => void;
  /**
   * D-MEMORY-022 pt.3: point-lookup a single node missing from `nodeById`
   * (a link target beyond the loaded graph's depth limit) via `record(id)`.
   * Idempotent/deduped by the resolver that owns this — safe to call for
   * the same id repeatedly (e.g. every render of a still-unresolved row).
   */
  resolveNode: (id: string) => void;
}

// Root-changing search (D-MEMORY-022 pt.2) — client-side substring match
// over id/title across every kind in the already-loaded project graph (no
// new backend query). Deliberately does NOT reach into the lazy per-node
// resolver: a node absent from `nodes` can't be a search result in the
// first place (nothing to match its title against), so there's no "type an
// id, nothing found, silently fails to lazy-resolve" gap here — see the
// task note on T-MEMORY-049 for why this is a moot case, not a cut corner.
const MAX_SEARCH_RESULTS = 20;

function RootSearch({ nodes, onSelect }: { nodes: GraphNode[]; onSelect: (id: string) => void }) {
  const { t } = useTranslation('decisions');
  const [query, setQuery] = useState('');

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return nodes
      .filter((n) => n.id.toLowerCase().includes(q) || n.title.toLowerCase().includes(q))
      .slice(0, MAX_SEARCH_RESULTS)
      .map((n) => ({
        value: n.id,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: kindDotColor(n.kind), flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace', flexShrink: 0 }}>{n.id}</span>
            <span style={{ fontSize: 12, color: '#d9d9d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {n.title}
            </span>
          </div>
        ),
      }));
  }, [nodes, query]);

  return (
    <AutoComplete
      value={query}
      options={options}
      onSearch={setQuery}
      onSelect={(id) => { onSelect(id as string); setQuery(''); }}
      style={{ width: '100%' }}
      popupMatchSelectWidth={300}
    >
      <Input
        size="small"
        placeholder={t('findAnyRecordPlaceholder')}
        prefix={<SearchOutlined style={{ color: '#595959', fontSize: 11 }} />}
        allowClear
        onClick={(e) => e.stopPropagation()}
      />
    </AutoComplete>
  );
}

function BaselineColumn({ rows, allNodes, onSelectRoot, rootKind, ...common }: {
  rows: BaselineRow[];
  allNodes: GraphNode[];
  onSelectRoot: (id: string) => void;
  rootKind: RootKind;
} & ColumnCommonProps) {
  const { t } = useTranslation('decisions');
  const { satellitesByRecord, linksByRecord, remarksByTarget, chain, onToggle } = common;

  return (
    <div style={COLUMN_OUTER_STYLE}>
      <div style={COLUMN_TITLE_STYLE}>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          {rootKindLabel(t, rootKind)}
        </Typography.Text>
        <RootSearch nodes={allNodes} onSelect={onSelectRoot} />
      </div>
      <div style={COLUMN_SCROLL_STYLE}>
        {rows.map((row, i) => {
          if (row.kind === 'gap') return <GapRow key={`gap-${i}`} label={row.label} />;
          const rowKey = row.kind === 'task' ? `task-${row.marker.id}` : row.node.id;
          const body = row.kind === 'task'
            ? <TaskMarkerRow marker={row.marker} />
            : (
              <RecordCard
                node={row.node}
                satellites={satellitesByRecord.get(row.node.id) ?? []}
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
  const { t } = useTranslation('decisions');
  const { nodeById, satellitesByRecord, linksByRecord, remarksByTarget, chain, onToggle, resolveNode } = common;
  const rootNode = nodeById.get(rootId);
  const rows = useMemo(() => (rootNode ? buildDrillRows(rootId, linksByRecord, nodeById) : []), [rootNode, rootId, linksByRecord, nodeById]);

  // D-MEMORY-022 pt.3: any entry whose other end isn't in nodeById yet gets
  // a point `record(id)` lookup kicked off here. Guarded/deduped inside the
  // resolver itself (see useNodeResolver in DecisionTimeline below), so this
  // firing again on every re-render of an already-pending or already-failed
  // id is a cheap no-op, not a repeat network call.
  const unresolvedIds = useMemo(
    () => rows.filter((r): r is Extract<DrillRow, { kind: 'entry' }> => r.kind === 'entry' && !r.node).map((r) => r.id),
    [rows],
  );
  useEffect(() => {
    for (const id of unresolvedIds) resolveNode(id);
  }, [unresolvedIds, resolveNode]);

  // The ROOT itself can also be missing from nodeById — e.g. a search
  // result (D-MEMORY-022 pt.2) or a deep-linked id that was never part of
  // the depth-limited project graph in the first place. The block above
  // only resolves this column's own LINK entries once rootNode already
  // exists; without this, a missing root silently rendered nothing at all
  // (found live: "поиск вижу, смену фокуса не вижу" — search worked, but
  // selecting an out-of-graph result produced no visible column).
  useEffect(() => {
    if (!rootNode) resolveNode(rootId);
  }, [rootNode, rootId, resolveNode]);

  if (!rootNode) {
    return (
      <div style={COLUMN_OUTER_STYLE}>
        <div style={COLUMN_TITLE_STYLE}>
          <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600 }}>
            {t('loadingEllipsis')}
          </Typography.Text>
        </div>
        <div style={{ ...COLUMN_SCROLL_STYLE, justifyContent: 'center' }}>
          <Spin size="small" />
        </div>
      </div>
    );
  }
  const activeChildId = chain[level + 1];

  return (
    <div style={COLUMN_OUTER_STYLE}>
      <div style={{ ...COLUMN_TITLE_STYLE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 600, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: t('linksOf', { id: rootId }) }}>
          {t('linksOf', { id: rootId })}
        </Typography.Text>
        {/* Closing this column is the only action left for the root card
            below — it's inert (see RecordCard's `interactive` prop), so a
            re-click there can no longer make it appear to "vanish". */}
        <Tooltip title={t('closeThisColumn')}>
          <span
            role="button"
            onClick={() => onToggle(rootId, level)}
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 18, borderRadius: 4, cursor: 'pointer', color: '#8c8c8c', flexShrink: 0 }}
          >
            <CloseOutlined style={{ fontSize: 11 }} />
          </span>
        </Tooltip>
      </div>
      <div style={COLUMN_SCROLL_STYLE}>
        <div style={{ width: COLUMN_CARD_W }}>
          <RecordCard
            node={rootNode}
            satellites={satellitesByRecord.get(rootId) ?? []}
            remarks={remarksByTarget.get(rootId) ?? []}
            linkCount={(linksByRecord.get(rootId) ?? []).length}
            isOpen
            interactive={false}
            onToggleDrill={() => {}}
          />
        </div>
        <div style={{ width: COLUMN_CARD_W, height: 1, background: '#303030', margin: '2px 0 10px' }} />
        {rows.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('noLinksYet')}</Typography.Text>
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

            // D-MEMORY-022 pt.1: every kind drills now, not just decisions —
            // any resolved node (whether from the loaded graph or from the
            // lazy point-lookup above) renders as a full, clickable RecordCard.
            // Only a still-unresolved (or unresolvable) id falls back to the
            // inert id chip.
            const inner = row.node
              ? (
                <RecordCard
                  node={row.node}
                  satellites={satellitesByRecord.get(row.node.id) ?? []}
                  remarks={remarksByTarget.get(row.node.id) ?? []}
                  linkCount={(linksByRecord.get(row.node.id) ?? []).length}
                  isOpen={activeChildId === row.node.id}
                  onToggleDrill={() => onToggle(row.node!.id, level + 1)}
                />
              )
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

// Minimal shape we need out of `record(id)`'s polymorphic payload — every
// kind this timeline actually drills into (Task/Decision/Artifact/
// MemoryRecord) carries title/status/createdAt, which is all a synthesized
// GraphNode needs to slot into the exact same rendering path as a node that
// came from the batch project-graph query.
interface LazyRecordPayload {
  title?: string;
  status?: string | null;
  createdAt?: string | null;
}

// D-MEMORY-022 pt.3: point-resolves a node missing from the depth-limited
// project graph (a link target beyond `depth`) via the existing `record(id)`
// query — reusing GET_RECORD, the exact document the detail drawer already
// uses, so no new GraphQL was added for this. Deliberately one request per
// distinct missing id rather than a batch: the task scope is explicit that
// this point-lookup must NOT replace the batched linksByRecord/remarksByTarget
// approach for a column's own link list (T-MEMORY-045) — it only covers the
// individual "this one id isn't in the loaded graph" gap.
function useLazyNodeResolver() {
  const [resolved, setResolved] = useState<Map<string, GraphNode>>(new Map());
  // Mirrors `resolved` for synchronous reads inside resolveNode (a plain
  // callback, not a render), plus the in-flight/failed bookkeeping that has
  // no business being React state at all — none of this should ever cause
  // its own re-render. Synced in an effect (not during render) since
  // mutating a ref's `.current` while rendering is itself disallowed.
  const resolvedRef = useRef(resolved);
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);
  const bookkeepingRef = useRef({ pending: new Set<string>(), failed: new Set<string>() });

  const resolveNode = useCallback((id: string) => {
    const bk = bookkeepingRef.current;
    if (resolvedRef.current.has(id) || bk.pending.has(id) || bk.failed.has(id)) return;
    bk.pending.add(id);
    apolloClient.query<{ record: RecordWrapper }>({ query: GET_RECORD, variables: { id } })
      .then(({ data }) => {
        const rec = data?.record;
        if (!rec || !rec.record) { bk.failed.add(id); return; }
        const payload = rec.record as unknown as LazyRecordPayload;
        const node: GraphNode = {
          id: rec.id,
          kind: rec.kind,
          title: payload.title ?? rec.id,
          status: payload.status ?? null,
          createdAt: payload.createdAt ?? null,
        };
        setResolved((cur) => {
          if (cur.has(id)) return cur;
          const next = new Map(cur);
          next.set(id, node);
          return next;
        });
      })
      .catch(() => { bk.failed.add(id); })
      .finally(() => { bk.pending.delete(id); });
  }, []);

  return { resolved, resolveNode };
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading?: boolean;
  /** Project slug — needed to batch-fetch links/remarks/task-events for the whole timeline in one shot each (T-MEMORY-045). */
  projectSlug: string | null;
  /** "Show tasks" toggle state, owned by the parent (default off, DECISION-root only) — see ProjectGraphView. */
  showTasks: boolean;
  /** D-MEMORY-024: which kind the baseline ribbon lists — owned by the parent so the "Root:" dropdown can live in its header alongside "Show tasks"/"Link depth". */
  rootKind: RootKind;
}

export function DecisionTimeline({ nodes, edges, loading, projectSlug, showTasks, rootKind }: Props) {
  const { t } = useTranslation('decisions');
  const rowRef = useRef<HTMLDivElement>(null);
  // The one open Miller-column chain (D-MEMORY-021: linear, breadcrumb-
  // style, exactly one path open at a time). chain[i] is the decision id
  // whose links are shown as column i (0-based, displayed right of the
  // baseline ribbon or of column i-1).
  const [chain, setChain] = useState<string[]>([]);

  // D-MEMORY-024: switching what the baseline lists invalidates any open
  // drill chain (it was rooted in the previous kind's data) — collapse
  // rather than leave a stale/confusing column open. Adjusted during render
  // (React's documented pattern for "reset state when a prop changes")
  // instead of an effect, which the react-hooks/set-state-in-effect rule
  // flags as cascading-render-prone — this still only re-renders once, the
  // `rootKindAtLastChain !== rootKind` guard makes it self-limiting.
  const [rootKindAtLastChain, setRootKindAtLastChain] = useState(rootKind);
  if (rootKindAtLastChain !== rootKind) {
    setRootKindAtLastChain(rootKind);
    setChain([]);
  }

  // Collapsed by default — the expanded panel was covering the columns
  // underneath it.
  const [legendOpen, setLegendOpen] = useState(false);

  // Fetched once per (projectSlug, showTasks) — not per rendered node. See
  // useTimelineOverlay.ts for why this satisfies the "no N+1" requirement.
  const overlay = useTimelineOverlay(projectSlug, showTasks);

  // D-MEMORY-022 pt.3: nodes point-resolved via `record(id)` because a link
  // pointed past the loaded graph's depth. Merged into nodeById below so
  // every downstream consumer (buildDrillRows, satellites, the chain-
  // validity check) sees them exactly like a normal batch-loaded node —
  // no separate "is this lazy" branch anywhere else in the file.
  const { resolved: lazyResolved, resolveNode } = useLazyNodeResolver();

  const nodeById = useMemo(() => {
    const base = new Map(nodes.map((n) => [n.id, n]));
    if (lazyResolved.size === 0) return base;
    for (const [id, node] of lazyResolved) if (!base.has(id)) base.set(id, node);
    return base;
  }, [nodes, lazyResolved]);

  const { baselineNodes, satellitesByRecord } = useMemo(() => {
    const baselineNodes = nodes
      .filter((n) => n.kind === rootKind)
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

    // Satellites: any other record linked to a baseline-kind record by any
    // relation — rendered as small dots on its card. Reused for every
    // RecordCard instance, wherever it's rendered (baseline, column header,
    // column entry) — D-MEMORY-024 generalized this from decisions-only to
    // whichever kind is currently the root.
    const satellitesByRecord = new Map<string, GraphNode[]>();
    const addSatellite = (rootRecordId: string, satellite: GraphNode) => {
      const list = satellitesByRecord.get(rootRecordId) ?? [];
      if (!list.some((s) => s.id === satellite.id)) list.push(satellite);
      satellitesByRecord.set(rootRecordId, list);
    };
    for (const e of edges) {
      if (e.relation === 'annotates') continue;
      const fromNode = nodeById.get(e.from);
      const toNode = nodeById.get(e.to);
      if (!fromNode || !toNode) continue;
      if (fromNode.kind === rootKind && toNode.kind !== rootKind && toNode.kind !== 'PROJECT') {
        addSatellite(fromNode.id, toNode);
      } else if (toNode.kind === rootKind && fromNode.kind !== rootKind && fromNode.kind !== 'PROJECT') {
        addSatellite(toNode.id, fromNode);
      }
    }
    return { baselineNodes, satellitesByRecord };
  }, [nodes, edges, nodeById, rootKind]);

  // Task-created/completed markers are a DECISION-timeline overlay concept
  // (T-MEMORY-045) — showing "when did this task happen relative to
  // decisions". They don't apply to a Tasks-rooted baseline (every task
  // already gets its own row there), so only merge them in when decisions
  // are actually the root.
  const baselineRows = useMemo(
    () => buildBaselineRows(baselineNodes, rootKind === 'DECISION' ? overlay.taskMarkers : []),
    [baselineNodes, rootKind, overlay.taskMarkers],
  );

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

  // D-MEMORY-022 pt.2: a search selection always opens as the new root,
  // replacing whatever chain is currently open — unlike handleToggle above,
  // this is never a toggle (re-selecting the same result can't collapse
  // anything), so there's no "click something and it vanishes" ambiguity
  // to worry about here.
  const openAsRoot = useCallback((id: string) => {
    setChain([id]);
  }, []);

  // Mirrors Finder auto-scrolling to reveal a freshly opened column instead
  // of leaving it clipped off the right edge. Wrapped in an rAF so it runs
  // after the browser has actually laid out the just-added column (plain
  // effect timing already does this in practice, but a chain several levels
  // deep opened in quick succession is exactly the case the owner reported
  // as unreliable — this makes the read of scrollWidth robust to that).
  useEffect(() => {
    if (validChain.length === 0 || !rowRef.current) return;
    const raf = requestAnimationFrame(() => {
      rowRef.current?.scrollTo({ left: rowRef.current.scrollWidth, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [validChain.length]);

  // Click-and-drag horizontal panning for the column row (I-PMEM owner
  // feedback, live on v0.9.2: "чем больше вложенность, они начинают уезжать
  // за экран, и нельзя их увидеть... если бы это был канвас, то можно было
  // бы драгнуть" — deeper drill chains run off the right edge with no
  // canvas-style drag to reach them). Standard grab-to-scroll: track
  // clientX/scrollLeft on mousedown, adjust scrollLeft on mousemove, and
  // only treat it as an actual drag once the pointer has moved past a small
  // threshold — under that threshold this is a plain click and must fall
  // through untouched (a card's own onClick still has to fire normally).
  // No existing drag-to-pan code anywhere else in this codebase to mirror
  // (the old force-directed graph used @xyflow/react's built-in canvas pan,
  // retired in 8734746 well before this widget existed) — this is a plain
  // DOM implementation, not a canvas.
  const dragRef = useRef<{ startX: number; startScrollLeft: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const DRAG_THRESHOLD_PX = 5;

  const handleRowMouseDown = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't hijack drags starting on the search input (or any future form
    // control) — text selection there should behave normally.
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, .ant-select, .ant-select-selector')) return;
    const el = rowRef.current;
    if (!el) return;
    dragRef.current = { startX: e.clientX, startScrollLeft: el.scrollLeft, moved: false };
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const drag = dragRef.current;
      const el = rowRef.current;
      if (!drag || !el) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        drag.moved = true;
        setIsPanning(true);
        document.body.style.userSelect = 'none';
      }
      if (drag.moved) {
        e.preventDefault();
        el.scrollLeft = drag.startScrollLeft - dx;
      }
    }
    function handleMouseUp() {
      const drag = dragRef.current;
      if (drag?.moved) {
        // A real drag happened — the click that the browser is about to
        // fire on mouseup would otherwise land on whatever card is now
        // under the cursor and toggle/open it, which is not what the user
        // was doing. Swallow exactly that one click; a plain click (never
        // exceeded the threshold) never sets this and passes through as
        // click event, so cards remain clickable.
        suppressClickRef.current = true;
      }
      dragRef.current = null;
      setIsPanning(false);
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleRowClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="secondary">{t('loadingTimeline')}</Typography.Text>
      </div>
    );
  }

  if (baselineNodes.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Typography.Text type="secondary">{t('noKindRecordedYet', { kind: rootKindLabel(t, rootKind).toLowerCase() })}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {rootKindEmptyHint(t, rootKind)}
        </Typography.Text>
      </div>
    );
  }

  const common: ColumnCommonProps = {
    nodeById,
    satellitesByRecord,
    linksByRecord: overlay.linksByRecord,
    remarksByTarget: overlay.remarksByTarget,
    chain: validChain,
    onToggle: handleToggle,
    resolveNode,
  };

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div
        ref={rowRef}
        onMouseDown={handleRowMouseDown}
        onClickCapture={handleRowClickCapture}
        style={{
          height: '100%', display: 'flex', overflowX: 'auto', overflowY: 'hidden', background: '#141414',
          cursor: isPanning ? 'grabbing' : 'grab',
        }}
      >
        <BaselineColumn rows={baselineRows} allNodes={nodes} onSelectRoot={openAsRoot} rootKind={rootKind} {...common} />
        {validChain.map((rootId, idx) => (
          <DrillColumn key={`${rootId}@${idx}`} rootId={rootId} level={idx} {...common} />
        ))}
      </div>

      {/* Legend — collapsed by default (owner: it was covering the columns
          underneath it), just a toggle icon until opened. */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <Tooltip title={legendOpen ? t('hideLegend') : t('showLegend')}>
          <span
            role="button"
            onClick={() => setLegendOpen((o) => !o)}
            style={{
              pointerEvents: 'auto', cursor: 'pointer', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 24, height: 24, borderRadius: 4,
              background: 'rgba(20,20,20,0.92)', border: '1px solid #303030', color: '#8c8c8c',
            }}
          >
            <InfoCircleOutlined style={{ fontSize: 13 }} />
          </span>
        </Tooltip>
        {legendOpen && (
          <div style={{
            background: 'rgba(20,20,20,0.92)',
            border: '1px solid #303030',
            borderRadius: 6,
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxWidth: 240,
            pointerEvents: 'none',
          }}>
            <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2, display: 'block' }}>
              {t('status')}
            </Typography.Text>
            {Object.entries(statusLabels(t)).map(([key, label]) => (
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
              {t('dotsOnACard')}
            </Typography.Text>
            {Object.entries(SATELLITE_KIND_COLOR).map(([kind, dotColor]) => (
              <div key={kind} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor }} />
                <Typography.Text style={{ fontSize: 11 }}>{kind.toLowerCase()}</Typography.Text>
              </div>
            ))}
            <Typography.Text type="secondary" style={{ fontSize: 10, display: 'block' }}>
              <RightOutlined style={{ marginRight: 4 }} />
              {t('legendOpensColumnHint')}
            </Typography.Text>
            {showTasks && (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4, display: 'block' }}>
                  {t('tasks')}
                </Typography.Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PlusCircleOutlined style={{ color: TASK_MARKER_COLOR, fontSize: 12 }} />
                  <Typography.Text style={{ fontSize: 11 }}>{t('createdLabel')}</Typography.Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <CheckCircleOutlined style={{ color: TASK_MARKER_COLOR, fontSize: 12 }} />
                  <Typography.Text style={{ fontSize: 11 }}>{t('doneLabel')}</Typography.Text>
                </div>
              </>
            )}
            <Typography.Text type="secondary" style={{ fontSize: 10, marginTop: 4 }}>
              {t('legendSummary', { count: baselineNodes.length, kind: rootKindLabel(t, rootKind).toLowerCase() })}
            </Typography.Text>
          </div>
        )}
      </div>
    </div>
  );
}
