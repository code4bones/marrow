export type EntityType = 'task' | 'decision' | 'artifact' | 'memory' | 'project' | 'event' | 'link' | 'unknown';

const PREFIX_MAP: Record<string, EntityType> = {
  'T-': 'task',
  'D-': 'decision',
  'A-': 'artifact',
  'I-': 'memory',
  'P-': 'project',
  'E-': 'event',
  'L-': 'link',
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
  unknown:  '#595959',
};
