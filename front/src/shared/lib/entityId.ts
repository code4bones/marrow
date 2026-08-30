export type EntityType = 'task' | 'decision' | 'artifact' | 'memory' | 'project' | 'event' | 'link' | 'skill' | 'unknown';

const PREFIX_MAP: Record<string, EntityType> = {
  'T-': 'task',
  'D-': 'decision',
  'A-': 'artifact',
  'I-': 'memory',
  'P-': 'project',
  'E-': 'event',
  'L-': 'link',
  'SK-': 'skill',
};

export function getEntityType(id: string): EntityType {
  for (const [prefix, type] of Object.entries(PREFIX_MAP)) {
    if (id.startsWith(prefix)) return type;
  }
  return 'unknown';
}

export const ENTITY_COLOR: Record<EntityType, string> = {
  task:     '#177ddc',
  decision: '#9254de',
  artifact: '#13a8a8',
  memory:   '#d89614',
  project:  '#52c41a',
  event:    '#eb2f96',
  link:     '#fa8c16',
  skill:    '#36cfc9',
  unknown:  '#595959',
};

// Canonical satellite-dot colors — what's actually painted on screen today
// as the small dots on DecisionTimeline's RecordCard satellites and in its
// own legend ("dotsOnACard" section of DecisionTimeline.tsx). Extracted from
// that file (was a local, unexported const there) so other views that want
// to match those exact on-screen colors (e.g. project-overview's stat row)
// import the same values instead of drifting. Deliberately NOT merged with
// ENTITY_COLOR above: the two disagree on purpose for task (#177ddc vs
// #13a8a8) and artifact (#13a8a8 vs #f759ab) — ENTITY_COLOR is the
// root-search kind-dot / RecordLink-chip mapping, this is the
// satellite-dot mapping; DecisionTimeline.tsx's `kindDotColor` explicitly
// uses ENTITY_COLOR instead of this one for that reason. No EVENT entry:
// events are never rendered as a satellite dot on a card.
export const SATELLITE_KIND_COLOR: Record<string, string> = {
  DECISION: '#9254de',
  TASK: '#13a8a8',
  MEMORY: '#d89614',
  ARTIFACT: '#f759ab',
};
