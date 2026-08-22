// Split out of DecisionTimeline.tsx (mirrors tone.tsx's split from
// RemarkPanel.tsx) so react-refresh/only-export-components stays happy —
// DecisionTimeline.tsx keeps exporting only its component, ProjectGraphView
// needs these to build the "Root:" dropdown in its own header (D-MEMORY-024).
//
// I-MEMORY-audit: labels/hints here used to be plain hardcoded English
// (ROOT_KIND_LABEL/ROOT_KIND_OPTIONS/ROOT_KIND_EMPTY_HINT constants), so
// every consumer — the "Root:" <Select>, DecisionTimeline's column header,
// and its empty-state copy — rendered "Decisions"/"Tasks"/"Memory"/
// "Artifacts" verbatim even in the Russian UI. Converted to functions that
// take the caller's own `t` so these read from the translations table like
// everything else. The plural kind words reuse the exact strings already
// seeded for the nav rail's own section labels (nav:tasks/decisions/memory/
// artifacts) rather than duplicating a second translated copy of the same
// four words under a different namespace.

export const ROOT_KIND_VALUES = ['DECISION', 'TASK', 'MEMORY', 'ARTIFACT'] as const;

export type RootKind = (typeof ROOT_KIND_VALUES)[number];

type TFunc = (key: string, options?: Record<string, unknown>) => string;

export function rootKindLabel(t: TFunc, kind: RootKind): string {
  switch (kind) {
    case 'DECISION': return t('decisions', { ns: 'nav' });
    case 'TASK': return t('tasks', { ns: 'nav' });
    case 'MEMORY': return t('memory', { ns: 'nav' });
    case 'ARTIFACT': return t('artifacts', { ns: 'nav' });
  }
}

export function rootKindOptions(t: TFunc): { label: string; value: RootKind }[] {
  return ROOT_KIND_VALUES.map((value) => ({ value, label: rootKindLabel(t, value) }));
}

// Only tasks/decisions carry a `milestone` field -- memory items and
// artifacts don't, so the "Group by milestone" toggle only makes sense for
// those two root kinds (mirrors "Show tasks" being DECISION-only above it).
export function kindHasMilestone(kind: RootKind): boolean {
  return kind === 'TASK' || kind === 'DECISION';
}

// T-MEMORY-092: status filter toggles under the Timeline's baseline filter
// row -- the exact status enums live in the backend's check constraints
// (tasks/decisions/items/artifacts), duplicated here as plain data since
// there's no tool that returns them and StatusBadge already renders the
// raw status string verbatim (uppercased), not a translated label, so no
// i18n lookup is needed for these either.
export function rootKindStatuses(kind: RootKind): string[] {
  switch (kind) {
    case 'TASK': return ['todo', 'doing', 'blocked', 'review', 'changes_requested', 'done', 'cancelled'];
    case 'DECISION': return ['draft', 'accepted', 'superseded', 'rejected', 'archived'];
    case 'MEMORY': return ['current', 'draft', 'open', 'answered', 'superseded', 'rejected', 'archived'];
    case 'ARTIFACT': return ['current', 'archived'];
  }
}

// Empty-state hint shown under the baseline ribbon when no records of this
// kind exist yet — DecisionTimeline is the sole consumer, so these live in
// the 'decisions' namespace it already loads.
export function rootKindEmptyHint(t: TFunc, kind: RootKind): string {
  switch (kind) {
    case 'DECISION': return t('rootKindEmptyHintDecision', { ns: 'decisions' });
    case 'TASK': return t('rootKindEmptyHintTask', { ns: 'decisions' });
    case 'MEMORY': return t('rootKindEmptyHintMemory', { ns: 'decisions' });
    case 'ARTIFACT': return t('rootKindEmptyHintArtifact', { ns: 'decisions' });
  }
}
