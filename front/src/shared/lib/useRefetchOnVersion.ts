import { useEffect, useRef } from 'react';

/**
 * Calls `refetch` whenever `version` changes after mount, debounced so a burst
 * of realtime events (several gateway events arriving within the same second)
 * collapses into a single refetch instead of a refetch storm.
 *
 * Skips the initial mount — the page's own `useQuery` already fetches on load,
 * so a version change is only actionable once it moves away from its starting value.
 */
export function useRefetchOnVersion(version: number, refetch: () => void, debounceMs = 300): void {
  const isFirstRun = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef(refetch);

  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      refetchRef.current();
    }, debounceMs);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [version, debounceMs]);
}
