import type { Row } from "../pg-tool-service/types.js";
import { telegramBotTags } from "./tags.js";

// Source observations are aliases of people, not separate recipients. Keep
// raw rows for provenance, but expose/edit one identity inside a bound chat.
export function chatRecipients(rows: Row[]): Row[] {
  const idsByUsername = new Map<string, string[]>();
  for (const row of rows) if (/^[0-9]+$/.test(String(row.mention_key)) && row.username) {
    const name = String(row.username).toLowerCase();
    idsByUsername.set(name, [...(idsByUsername.get(name) ?? []), String(row.mention_key)]);
  }
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = String(row.mention_key);
    const ids = key.startsWith("username:") ? idsByUsername.get(key.slice(9).toLowerCase()) : undefined;
    // Two numeric Telegram identities with the same username must stay
    // separate until the owner explicitly identifies the intended recipient.
    const canonical = ids?.length === 1 ? ids[0] : key;
    groups.set(canonical, [...(groups.get(canonical) ?? []), row]);
  }
  return [...groups].map(([key, aliases]) => {
    const person = aliases.find((r) => r.mention_key === key) ?? aliases[0];
    const userIds = [...new Set(aliases.filter((r) => r.user_id).map((r) => String(r.user_id)))];
    const conflict = userIds.length > 1;
    return { ...person, mention_key: key, alias_keys: aliases.map((r) => String(r.mention_key)),
      user_id: userIds.length === 1 ? userIds[0] : null, mapping_conflict: conflict,
      assignment_tags: [...new Set(aliases.filter((r) => r.user_id).flatMap((r) => telegramBotTags(r.assignment_tags)))],
      last_seen_at: aliases.reduce((latest, r) => new Date(String(r.last_seen_at)).getTime() > new Date(String(latest)).getTime() ? r.last_seen_at : latest, person.last_seen_at) };
  }).sort((a, b) => new Date(String(b.last_seen_at)).getTime() - new Date(String(a.last_seen_at)).getTime() || String(a.mention_key).localeCompare(String(b.mention_key)));
}

export function recipientKeys(row: Row): string[] {
  return Array.isArray(row.alias_keys) ? row.alias_keys.map(String) : [String(row.mention_key)];
}
