import { create } from 'zustand';

interface MobileBackState {
  handler: (() => boolean) | null;
  setHandler: (handler: (() => boolean) | null) => void;
}

// T-context (2026-08-26, owner's ask: mobile PWA layout follow-up -- "если
// я провалился глубже, back возвращает к списку проектов, а не предыдущему
// пункту"): MobileHeader's back arrow is one global control, but content
// underneath it can own a local navigation stack of its own (e.g.
// DecisionTimeline's Miller drill chain, T-MEMORY-131) that back should pop
// ONE level of before falling through to "leave the project". Rather than
// lifting that local state into a shared store, whichever mobile screen
// currently owns a poppable stack registers a handler here (returning true
// if it popped something); MobileHeader tries it first and only falls back
// to its own project-level back when the handler is absent or reports
// nothing to pop.
export const useMobileBackStore = create<MobileBackState>((set) => ({
  handler: null,
  setHandler: (handler) => set({ handler }),
}));
