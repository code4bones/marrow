import { gql } from '@apollo/client/core';

// T-MEMORY-088: server-side search (title/slug/description full-text, plus
// owner email) + pagination for the Projects sidebar -- replaced the old
// non-paginated GET_PROJECTS query entirely (nothing else used it).
export const GET_PROJECTS_PAGE = gql`
  query GetProjectsPage($status: String, $sort: String, $search: String, $limit: Int!, $offset: Int!) {
    projectsPage(status: $status, sort: $sort, search: $search, pagination: { limit: $limit, offset: $offset }) {
      items { id slug title description status rootPath createdBy pinned updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const PIN_PROJECT = gql`
  mutation PinProject($id: ID, $slug: String, $pinned: Boolean!) {
    pinProject(id: $id, slug: $slug, pinned: $pinned) {
      id pinned
    }
  }
`;

// T-MEMORY-086: per-user server-side prefs (deliberately NOT localStorage)
// -- projects-list sort order, and a per-project Timeline root-kind pref
// keyed "timelineRootKind:<projectId>". userPreferences returns every
// stored key flat, as JSON.
export const GET_USER_PREFERENCES = gql`
  query GetUserPreferences {
    userPreferences
  }
`;

export const SET_USER_PREFERENCE = gql`
  mutation SetUserPreference($key: String!, $value: JSON!) {
    setUserPreference(key: $key, value: $value)
  }
`;

export const GET_PROJECT_SUMMARY = gql`
  query GetProjectSummary($project: String!) {
    projectSummary(project: $project) {
      summary
      counts { tasks openTasks items decisions artifacts events links }
      project { id slug title description status rootPath updatedAt }
      openTasks { id title status priority milestone updatedAt }
      decisions { id title status tags updatedAt }
      knownFaults { id title excerpt status updatedAt }
      artifacts { id path title contentType sizeBytes tags status updatedAt }
      recentEvents { id type title relatedId createdAt }
    }
  }
`;

// T-MEMORY-051 follow-up: sortField/sortDirection are optional -- omitting
// them (undefined) falls through to the schema's own defaults (updated_at
// desc), same as every other optional filter here.
export const GET_TASKS_PAGE = gql`
  query GetTasksPage(
    $project: String!
    $status: String
    $milestone: String
    $sortField: TaskSortField
    $sortDirection: SortDirection
    $limit: Int!
    $offset: Int!
  ) {
    tasksPage(
      project: $project
      status: $status
      milestone: $milestone
      sortField: $sortField
      sortDirection: $sortDirection
      pagination: { limit: $limit, offset: $offset }
    ) {
      items { id title status priority milestone scope notes activeClaimCount createdBy assigneeUserId assigneeDiffersFromOwner createdAt updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_DECISIONS_PAGE = gql`
  query GetDecisionsPage($project: String, $status: String, $milestone: String, $limit: Int!, $offset: Int!) {
    decisionsPage(project: $project, status: $status, milestone: $milestone, pagination: { limit: $limit, offset: $offset }) {
      items { id title status context decision rationale tags milestone createdBy assigneeUserId assigneeDiffersFromOwner updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_ARTIFACTS_PAGE = gql`
  query GetArtifactsPage($project: String, $status: String, $limit: Int!, $offset: Int!) {
    artifactsPage(project: $project, status: $status, pagination: { limit: $limit, offset: $offset }) {
      items { id path title scope contentType sizeBytes status tags createdBy updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_EVENTS_PAGE = gql`
  query GetEventsPage($project: String, $limit: Int!, $offset: Int!) {
    eventsPage(project: $project, pagination: { limit: $limit, offset: $offset }) {
      items { id type title relatedId credentialId targetUserIds createdAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_FAULTS_PAGE = gql`
  query GetFaultsPage($project: String, $query: String!, $limit: Int!, $offset: Int!) {
    memorySearchPage(project: $project, type: "failed_attempt", query: $query, pagination: { limit: $limit, offset: $offset }) {
      items { id projectId type title status excerpt tags createdBy createdAt updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

// ── Mutations ─────────────────────────────────────────────────────────────────

export const UPDATE_TASK_STATUS = gql`
  mutation UpdateTaskStatus($id: ID!, $status: String!, $note: String) {
    updateTaskStatus(id: $id, status: $status, note: $note) {
      id status updatedAt
    }
  }
`;

export const CREATE_TASK = gql`
  mutation CreateTask($input: CreateTaskInput!) {
    createTask(input: $input) {
      id title status priority milestone assigneeUserId assigneeDiffersFromOwner updatedAt
    }
  }
`;

export const UPDATE_TASK_ASSIGNEE = gql`
  mutation UpdateTaskAssignee($id: ID!, $assignee: String) {
    updateTaskAssignee(id: $id, assignee: $assignee) {
      id assigneeUserId assigneeDiffersFromOwner updatedAt
    }
  }
`;

export const GET_PROJECT_MEMBERS = gql`
  query GetProjectMembers($project: String) {
    projectMembers(project: $project) {
      userId
      email
    }
  }
`;

export const DELETE_TASK = gql`
  mutation DeleteTask($id: ID!, $reason: String) {
    deleteTask(id: $id, reason: $reason) {
      deletedTask { id title }
      deletedLinks
      event { id type }
    }
  }
`;

export const PUT_TEXT_ARTIFACT = gql`
  mutation PutTextArtifact($input: PutTextArtifactInput!) {
    putTextArtifact(input: $input) {
      id path title status contentType sizeBytes updatedAt
    }
  }
`;

export const UPDATE_ARTIFACT_METADATA = gql`
  mutation UpdateArtifactMetadata($input: UpdateArtifactMetadataInput!) {
    updateArtifactMetadata(input: $input) {
      id path title description tags updatedAt
    }
  }
`;

export const ARCHIVE_ARTIFACT = gql`
  mutation ArchiveArtifact($id: ID, $reason: String) {
    archiveArtifact(id: $id, reason: $reason) {
      action
      artifact { id status archivedAt }
      event { id type }
    }
  }
`;

export const CREATE_PROJECT = gql`
  mutation CreateProject($input: CreateProjectInput!) {
    createProject(input: $input) {
      id slug title description status rootPath updatedAt
    }
  }
`;

export const DELETE_PROJECT = gql`
  mutation DeleteProject($slug: String!, $cascade: Boolean, $reason: String) {
    deleteProject(slug: $slug, cascade: $cascade, reason: $reason) {
      deletedProject { id slug title }
      cascade
      counts { tasks items decisions links events artifacts }
    }
  }
`;

export const UPDATE_PROJECT = gql`
  mutation UpdateProject($slug: String!, $title: String, $description: String) {
    updateProject(slug: $slug, title: $title, description: $description) {
      id slug title description status updatedAt
    }
  }
`;

// Project sharing: reusable, per-project invite link. get-or-create on the
// query (lazily creates the link on first visit to the settings page, same
// as PersonalTokenPanel's lazy generation on first profile visit);
// regenerate is its own mutation, replacing the code in place.
export const PROJECT_INVITE_LINK = gql`
  query ProjectInviteLink($slug: String!) {
    projectInviteLink(slug: $slug) { code url }
  }
`;

export const REGENERATE_PROJECT_INVITE_LINK = gql`
  mutation RegenerateProjectInviteLink($slug: String!) {
    regenerateProjectInviteLink(slug: $slug) { code url }
  }
`;

export const CLAIM_PROJECT_INVITE_LINK = gql`
  mutation ClaimProjectInviteLink($code: String!) {
    claimProjectInviteLink(code: $code) {
      project { id slug title }
      joined
    }
  }
`;

export const GET_RECORD = gql`
  query GetRecord($id: ID!) {
    record(id: $id) {
      id kind projectId
      record {
        __typename
        ... on Task {
          id title status priority milestone scope
          acceptance allowedFiles forbiddenFiles dependsOn notes
          activeClaimCount createdBy assigneeUserId assigneeDiffersFromOwner createdAt updatedAt
        }
        ... on Decision {
          id title status context decision rationale
          consequences tags supersedesId createdBy assigneeUserId assigneeDiffersFromOwner createdAt updatedAt
        }
        ... on Artifact {
          id path title scope description status
          contentType sizeBytes tags downloadPath createdBy createdAt updatedAt
        }
        ... on MemoryRecord {
          id type title status excerpt body tags createdBy createdAt updatedAt
        }
        ... on Event {
          id type title relatedId credentialId createdAt
        }
        ... on Link {
          id fromId toId relation createdBy createdAt
        }
        ... on Project {
          id slug title description status rootPath createdBy updatedAt
        }
      }
    }
  }
`;

export const GET_RECORD_LINKS = gql`
  query GetRecordLinks($id: ID!) {
    links(id: $id, direction: "both", limit: 50) {
      id fromId toId relation createdAt
    }
  }
`;

export const GET_MEMORY = gql`
  query GetMemory($id: ID!) {
    memory(id: $id) {
      id type title body tags status createdAt updatedAt
    }
  }
`;

export const GET_MEMORY_ITEMS_PAGE = gql`
  query GetMemoryItemsPage($project: String, $type: String, $status: String, $includeCommon: Boolean, $limit: Int!, $offset: Int!) {
    memoryItemsPage(project: $project, type: $type, status: $status, includeCommon: $includeCommon, pagination: { limit: $limit, offset: $offset }) {
      items { id type title status excerpt tags createdBy createdAt updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_LINKS_PAGE = gql`
  query GetLinksPage($project: String, $relation: String, $includeCommon: Boolean, $limit: Int!, $offset: Int!) {
    linksPage(project: $project, relation: $relation, includeCommon: $includeCommon, pagination: { limit: $limit, offset: $offset }) {
      items { id fromId toId relation createdBy createdAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

// T-MEMORY-045: batched, project-scoped (not per-decision) fetch of remark
// bodies for the timeline's bottom remark indicators. Reuses memoryItemsPage
// (type: "remark") rather than a new backend field — the only addition over
// GET_MEMORY_ITEMS_PAGE is selecting `body`, kept as a separate query so the
// Memory list page's payload (which uses GET_MEMORY_ITEMS_PAGE across all
// item types, often 100 rows) doesn't grow by picking up bodies it never
// asked for.
export const GET_PROJECT_REMARKS_PAGE = gql`
  query GetProjectRemarksPage($project: String, $limit: Int!, $offset: Int!) {
    memoryItemsPage(project: $project, type: "remark", pagination: { limit: $limit, offset: $offset }) {
      items { id title body tags createdAt updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_ARTIFACT_TEXT = gql`
  query GetArtifactText($id: ID!) {
    artifactText(id: $id, maxLines: 300) {
      text
      textInfo { truncated isMarkdown }
      outline { level title line }
    }
  }
`;

export const GET_GATEWAY_STATUS = gql`
  query GetGatewayStatus {
    gatewayStatus
    gatewayVersion
    gatewayDiagnostics
  }
`;

/** Lighter than GET_GATEWAY_STATUS — just the version, for places like the nav header that render on every page. */
export const GET_GATEWAY_VERSION = gql`
  query GetGatewayVersion {
    gatewayVersion
  }
`;

/** Self-serve OAuth connector setup info for the profile Connect section (mcpUrl, oauthClientId, oauthClientSecret). */
export const GET_GATEWAY_CONNECTOR_INFO = gql`
  query GetGatewayConnectorInfo {
    gatewayConnectorInfo
  }
`;

export const GET_ARTIFACTS = gql`
  query GetArtifacts($project: String, $limit: Int) {
    artifacts(project: $project, limit: $limit) {
      id path title scope contentType sizeBytes status tags createdBy updatedAt
    }
  }
`;

export const GET_DECISIONS = gql`
  query GetDecisions($project: String, $status: String, $limit: Int) {
    decisions(project: $project, status: $status, limit: $limit) {
      id title status context decision rationale tags createdBy updatedAt
    }
  }
`;

export const GET_PROJECT = gql`
  query GetProject($slug: String!) {
    project(slug: $slug) { id slug title status }
  }
`;

export const GET_PROJECT_SETTINGS = gql`
  query GetProjectSettings($slug: String!) {
    project(slug: $slug) { id slug title description status ownerUserId updatedAt }
  }
`;

export const GET_PROJECT_GRAPH = gql`
  query GetProjectGraph($projectId: ID!, $depth: Int, $maxPerType: Int) {
    projectGraph(projectId: $projectId, depth: $depth, maxPerType: $maxPerType) {
      nodes { id kind title status createdBy assigneeUserId assigneeDiffersFromOwner createdAt milestone }
      edges { id from to relation }
    }
  }
`;

export const GET_TASK = gql`
  query GetTask($id: ID!) {
    task(id: $id) {
      id title status priority milestone scope acceptance notes activeClaimCount dependsOn createdAt updatedAt
    }
  }
`;

export const GET_TASK_CLAIMS = gql`
  query GetTaskClaims($taskId: ID!) {
    taskClaims(taskId: $taskId, includeInactive: true) {
      id role scope status clientLabel leaseExpiresAt heartbeatAt note createdAt updatedAt
    }
  }
`;

export const GET_GATEWAY_CLIENTS_PAGE = gql`
  query GetGatewayClientsPage($limit: Int!, $offset: Int!) {
    gatewayClientsPage(pagination: { limit: $limit, offset: $offset }) {
      items { id label lastSeenAt createdAt updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

// ── New mutations ─────────────────────────────────────────────────────────────

export const CREATE_MEMORY = gql`
  mutation CreateMemory($input: CreateMemoryInput!) {
    createMemory(input: $input) {
      id type title status tags createdAt updatedAt
    }
  }
`;

export const UPDATE_MEMORY = gql`
  mutation UpdateMemory($input: UpdateMemoryInput!) {
    updateMemory(input: $input) {
      id type title status tags updatedAt
    }
  }
`;

export const ARCHIVE_MEMORY = gql`
  mutation ArchiveMemory($id: ID!, $reason: String) {
    archiveMemory(id: $id, reason: $reason) {
      action
      memory { id status }
      event { id type }
    }
  }
`;

export const DELETE_MEMORY = gql`
  mutation DeleteMemory($id: ID!, $reason: String) {
    deleteMemory(id: $id, reason: $reason) {
      deletedMemory { id title }
      deletedLinks
      event { id type }
    }
  }
`;

export const RECORD_DECISION = gql`
  mutation RecordDecision($input: RecordDecisionInput!) {
    recordDecision(input: $input) {
      id title status tags milestone assigneeUserId assigneeDiffersFromOwner createdAt updatedAt
    }
  }
`;

export const UPDATE_DECISION_ASSIGNEE = gql`
  mutation UpdateDecisionAssignee($id: ID!, $assignee: String) {
    updateDecisionAssignee(id: $id, assignee: $assignee) {
      id assigneeUserId assigneeDiffersFromOwner updatedAt
    }
  }
`;

export const UPDATE_DECISION_STATUS = gql`
  mutation UpdateDecisionStatus($id: ID!, $status: String!, $reason: String) {
    updateDecisionStatus(id: $id, status: $status, reason: $reason) {
      id status updatedAt
    }
  }
`;

export const SUPERSEDE_DECISION = gql`
  mutation SupersedeDecision($input: RecordDecisionInput!) {
    supersedeDecision(input: $input) {
      decision { id title status supersedesId }
      superseded { id status }
      link { fromId toId relation }
    }
  }
`;

export const ARCHIVE_DECISION = gql`
  mutation ArchiveDecision($id: ID!, $reason: String) {
    archiveDecision(id: $id, reason: $reason) {
      action
      decision { id status }
      event { id type }
    }
  }
`;

export const DELETE_DECISION = gql`
  mutation DeleteDecision($id: ID!, $reason: String) {
    deleteDecision(id: $id, reason: $reason) {
      deletedDecision { id title }
      deletedLinks
      event { id type }
    }
  }
`;

export const DELETE_ARTIFACT = gql`
  mutation DeleteArtifact($id: ID, $reason: String) {
    deleteArtifact(id: $id, reason: $reason) {
      deletedArtifact { id path }
      deletedLinks
      event { id type }
    }
  }
`;

export const CREATE_LINK = gql`
  mutation CreateLink($input: CreateLinkInput!) {
    createLink(input: $input) {
      id fromId toId relation createdAt
    }
  }
`;

export const DELETE_LINK = gql`
  mutation DeleteLink($id: ID!, $reason: String) {
    deleteLink(id: $id, reason: $reason) {
      deletedLink { id fromId toId relation }
      event { id type }
    }
  }
`;

export const RECORD_EVENT = gql`
  mutation RecordEvent($input: RecordEventInput!) {
    recordEvent(input: $input) {
      id type title createdAt
    }
  }
`;

export const DELETE_EVENT = gql`
  mutation DeleteEvent($id: ID!, $reason: String) {
    deleteEvent(id: $id, reason: $reason) {
      deletedEvent { id type }
    }
  }
`;

export const CLAIM_TASK = gql`
  mutation ClaimTask($input: TaskClaimInput!) {
    claimTask(input: $input) {
      claim { id status role leaseExpiresAt }
      task { id status activeClaimCount }
    }
  }
`;

export const COMPLETE_TASK = gql`
  mutation CompleteTask($id: ID!, $claimId: ID, $acceptanceEvidence: String, $force: Boolean) {
    completeTask(id: $id, claimId: $claimId, acceptanceEvidence: $acceptanceEvidence, force: $force) {
      task { id status activeClaimCount }
      completedClaim { id status }
      event { id type }
    }
  }
`;

export const ADD_TASK_NOTE = gql`
  mutation AddTaskNote($input: TaskNoteInput!) {
    addTaskNote(input: $input) {
      item { id type title }
      link { id fromId toId relation }
      event { id type }
    }
  }
`;

// ── Git credentials (T-MEMORY-044) ──────────────────────────────────────────────

export const GET_GIT_CREDENTIALS = gql`
  query GetGitCredentials {
    gitCredentials {
      id host label createdAt lastUsedAt
    }
  }
`;

export const CREATE_GIT_CREDENTIAL = gql`
  mutation CreateGitCredential($host: String!, $label: String!, $token: String!) {
    createGitCredential(host: $host, label: $label, token: $token) {
      id host label createdAt lastUsedAt
    }
  }
`;

export const DELETE_GIT_CREDENTIAL = gql`
  mutation DeleteGitCredential($id: ID!) {
    deleteGitCredential(id: $id)
  }
`;

export const GET_GIT_PIPELINE_STATUS = gql`
  query GetGitPipelineStatus($host: String!, $project: String!, $ref: String) {
    gitPipelineStatus(host: $host, project: $project, ref: $ref)
  }
`;

// T-MEMORY-084: global admin on/off switch for the credits economy.
export const GET_CREDIT_SETTINGS = gql`
  query GetCreditSettings {
    creditSettings {
      enabled
    }
  }
`;

export const UPDATE_CREDIT_SETTINGS = gql`
  mutation UpdateCreditSettings($enabled: Boolean!) {
    updateCreditSettings(enabled: $enabled) {
      enabled
    }
  }
`;

// T-MEMORY-085: batch-resolve raw createdBy/credentialId clientId values
// into display labels -- see useActorLabels for how this is called.
export const GET_ACTOR_LABELS = gql`
  query GetActorLabels($ids: [String!]!) {
    actorLabels(ids: $ids) {
      id
      label
    }
  }
`;

// ── Subscriptions ─────────────────────────────────────────────────────────────

export const ON_GATEWAY_EVENT = gql`
  subscription OnGatewayEvent {
    gatewayEvents {
      event
      payload
    }
  }
`;
