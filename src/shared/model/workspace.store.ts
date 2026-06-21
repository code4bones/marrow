import { create } from 'zustand';

interface WorkspaceState {
  selectedProjectSlug: string | null;
  selectedRecordId: string | null;
  selectedRecordType: string | null;
  detailDrawerOpen: boolean;
  setSelectedProject: (slug: string | null) => void;
  setSelectedRecord: (id: string, type: string) => void;
  closeDetailDrawer: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedProjectSlug: null,
  selectedRecordId: null,
  selectedRecordType: null,
  detailDrawerOpen: false,
  setSelectedProject: (slug) => set({ selectedProjectSlug: slug }),
  setSelectedRecord: (id, type) =>
    set({ selectedRecordId: id, selectedRecordType: type, detailDrawerOpen: true }),
  closeDetailDrawer: () =>
    set({ detailDrawerOpen: false, selectedRecordId: null, selectedRecordType: null }),
}));
