import { defaultAnonymousClientTtlSeconds } from "../types.js";
import { dateStringOrNull, jsonObject, stringOrNull } from "./common.js";
import type { Row } from "../types.js";

export function cutoffFromSeconds(seconds: number): string {
  return new Date(Date.now() - Math.max(0, seconds) * 1000).toISOString();
}

export function anonymousClientTtlSeconds(): number {
  const raw = process.env.GATEWAY_ANONYMOUS_CLIENT_TTL_SECONDS;
  if (raw === undefined || raw.trim().length === 0) {
    return defaultAnonymousClientTtlSeconds;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : defaultAnonymousClientTtlSeconds;
}

export function clientOut(row: Row) {
  return {
    id: String(row.id),
    label: stringOrNull(row.label),
    lastSeenAt: dateStringOrNull(row.last_seen_at),
    metadata: jsonObject(row.metadata),
    createdAt: dateStringOrNull(row.created_at),
    updatedAt: dateStringOrNull(row.updated_at)
  };
}


export function compactClient(row: Row) {
  return {
    id: String(row.id),
    label: stringOrNull(row.label),
    kind: stringOrNull(jsonObject(row.metadata).kind),
    lastSeenAt: dateStringOrNull(row.last_seen_at)
  };
}
