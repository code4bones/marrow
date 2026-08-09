export type ItemStatus = "current" | "draft" | "archived" | "superseded" | "rejected";

export interface MemoryItem {
  id: string;
  projectId: string | null;
  type: string;
  title: string;
  body: string;
  status: ItemStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemoryInput {
  id?: string;
  project?: string | null;
  common?: boolean;
  type: string;
  title: string;
  body: string;
  status?: ItemStatus;
  tags?: string[];
}

export interface UpdateMemoryInput {
  id: string;
  title?: string;
  body?: string;
  status?: ItemStatus;
  tags?: string[];
}

export interface SearchMemoryInput {
  query: string;
  project?: string | null;
  includeCommon?: boolean;
  type?: string;
  status?: ItemStatus;
  limit?: number;
}

export interface MemorySearchResult {
  id: string;
  scope: "project" | "common";
  type: string;
  title: string;
  excerpt: string;
  status: ItemStatus;
  tags: string[];
  rank: number;
}
