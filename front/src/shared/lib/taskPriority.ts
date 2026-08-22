// T-MEMORY-110: raw numeric priority (task.create/task.update_priority's own
// field, lower = more urgent, see task.next's orderBy) is a backend
// implementation detail -- showing it to a human as a bare integer gives no
// sense of scale and invites arbitrary values ("is 47 more urgent than
// 50?"). Every user-facing surface instead shows/edits one of these four
// tiers; PRIORITY_TIER_VALUE is only consulted when a human explicitly picks
// a tier, converting it to the representative number the backend stores.
export type PriorityTier = 'crit' | 'high' | 'low' | 'draft';

export const PRIORITY_TIER_VALUE: Record<PriorityTier, number> = {
  crit: 10,
  high: 50,
  low: 100,
  draft: 200,
};

export const PRIORITY_TIER_COLOR: Record<PriorityTier, string> = {
  crit: 'red',
  high: 'orange',
  low: 'blue',
  draft: 'default',
};

// Boundaries mirror PRIORITY_TIER_VALUE's own representative values, so a
// task set to a tier via the UI always reads back as that same tier.
// task.create's default priority (100) falls in "low" -- an unset priority
// reads as the same tier a freshly created task gets.
export function priorityTierOf(priority: number | null | undefined): PriorityTier {
  const value = priority ?? PRIORITY_TIER_VALUE.low;
  if (value <= 25) return 'crit';
  if (value <= 75) return 'high';
  if (value <= 150) return 'low';
  return 'draft';
}

export function priorityTierOptions(t: (key: string) => string) {
  return [
    { label: t('priorityCrit'), value: 'crit' },
    { label: t('priorityHigh'), value: 'high' },
    { label: t('priorityLow'), value: 'low' },
    { label: t('priorityDraft'), value: 'draft' },
  ];
}

export function priorityTierLabel(t: (key: string) => string, tier: PriorityTier): string {
  return { crit: t('priorityCrit'), high: t('priorityHigh'), low: t('priorityLow'), draft: t('priorityDraft') }[tier];
}
