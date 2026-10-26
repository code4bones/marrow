import { gql } from '@apollo/client';

export interface ProjectTelegramBot {
  id: string;
  username: string;
  tags: string[];
  enabled: boolean;
  pollingStatus: 'inactive' | 'starting' | 'active' | 'error';
  lastError: string | null;
  lastPolledAt: string | null;
  lastReceivedAt: string | null;
  lastChatTitle: string | null;
  failedCount: number;
  pendingCount: number;
  chats: { chatId: string; title: string }[];
}
export interface TelegramChatLinkCode { command: string; expiresAt: string }

export const GET_PROJECT_TELEGRAM_BOTS = gql`
  query ProjectTelegramBots($project: String!) {
    projectTelegramBots(project: $project) {
      deepseekReady
      bots { id username tags enabled pollingStatus lastError lastPolledAt lastReceivedAt lastChatTitle failedCount pendingCount chats { chatId title } }
    }
  }
`;
export const ADD_PROJECT_TELEGRAM_BOT = gql`
  mutation AddProjectTelegramBot($project: String!, $token: String!, $tags: [String!]!) {
    addProjectTelegramBot(project: $project, token: $token, tags: $tags) { id username tags enabled pollingStatus lastError }
  }
`;
export const SET_PROJECT_TELEGRAM_BOT_TAGS = gql`
  mutation SetProjectTelegramBotTags($project: String!, $id: ID!, $tags: [String!]!) {
    setProjectTelegramBotTags(project: $project, id: $id, tags: $tags) { id tags }
  }
`;
export const CONNECT_PROJECT_TELEGRAM_BOT = gql`
  mutation ConnectProjectTelegramBot($project: String!, $id: ID!) {
    connectProjectTelegramBot(project: $project, id: $id) { id enabled pollingStatus lastError lastPolledAt }
  }
`;
export const DISCONNECT_PROJECT_TELEGRAM_BOT = gql`
  mutation DisconnectProjectTelegramBot($project: String!, $id: ID!) {
    disconnectProjectTelegramBot(project: $project, id: $id) { id enabled pollingStatus lastError lastPolledAt }
  }
`;
export const REMOVE_PROJECT_TELEGRAM_BOT = gql`
  mutation RemoveProjectTelegramBot($project: String!, $id: ID!) { removeProjectTelegramBot(project: $project, id: $id) }
`;
export const PROJECT_TELEGRAM_LINK_CODE = gql`
  mutation ProjectTelegramBotLinkCode($project: String!, $id: ID!) {
    projectTelegramBotLinkCode(project: $project, id: $id) { command expiresAt }
  }
`;
export const UNLINK_PROJECT_TELEGRAM_CHAT = gql`
  mutation UnlinkProjectTelegramChat($project: String!, $id: ID!, $chatId: String!) {
    unlinkProjectTelegramChat(project: $project, id: $id, chatId: $chatId)
  }
`;
export const RETRY_PROJECT_TELEGRAM_BOT = gql`
  mutation RetryProjectTelegramBot($project: String!, $id: ID!) { retryProjectTelegramBot(project: $project, id: $id) }
`;
