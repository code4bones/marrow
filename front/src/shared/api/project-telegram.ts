import { gql } from '@apollo/client';

export interface ProjectTelegramBot {
  id: string;
  username: string;
  tags: string[];
  enabled: boolean;
  pollingStatus: 'inactive' | 'starting' | 'active' | 'error';
  lastError: string | null;
  lastPolledAt: string | null;
  receivedCount: number;
  matchedCount: number;
  processedCount: number;
  lastMatchedAt: string | null;
  lastProcessedAt: string | null;
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
      bots { id username tags enabled pollingStatus lastError lastPolledAt lastReceivedAt lastChatTitle receivedCount matchedCount processedCount lastMatchedAt lastProcessedAt failedCount pendingCount chats { chatId title } }
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

export interface TelegramBotMessage {
  id: string;
  chatTitle: string | null;
  chatId: string | null;
  chatType: string;
  telegramMessageId: string | null;
  messageKind: string;
  messageUrl: string | null;
  receivedAt: string;
  classifiedAt: string | null;
  processedAt: string | null;
  status: string;
  reason: string | null;
  lastError: string | null;
  excerpt: string | null;
  text?: string | null;
  matchedTags?: string[];
  mentions?: string[];
  attachments?: { id: string; name: string; kind: string; contentType: string; sizeBytes: number | null; status: string; artifactId: string | null; lastError: string | null }[];
  canCreateTask?: boolean;
  manual?: boolean;
  assignableMembers?: { id: string; email: string }[];
  classification?: { tasks: { telegramUserId: string; title: string; description: string; evidence: string; confidence: number }[] } | null;
  tasks?: { id: string; title: string; status: string }[];
}

export const GET_PROJECT_TELEGRAM_MESSAGES = gql`
  query ProjectTelegramBotMessages($project: String!, $id: ID!, $limit: Int, $offset: Int) {
    projectTelegramBotMessages(project: $project, id: $id, limit: $limit, offset: $offset) {
      total
      messages { id chatTitle chatId chatType telegramMessageId messageKind messageUrl receivedAt classifiedAt processedAt status reason lastError excerpt }
    }
  }
`;
export const GET_PROJECT_TELEGRAM_MESSAGE = gql`
  query ProjectTelegramBotMessage($project: String!, $id: ID!, $messageId: ID!) {
    projectTelegramBotMessage(project: $project, id: $id, messageId: $messageId) {
      id chatTitle chatId chatType telegramMessageId messageKind messageUrl receivedAt classifiedAt processedAt status reason lastError
      attachments { id name kind contentType sizeBytes status artifactId lastError }
      canCreateTask manual assignableMembers { id email }
      text matchedTags mentions classification tasks { id title status }
    }
  }
`;

export interface TelegramChatMentions {
  ownerUserId: string | null;
  availableTags: string[];
  members: { id: string; email: string }[];
  mentions: { key: string; label: string; sourceType: string; mappingConflict: boolean; tags: string[]; userId: string | null; effectiveUserId: string | null; resolution: 'manual' | 'linked' | 'owner'; lastSeenAt: string | null }[];
}
export const GET_TELEGRAM_CHAT_MENTIONS = gql`
  query ProjectTelegramChatMentions($project: String!, $id: ID!, $chatId: String!) {
    projectTelegramChatMentions(project: $project, id: $id, chatId: $chatId) {
      ownerUserId availableTags members { id email }
      mentions { key label sourceType mappingConflict tags userId effectiveUserId resolution lastSeenAt }
    }
  }
`;
export const SET_TELEGRAM_CHAT_MENTION = gql`
  mutation SetProjectTelegramChatMention($project: String!, $id: ID!, $chatId: String!, $mentionKey: String!, $userId: ID, $tags: [String!]) {
    setProjectTelegramChatMention(project: $project, id: $id, chatId: $chatId, mentionKey: $mentionKey, userId: $userId, tags: $tags)
  }
`;

export const CREATE_TASK_FROM_TELEGRAM_MESSAGE = gql`
  mutation CreateTaskFromTelegramMessage($project: String!, $id: ID!, $messageId: ID!, $assignees: [String!]!, $title: String) {
    createTaskFromTelegramMessage(project: $project, id: $id, messageId: $messageId, assignees: $assignees, title: $title) { queued taskId }
  }
`;

export const RETRY_TELEGRAM_MESSAGE_FILE = gql`
  mutation RetryTelegramMessageFile($project: String!, $id: ID!, $fileId: ID!) {
    retryTelegramMessageFile(project: $project, id: $id, fileId: $fileId)
  }
`;
