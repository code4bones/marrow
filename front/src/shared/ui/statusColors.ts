// Split out of StatusBadge.tsx (mirrors tone.tsx's split from
// RemarkPanel.tsx) so react-refresh/only-export-components stays happy —
// that rule requires a component file to export nothing but the
// component. StatusBadge.tsx keeps exporting only its component; this
// mapping lives here so other views needing a status→color read (not just
// the rendered <Tag> itself) can derive from the same canonical mapping —
// e.g. DecisionTimeline's generalized drill cards (T-MEMORY-049) for
// memory/artifact statuses.
export const STATUS_COLORS: Record<string, string> = {
  // "active" stays mapped (used by users/projects/task_claims, where it
  // correctly means "ongoing" -- unlike decisions/memory/artifacts, which
  // were renamed to "current" for the opposite reason: their old "active"
  // read as "in progress" when it actually meant "already decided/still
  // valid, not archived/superseded").
  active: 'green',
  current: 'green',
  open: 'green',
  in_progress: 'blue',
  done: 'default',
  paused: 'orange',
  blocked: 'red',
  archived: 'default',
  draft: 'purple',
  superseded: 'default',
  rejected: 'red',
};
