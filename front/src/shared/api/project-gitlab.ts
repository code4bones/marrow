import { gql } from '@apollo/client';

export interface ProjectRepository {
  id: string;
  projectId: string;
  host: string;
  gitlabProjectId: string;
  path: string;
  name: string;
  webUrl: string;
}

export interface GitlabUser {
  gitlabUserId: string;
  username: string;
  name: string;
}

export interface ProjectGitlabMapping extends GitlabUser {
  userId: string;
  host: string;
}

export const GET_PROJECT_REPOSITORIES = gql`
  query ProjectRepositories($project: String!) {
    projectRepositories(project: $project) { id projectId host gitlabProjectId path name webUrl }
  }
`;
export const ADD_PROJECT_REPOSITORY = gql`
  mutation AddProjectRepository($project: String!, $url: String!) {
    addProjectRepository(project: $project, url: $url) { id host path name webUrl }
  }
`;
export const REMOVE_PROJECT_REPOSITORY = gql`
  mutation RemoveProjectRepository($project: String!, $id: ID!) {
    removeProjectRepository(project: $project, id: $id)
  }
`;
export const GET_PROJECT_GITLAB_MAPPINGS = gql`
  query ProjectGitlabMappings($project: String!) {
    projectGitlabMappings(project: $project) { userId host gitlabUserId username name }
  }
`;
export const SEARCH_PROJECT_GITLAB_USERS = gql`
  query ProjectGitlabUsers($project: String!, $host: String!, $query: String!) {
    projectGitlabUsers(project: $project, host: $host, query: $query) { gitlabUserId username name }
  }
`;
export const SET_PROJECT_MEMBER_GITLAB = gql`
  mutation SetProjectMemberGitlab($project: String!, $userId: ID!, $host: String!, $gitlabUserId: String!) {
    setProjectMemberGitlab(project: $project, userId: $userId, host: $host, gitlabUserId: $gitlabUserId) {
      userId host gitlabUserId username name
    }
  }
`;
export const REMOVE_PROJECT_MEMBER_GITLAB = gql`
  mutation RemoveProjectMemberGitlab($project: String!, $userId: ID!, $host: String!) {
    removeProjectMemberGitlab(project: $project, userId: $userId, host: $host)
  }
`;
