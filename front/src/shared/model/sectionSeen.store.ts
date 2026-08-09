import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Project Overview's per-category "new since last viewed" badges (see
// widgets/project-overview/index.tsx) used to all read the single global
// notificationsSeenAt (auth.store.ts) -- clearable only from the dedicated
// Notifications page. Owner's expectation: opening Tasks should clear the
// Tasks badge specifically, without needing a separate "mark as read"
// action. This store tracks a last-visited timestamp per (project, section)
// pair instead, set by each section's own list page on mount.
export type SectionKey = 'tasks' | 'decisions' | 'artifacts' | 'events' | 'memory';

interface SectionSeenState {
  seenAt: Record<string, string>;
  markSeen: (slug: string, section: SectionKey) => void;
  getSeenAt: (slug: string, section: SectionKey) => string | null;
}

function seenKey(slug: string, section: SectionKey): string {
  return `${slug}:${section}`;
}

export const useSectionSeenStore = create<SectionSeenState>()(
  persist(
    (set, get) => ({
      seenAt: {},
      markSeen: (slug, section) =>
        set((state) => ({ seenAt: { ...state.seenAt, [seenKey(slug, section)]: new Date().toISOString() } })),
      getSeenAt: (slug, section) => get().seenAt[seenKey(slug, section)] ?? null,
    }),
    { name: 'marrow_section_seen' },
  ),
);
