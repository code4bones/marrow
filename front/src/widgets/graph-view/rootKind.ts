// Split out of DecisionTimeline.tsx (mirrors tone.tsx's split from
// RemarkPanel.tsx) so react-refresh/only-export-components stays happy —
// DecisionTimeline.tsx keeps exporting only its component, ProjectGraphView
// needs these to build the "Root:" dropdown in its own header (D-MEMORY-024).

export const ROOT_KIND_OPTIONS = [
  { label: 'Decisions', value: 'DECISION' },
  { label: 'Tasks', value: 'TASK' },
  { label: 'Memory', value: 'MEMORY' },
  { label: 'Artifacts', value: 'ARTIFACT' },
] as const;

export type RootKind = (typeof ROOT_KIND_OPTIONS)[number]['value'];

export const ROOT_KIND_LABEL: Record<RootKind, string> = {
  DECISION: 'Decisions',
  TASK: 'Tasks',
  MEMORY: 'Memory',
  ARTIFACT: 'Artifacts',
};

export const ROOT_KIND_EMPTY_HINT: Record<RootKind, string> = {
  DECISION: 'The timeline fills in as decision.record / decision.supersede are used',
  TASK: 'The timeline fills in as task.create is used',
  MEMORY: 'The timeline fills in as memory.create / memory.upsert are used',
  ARTIFACT: 'The timeline fills in as artifact.put is used',
};
