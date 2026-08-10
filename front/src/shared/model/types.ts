export interface PageInfo {
  totalCount: number;
  limit: number;
  offset: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  pageInfo: PageInfo;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  rootPath: string | null;
  ownerUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProjectCounts {
  tasks: number;
  openTasks: number;
  items: number;
  decisions: number;
  artifacts: number;
  events: number;
  links: number;
}

export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  status: string;
  milestone: string | null;
  priority: number | null;
  scope: string | null;
  acceptance: string | null;
  allowedFiles: string[];
  forbiddenFiles: string[];
  dependsOn: string[];
  notes: string | null;
  activeClaimCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TaskClaim {
  id: string;
  taskId: string;
  projectId: string;
  clientId: string;
  clientLabel: string | null;
  clientKind: string | null;
  role: string;
  scope: string | null;
  status: string;
  leaseExpiresAt: string;
  heartbeatAt: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  kind: string;
  title: string;
  status: string | null;
  createdAt: string | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: string;
}

export interface ProjectGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GatewayClient {
  id: string;
  label: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * A saved git host credential (e.g. a GitLab personal access token). The
 * token value itself is never part of this type — the API never returns it
 * after creation, same write-once principle as recovery codes / the TOTP
 * secret (see TotpEnrollWizard).
 */
export interface GitCredential {
  id: string;
  host: string;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export interface Decision {
  id: string;
  projectId: string | null;
  title: string;
  status: string;
  context: string | null;
  decision: string | null;
  rationale: string | null;
  consequences: string | null;
  tags: string[];
  supersedesId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Artifact {
  id: string;
  projectId: string | null;
  scope: string;
  path: string;
  title: string | null;
  description: string | null;
  status: string;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  tags: string[];
  downloadPath: string | null;
  archivedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Event {
  id: string;
  projectId: string | null;
  type: string;
  title: string;
  body: string | null;
  relatedId: string | null;
  createdAt: string | null;
}

export interface MemoryRecord {
  id: string;
  projectId: string | null;
  scope: string;
  type: string;
  title: string;
  body: string | null;
  excerpt: string | null;
  status: string;
  tags: string[];
  rank: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Link {
  id: string;
  projectId: string | null;
  fromId: string;
  toId: string;
  relation: string;
  createdAt: string | null;
}

export type RecordPayload =
  | (Task     & { __typename: 'Task' })
  | (Decision & { __typename: 'Decision' })
  | (Artifact & { __typename: 'Artifact' })
  | (MemoryRecord & { __typename: 'MemoryRecord' })
  | (Event    & { __typename: 'Event' })
  | (Link     & { __typename: 'Link' })
  | (Project  & { __typename: 'Project' });

export interface RecordWrapper {
  id: string;
  kind: string;
  projectId: string | null;
  record: RecordPayload | null;
}

export interface ProjectSummary {
  summary: string;
  project: Project;
  counts: ProjectCounts;
  openTasks: Task[];
  decisions: Decision[];
  knownFaults: MemoryRecord[];
  artifacts: Artifact[];
  memory: MemoryRecord[];
  recentEvents: Event[];
}
