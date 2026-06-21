import { gql } from '@apollo/client/core';

export const GET_PROJECTS = gql`
  query GetProjects($status: String) {
    projects(status: $status) {
      id
      slug
      title
      description
      status
      rootPath
      updatedAt
    }
  }
`;

export const GET_PROJECT_SUMMARY = gql`
  query GetProjectSummary($project: String!) {
    projectSummary(project: $project) {
      summary
      counts {
        tasks
        openTasks
        items
        decisions
        artifacts
        events
      }
      project {
        id
        slug
        title
        description
        status
        rootPath
        updatedAt
      }
      openTasks {
        id
        title
        status
        priority
        milestone
        updatedAt
      }
      decisions {
        id
        title
        status
        tags
        updatedAt
      }
      knownFaults {
        id
        title
        excerpt
        status
        updatedAt
      }
      artifacts {
        id
        path
        title
        contentType
        sizeBytes
        tags
        status
        updatedAt
      }
      recentEvents {
        id
        type
        title
        relatedId
        createdAt
      }
    }
  }
`;

export const GET_TASKS = gql`
  query GetTasks($project: String!, $status: String, $limit: Int) {
    tasks(project: $project, status: $status, limit: $limit) {
      id
      title
      status
      priority
      milestone
      scope
      acceptance
      notes
      updatedAt
    }
  }
`;

export const GET_DECISIONS = gql`
  query GetDecisions($project: String, $status: String, $limit: Int) {
    decisions(project: $project, status: $status, limit: $limit) {
      id
      title
      status
      context
      decision
      rationale
      tags
      updatedAt
    }
  }
`;

export const GET_ARTIFACTS = gql`
  query GetArtifacts($project: String, $limit: Int) {
    artifacts(project: $project, limit: $limit) {
      id
      path
      title
      scope
      contentType
      sizeBytes
      status
      tags
      updatedAt
    }
  }
`;

export const GET_EVENTS = gql`
  query GetEvents($project: String, $limit: Int) {
    events(project: $project, limit: $limit) {
      id
      type
      title
      relatedId
      createdAt
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
