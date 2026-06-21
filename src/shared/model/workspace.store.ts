import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const PROJECT_KEY = 'pmem_selected_project';

interface WorkspaceState {
  selectedProjectSlug: string | null;
  selectedRecordId: string | null;
  selectedRecordType: string | null;
  detailDrawerOpen: boolean;
  setSelectedProject: (slug: string | null) => void;
  setSelectedRecord: (id: string, type: string) => void;
  closeDetailDrawer: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      selectedProjectSlug: null,
      selectedRecordId: null,
      selectedRecordType: null,
      detailDrawerOpen: false,
      setSelectedProject: (slug) => set({ selectedProjectSlug: slug }),
      setSelectedRecord: (id, type) =>
        set({ selectedRecordId: id, selectedRecordType: type, detailDrawerOpen: true }),
      closeDetailDrawer: () =>
        set({ detailDrawerOpen: false, selectedRecordId: null, selectedRecordType: null }),
    }),
    {
      name: PROJECT_KEY,
      partialize: (s) => ({ selectedProjectSlug: s.selectedProjectSlug }),
    },
  ),
);
