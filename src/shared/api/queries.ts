import { gql } from '@apollo/client/core';

export const GET_PROJECTS = gql`
  query GetProjects($status: String) {
    projects(status: $status) {
      id slug title description status rootPath updatedAt
    }
  }
`;

export const GET_PROJECT_SUMMARY = gql`
  query GetProjectSummary($project: String!) {
    projectSummary(project: $project) {
      summary
      counts { tasks openTasks items decisions artifacts events }
      project { id slug title description status rootPath updatedAt }
      openTasks { id title status priority milestone updatedAt }
      decisions { id title status tags updatedAt }
      knownFaults { id title excerpt status updatedAt }
      artifacts { id path title contentType sizeBytes tags status updatedAt }
      recentEvents { id type title relatedId createdAt }
    }
  }
`;

export const GET_TASKS_PAGE = gql`
  query GetTasksPage($project: String!, $status: String, $milestone: String, $limit: Int!, $offset: Int!) {
    tasksPage(project: $project, status: $status, milestone: $milestone, pagination: { limit: $limit, offset: $offset }) {
      items { id title status priority milestone scope notes activeClaimCount updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_DECISIONS_PAGE = gql`
  query GetDecisionsPage($project: String, $status: String, $limit: Int!, $offset: Int!) {
    decisionsPage(project: $project, status: $status, pagination: { limit: $limit, offset: $offset }) {
      items { id title status context decision rationale tags updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_ARTIFACTS_PAGE = gql`
  query GetArtifactsPage($project: String, $status: String, $limit: Int!, $offset: Int!) {
    artifactsPage(project: $project, status: $status, pagination: { limit: $limit, offset: $offset }) {
      items { id path title scope contentType sizeBytes status tags updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_EVENTS_PAGE = gql`
  query GetEventsPage($project: String, $limit: Int!, $offset: Int!) {
    eventsPage(project: $project, pagination: { limit: $limit, offset: $offset }) {
      items { id type title relatedId createdAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_FAULTS_PAGE = gql`
  query GetFaultsPage($project: String, $query: String!, $limit: Int!, $offset: Int!) {
    memorySearchPage(project: $project, type: "failed_attempt", query: $query, pagination: { limit: $limit, offset: $offset }) {
      items { id projectId type title status excerpt tags createdAt updatedAt }
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
      id title status priority milestone updatedAt
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

export const GET_RECORD = gql`
  query GetRecord($id: ID!) {
    record(id: $id) {
      id kind projectId
      record {
        __typename
        ... on Task {
          id title status priority milestone scope
          acceptance allowedFiles forbiddenFiles dependsOn notes
          activeClaimCount createdAt updatedAt
        }
        ... on Decision {
          id title status context decision rationale
          consequences tags supersedesId createdAt updatedAt
        }
        ... on Artifact {
          id path title scope description status
          contentType sizeBytes tags downloadPath createdAt updatedAt
        }
        ... on MemoryRecord {
          id type title status excerpt body tags createdAt updatedAt
        }
        ... on Event {
          id type title relatedId createdAt
        }
        ... on Link {
          id fromId toId relation createdAt
        }
        ... on Project {
          id slug title description status rootPath updatedAt
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
      items { id type title status excerpt tags createdAt updatedAt }
      pageInfo { totalCount limit offset hasNextPage hasPreviousPage }
    }
  }
`;

export const GET_LINKS_PAGE = gql`
  query GetLinksPage($project: String, $relation: String, $includeCommon: Boolean, $limit: Int!, $offset: Int!) {
    linksPage(project: $project, relation: $relation, includeCommon: $includeCommon, pagination: { limit: $limit, offset: $offset }) {
      items { id fromId toId relation createdAt }
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

export const GET_ARTIFACTS = gql`
  query GetArtifacts($project: String, $limit: Int) {
    artifacts(project: $project, limit: $limit) {
      id path title scope contentType sizeBytes status tags updatedAt
    }
  }
`;

export const GET_DECISIONS = gql`
  query GetDecisions($project: String, $status: String, $limit: Int) {
    decisions(project: $project, status: $status, limit: $limit) {
      id title status context decision rationale tags updatedAt
    }
  }
`;

export const GET_PROJECT = gql`
  query GetProject($slug: String!) {
    project(slug: $slug) { id slug title status }
  }
`;

export const GET_PROJECT_GRAPH = gql`
  query GetProjectGraph($projectId: ID!, $depth: Int, $maxPerType: Int) {
    projectGraph(projectId: $projectId, depth: $depth, maxPerType: $maxPerType) {
      nodes { id kind title status createdAt }
      edges { from to relation }
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
      id title status tags createdAt updatedAt
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
