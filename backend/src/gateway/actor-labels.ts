import type { Knex } from "knex";

// T-MEMORY-085: every record's created_by (or Event's credentialId, same
// underlying value) is a raw clientId string -- "user:<id>" for a real
// logged-in session (see credits.ts's userIdFromClientId for the same
// convention), or a plain gateway_clients.id otherwise (an agent/CLI/token
// connection). Neither is fit to show a human directly; this batch-resolves
// a page's worth of them into a label in two queries total instead of one
// per row.
export interface ActorLabel {
  id: string;
  label: string;
}

export function createActorLabelsFacade(db: Knex) {
  async function resolveLabels(ids: readonly string[]): Promise<ActorLabel[]> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === "string" && id.length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const userIdByRawId = new Map<string, string>();
    const clientIds: string[] = [];
    for (const id of uniqueIds) {
      if (id.startsWith("user:")) {
        userIdByRawId.set(id.slice(5), id);
      } else {
        clientIds.push(id);
      }
    }
    const userIds = Array.from(userIdByRawId.keys());

    const [users, clients] = await Promise.all([
      userIds.length > 0 ? db("users").whereIn("id", userIds).select("id", "email") : Promise.resolve([]),
      clientIds.length > 0 ? db("gateway_clients").whereIn("id", clientIds).select("id", "label") : Promise.resolve([])
    ]);

    const labelByRawId = new Map<string, string>();
    for (const user of users as { id: string; email: string }[]) {
      const rawId = userIdByRawId.get(user.id);
      if (rawId) {
        labelByRawId.set(rawId, user.email);
      }
    }
    for (const client of clients as { id: string; label: string | null }[]) {
      if (client.label) {
        labelByRawId.set(client.id, client.label);
      }
    }

    return uniqueIds.map((id) => ({ id, label: labelByRawId.get(id) ?? id }));
  }

  return { resolveLabels };
}
