export interface EventRecord {
  id: string;
  projectId: string | null;
  type: string;
  title: string | null;
  body: string | null;
  relatedId: string | null;
  createdAt: string;
}

export interface RecordEventInput {
  project?: string | null;
  type: string;
  title?: string;
  body?: string;
  relatedId?: string;
}

export interface ListEventsInput {
  project?: string | null;
  relatedId?: string;
  limit?: number;
}
