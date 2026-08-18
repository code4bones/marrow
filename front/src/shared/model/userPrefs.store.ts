import { create } from 'zustand';
import { apolloClient } from '../api/apollo';
import { GET_USER_PREFERENCES, SET_USER_PREFERENCE } from '../api/queries';

// T-MEMORY-086: deliberately NOT zustand's `persist` middleware (that writes
// to localStorage) -- every value here lives server-side per user, fetched
// once via GraphQL and cached in memory for the session. `load()` is
// idempotent/safe to call from every consumer's mount effect (see
// useUserPreference below); only the first call actually hits the network.
interface UserPrefsState {
  loaded: boolean;
  loading: boolean;
  preferences: Record<string, unknown>;
  load: () => Promise<void>;
  set: (key: string, value: unknown) => Promise<void>;
}

export const useUserPrefsStore = create<UserPrefsState>()((set, get) => ({
  loaded: false,
  loading: false,
  preferences: {},
  load: async () => {
    if (get().loaded || get().loading) return;
    set({ loading: true });
    try {
      const { data } = await apolloClient.query<{ userPreferences: Record<string, unknown> }>({
        query: GET_USER_PREFERENCES,
        fetchPolicy: 'network-only',
      });
      set({ preferences: data?.userPreferences ?? {}, loaded: true, loading: false });
    } catch {
      // Not logged in yet, or the query failed -- still mark loaded so
      // consumers stop waiting and fall back to their own defaults instead
      // of hanging forever.
      set({ loaded: true, loading: false });
    }
  },
  set: async (key, value) => {
    // Optimistic: the caller (a Select/Switch onChange) needs the UI to
    // reflect the choice immediately, not after a round trip.
    set((s) => ({ preferences: { ...s.preferences, [key]: value } }));
    try {
      await apolloClient.mutate({ mutation: SET_USER_PREFERENCE, variables: { key, value } });
    } catch {
      // Best-effort persistence -- the in-memory value for this session is
      // already correct either way; a failed write just means it won't
      // survive a reload, not worth surfacing as an error for a UI pref.
    }
  },
}));
