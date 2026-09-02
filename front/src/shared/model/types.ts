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
  createdBy: string | null;
  pinned: boolean;
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
  faults: number;
  skills: number;
}

export type GlobalSearchKind = 'task' | 'decision' | 'memory' | 'fault' | 'request' | 'artifact' | 'skill';

export interface GlobalSearchResult {
  id: string;
  kind: GlobalSearchKind;
  title: string;
  excerpt: string | null;
  status: string;
  updatedAt: string | null;
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
  createdBy: string | null;
  assigneeUserId: string | null;
  assigneeDiffersFromOwner: boolean;
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
  createdBy: string | null;
  milestone: string | null;
  assigneeUserId: string | null;
  assigneeDiffersFromOwner: boolean;
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
  milestone: string | null;
  createdBy: string | null;
  assigneeUserId: string | null;
  assigneeDiffersFromOwner: boolean;
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
  createdBy: string | null;
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
  credentialId: string | null;
  agentName: string | null;
  targetUserIds: string[];
  createdAt: string | null;
}

// T-MEMORY-110: pm/developer/tester, or null on the rare transient row that
// hasn't been approved into a role yet (shouldn't normally be visible --
// listProjectMembers only returns status='active' rows).
export type ProjectMemberRole = 'pm' | 'developer' | 'tester';

export interface ProjectMember {
  userId: string;
  email: string;
  role: ProjectMemberRole | null;
}

export interface PendingProjectMember {
  userId: string;
  email: string;
  requestedAt: string | null;
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
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  fromAgent: string | null;
  toAgent: string | null;
}

export interface Link {
  id: string;
  projectId: string | null;
  fromId: string;
  toId: string;
  relation: string;
  createdBy: string | null;
  createdAt: string | null;
}

export interface Skill {
  id: string;
  projectId: string | null;
  scope: string;
  name: string;
  description: string | null;
  body: string;
  status: string;
  tags: string[];
  activationCount: number;
  lastActivatedAt: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
  archiveReason: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// T-context (D-MEMORY-041): the lighter shape listSkills(compact:true)
// returns -- name+description+tags only, mirrors GraphQL's SkillSummary
// type used for ProjectSummary.availableSkills.
export interface SkillSummary {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
}

export type RecordPayload =
  | (Task     & { __typename: 'Task' })
  | (Decision & { __typename: 'Decision' })
  | (Artifact & { __typename: 'Artifact' })
  | (MemoryRecord & { __typename: 'MemoryRecord' })
  | (Event    & { __typename: 'Event' })
  | (Link     & { __typename: 'Link' })
  | (Skill    & { __typename: 'Skill' })
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
  availableSkills: SkillSummary[];
  artifacts: Artifact[];
  memory: MemoryRecord[];
  recentEvents: Event[];
}
