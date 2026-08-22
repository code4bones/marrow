import { Empty, Spin, Tag, Tooltip, Tree, Typography } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ENTITY_COLOR } from '../../shared/lib/entityId';
import { formatGraphTimestamp } from '../../shared/lib/graphTimestamp';
import { shortAuthor } from '../../shared/lib/shortAuthor';
import { useActorLabels } from '../../shared/lib/useActorLabels';
import { STATUS_COLORS } from '../../shared/ui/statusColors';
import { useWorkspaceStore } from '../../shared/model/workspace.store';
import type { GraphEdge, GraphNode } from '../../shared/model/types';

type LabelFor = (id: string | null | undefined) => string | null;

interface TreeProjectRoot {
  id: string;
  title: string;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loading: boolean;
  // Plain id/title, not a nested object -- the caller would otherwise have
  // to memoize an object literal itself just to keep buildForest's useMemo
  // below from recomputing on every unrelated parent re-render.
  projectId: string;
  projectTitle: string;
}

interface BuiltNode {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  createdAt: string | null;
  createdBy: string | null;
  assigneeUserId: string | null;
  assigneeDiffersFromOwner: boolean;
  children: BuiltNode[];
}

// T-MEMORY-056: projectGraph returns a flat nodes/edges pair, not a tree --
// links can create cycles and nodes with several incoming edges, so this is
// a BFS spanning-forest construction, not a lookup of an existing
// hierarchy. Disconnected components (no path back to the project through
// any link) still get a home directly under the root rather than being
// hidden -- a memory-inspection tool should never quietly drop records.
// Deterministic tie-break (createdAt then id) so the shape doesn't shuffle
// between renders of the same data.
function compareByCreatedThenId(a: GraphNode, b: GraphNode): number {
  return (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id);
}

function buildForest(nodes: GraphNode[], edges: GraphEdge[], project: TreeProjectRoot): BuiltNode {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    if (e.from === e.to || !byId.has(e.from) || !byId.has(e.to)) continue;
    adjacency.get(e.from)!.push(e.to);
    adjacency.get(e.to)!.push(e.from);
  }
  const neighborsOf = (id: string): GraphNode[] =>
    (adjacency.get(id) ?? []).map((nid) => byId.get(nid)!).sort(compareByCreatedThenId);

  const root: BuiltNode = {
    id: project.id, kind: 'PROJECT', title: project.title, status: null, createdAt: null, createdBy: null,
    assigneeUserId: null, assigneeDiffersFromOwner: false, children: [],
  };
  const builtById = new Map<string, BuiltNode>();
  const visited = new Set<string>();

  const order = [...nodes].sort(compareByCreatedThenId);
  for (const seed of order) {
    if (visited.has(seed.id)) continue;
    visited.add(seed.id);
    const seedBuilt: BuiltNode = {
      id: seed.id, kind: seed.kind, title: seed.title, status: seed.status, createdAt: seed.createdAt, createdBy: seed.createdBy,
      assigneeUserId: seed.assigneeUserId, assigneeDiffersFromOwner: seed.assigneeDiffersFromOwner, children: [],
    };
    builtById.set(seed.id, seedBuilt);
    root.children.push(seedBuilt);

    const queue: string[] = [seed.id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentBuilt = builtById.get(currentId)!;
      for (const neighbor of neighborsOf(currentId)) {
        if (visited.has(neighbor.id)) continue;
        visited.add(neighbor.id);
        const neighborBuilt: BuiltNode = {
          id: neighbor.id, kind: neighbor.kind, title: neighbor.title, status: neighbor.status, createdAt: neighbor.createdAt, createdBy: neighbor.createdBy,
          assigneeUserId: neighbor.assigneeUserId, assigneeDiffersFromOwner: neighbor.assigneeDiffersFromOwner, children: []
        };
        builtById.set(neighbor.id, neighborBuilt);
        currentBuilt.children.push(neighborBuilt);
        queue.push(neighbor.id);
      }
    }
  }

  return root;
}

function kindDotColor(kind: string): string {
  return ENTITY_COLOR[kind.toLowerCase() as keyof typeof ENTITY_COLOR] ?? ENTITY_COLOR.unknown;
}

function TreeRowTitle({ node, labelFor }: { node: BuiltNode; labelFor: LabelFor }) {
  const stamp = formatGraphTimestamp(node.createdAt);
  const author = labelFor(node.createdBy);
  const assignee = node.assigneeDiffersFromOwner ? labelFor(`user:${node.assigneeUserId}`) : null;
  return (
    <Tooltip title={`${node.kind} · ${node.id}${author ? ` · ${author}` : ''}${assignee ? ` · → ${assignee}` : ''}`} placement="right" mouseEnterDelay={0.4}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' }}>
        <span
          style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: kindDotColor(node.kind), display: 'inline-block',
          }}
        />
        <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: false }}>
          {node.title}
        </Typography.Text>
        {node.status && (
          <Tag color={STATUS_COLORS[node.status] ?? 'default'} style={{ fontSize: 10, lineHeight: '14px', margin: 0, flexShrink: 0 }}>
            {node.status}
          </Tag>
        )}
        {author && (
          <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', flexShrink: 0, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {shortAuthor(author)}
          </Typography.Text>
        )}
        {assignee && (
          <Tag color="gold" style={{ fontSize: 10, lineHeight: '14px', margin: 0, flexShrink: 0 }}>
            {'→'} {shortAuthor(assignee)}
          </Tag>
        )}
        {stamp && (
          <Typography.Text style={{ fontSize: 10, color: '#8c8c8c', fontFamily: 'monospace', flexShrink: 0 }}>
            {stamp}
          </Typography.Text>
        )}
      </span>
    </Tooltip>
  );
}

function toDataNode(n: BuiltNode, labelFor: LabelFor): DataNode {
  return {
    key: n.id,
    title: <TreeRowTitle node={n} labelFor={labelFor} />,
    isLeaf: n.children.length === 0,
    children: n.children.length > 0 ? n.children.map((c) => toDataNode(c, labelFor)) : undefined,
  };
}

// Companion view to DecisionTimeline (see ProjectGraphView's toggle) --
// same projectGraph nodes/edges, no extra backend request, just a
// different shape drawn from them: a hierarchy rooted at the project
// itself instead of a chronological ribbon. Single click expands/collapses
// (DirectoryTree's expandAction="click", the same interaction a file
// explorer uses for folders); double click opens the existing detail
// drawer for that record, project root included. A double click also
// fires two ordinary clicks first (browser event order), which toggles
// expand twice and cancels out -- no net expand/collapse change, drawer
// still opens cleanly.
export function GraphTree({ nodes, edges, loading, projectId, projectTitle }: Props) {
  const { t } = useTranslation('projects');
  const setSelectedRecord = useWorkspaceStore((s) => s.setSelectedRecord);

  const project = useMemo<TreeProjectRoot>(() => ({ id: projectId, title: projectTitle }), [projectId, projectTitle]);
  const root = useMemo(() => buildForest(nodes, edges, project), [nodes, edges, project]);
  const { labelFor } = useActorLabels(nodes.flatMap((n) => [n.createdBy, n.assigneeUserId ? `user:${n.assigneeUserId}` : null]));
  const treeData = useMemo(() => [toDataNode(root, labelFor)], [root, labelFor]);
  const kindById = useMemo(() => {
    const map = new Map<string, string>();
    const visit = (n: BuiltNode) => {
      map.set(n.id, n.kind);
      n.children.forEach(visit);
    };
    visit(root);
    return map;
  }, [root]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin />
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description={t('treeEmptyHint')} />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '8px 12px' }}>
      <Tree.DirectoryTree
        treeData={treeData}
        defaultExpandedKeys={[project.id]}
        expandAction="click"
        selectable={false}
        blockNode
        showIcon={false}
        onDoubleClick={(_event, node) => {
          const id = String(node.key);
          const kind = kindById.get(id);
          if (kind) setSelectedRecord(id, kind.toLowerCase());
        }}
      />
    </div>
  );
}
