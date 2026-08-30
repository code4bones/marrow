import { create } from 'zustand';

export type VersionKey =
  | 'tasksVersion'
  | 'decisionsVersion'
  | 'projectsVersion'
  | 'artifactsVersion'
  | 'memoryVersion'
  | 'linksVersion'
  | 'skillsVersion';

interface RealtimeState extends Record<VersionKey, number> {
  /** Always bumped, regardless of prefix — drives the Events/timeline page. */
  eventsVersion: number;
  handleGatewayEvent: (event: string, payload: unknown) => void;
}

/**
 * Ordered [prefix, storeKey] pairs — checked with startsWith(), first match wins.
 * Exported (T-MEMORY-051 follow-up) so the Overview widget can bucket its own
 * recent-events fetch into the same categories this store already tracks, for
 * the per-category "new since last viewed" badges.
 */
export const PREFIX_MAP: Array<[string, VersionKey]> = [
  ['task.', 'tasksVersion'],
  ['decision.', 'decisionsVersion'],
  ['project.', 'projectsVersion'],
  ['artifact.', 'artifactsVersion'],
  ['memory.', 'memoryVersion'],
  ['item.', 'memoryVersion'],
  ['link.', 'linksVersion'],
  ['skill.', 'skillsVersion'],
];

export const useRealtimeStore = create<RealtimeState>((set) => ({
  tasksVersion: 0,
  decisionsVersion: 0,
  projectsVersion: 0,
  artifactsVersion: 0,
  memoryVersion: 0,
  linksVersion: 0,
  skillsVersion: 0,
  eventsVersion: 0,

  handleGatewayEvent: (event) => {
    const match = PREFIX_MAP.find(([prefix]) => event.startsWith(prefix));
    set((state) => ({
      ...(match ? { [match[1]]: state[match[1]] + 1 } : {}),
      eventsVersion: state.eventsVersion + 1,
    }));
  },
}));
