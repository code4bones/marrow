export type DecisionStatus = "draft" | "current" | "superseded" | "rejected" | "archived";

export interface Decision {
  id: string;
  projectId: string | null;
  title: string;
  status: DecisionStatus;
  context: string | null;
  decision: string;
  rationale: string | null;
  consequences: string | null;
  tags: string[];
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecordDecisionInput {
  project?: string | null;
  title: string;
  status?: DecisionStatus;
  context?: string;
  decision: string;
  rationale?: string;
  consequences?: string;
  tags?: string[];
  supersedesId?: string | null;
}

export interface ListDecisionsInput {
  project?: string | null;
  includeCommon?: boolean;
  status?: DecisionStatus;
  limit?: number;
}
