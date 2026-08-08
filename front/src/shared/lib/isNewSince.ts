/**
 * T-MEMORY-051 follow-up: shared "is this newer than the account-wide
 * notifications cursor" check. Backs the Overview per-category badges and
 * the per-row "New" tags on the realtime-wired list pages (Tasks,
 * Decisions, Artifacts, Memory) — reusing the same `notificationsSeenAt`
 * cursor T-MEMORY-051 already persists server-side, not a new per-row or
 * per-category storage mechanism.
 *
 * A null `seenAt` (never viewed the notifications page) means everything is
 * new. A null `timestamp` (defensive — the gateway always sets one) also
 * counts as new rather than being silently excluded.
 */
export function isNewSince(timestamp: string | null, seenAt: string | null): boolean {
  if (!timestamp) return true;
  return seenAt === null || new Date(timestamp) > new Date(seenAt);
}
