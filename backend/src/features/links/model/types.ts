export type LinkDirection = "from" | "to" | "both";

export interface LinkRecord {
  id: string;
  projectId: string | null;
  fromId: string;
  toId: string;
  relation: string;
  createdAt: string;
}

export interface CreateLinkInput {
  project?: string | null;
  fromId: string;
  toId: string;
  relation: string;
}

export interface ListLinksInput {
  id: string;
  direction?: LinkDirection;
}
