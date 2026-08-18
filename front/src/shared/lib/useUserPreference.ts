import { useCallback, useEffect } from 'react';
import { useUserPrefsStore } from '../model/userPrefs.store';

/**
 * T-MEMORY-086: a single server-persisted (NOT localStorage) preference,
 * keyed by an arbitrary string. Pass `key: null` to disable persistence
 * while some prerequisite (e.g. a project id from an in-flight query)
 * isn't known yet -- the fallback is returned and the setter becomes a
 * local-only no-op-for-persistence until a real key is passed.
 */
export function useUserPreference<T>(key: string | null, fallback: T): [T, (value: T) => void] {
  const loaded = useUserPrefsStore((s) => s.loaded);
  const load = useUserPrefsStore((s) => s.load);
  const raw = useUserPrefsStore((s) => (key ? s.preferences[key] : undefined));
  const setPref = useUserPrefsStore((s) => s.set);

  useEffect(() => {
    void load();
  }, [load]);

  const value = loaded && key && raw !== undefined ? (raw as T) : fallback;
  const setValue = useCallback(
    (next: T) => {
      if (key) void setPref(key, next);
    },
    [key, setPref],
  );

  return [value, setValue];
}
