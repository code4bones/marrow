// Split out of StatusBadge.tsx (mirrors tone.tsx's split from
// RemarkPanel.tsx) so react-refresh/only-export-components stays happy —
// that rule requires a component file to export nothing but the
// component. StatusBadge.tsx keeps exporting only its component; this
// mapping lives here so other views needing a status→color read (not just
// the rendered <Tag> itself) can derive from the same canonical mapping —
// e.g. DecisionTimeline's generalized drill cards (T-MEMORY-049) for
// memory/artifact statuses.
export const STATUS_COLORS: Record<string, string> = {
  active: 'green',
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
