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
      items { id title status priority milestone scope notes updatedAt }
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

export const GET_RECORD = gql`
  query GetRecord($id: ID!) {
    record(id: $id) {
      id kind projectId
      record {
        __typename
        ... on Task {
          id title status priority milestone scope
          acceptance allowedFiles forbiddenFiles dependsOn notes
          createdAt updatedAt
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
