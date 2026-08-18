import type { Knex } from "knex";

// T-MEMORY-086: per-user server-side preferences (deliberately not
// localStorage) -- pinning projects and a generic scalar-key/value store
// for everything else (projects-list sort order, and a per-project
// Timeline root-kind pref keyed as "timelineRootKind:<projectId>").
export function createUserPrefsFacade(db: Knex) {
  async function pinnedProjectIds(userId: string): Promise<Set<string>> {
    const rows = await db("project_pins").where({ user_id: userId }).select("project_id");
    return new Set(rows.map((row) => String(row.project_id)));
  }

  async function setProjectPin(userId: string, projectId: string, pinned: boolean): Promise<{ projectId: string; pinned: boolean }> {
    if (pinned) {
      await db("project_pins")
        .insert({ user_id: userId, project_id: projectId, pinned_at: new Date() })
        .onConflict(["user_id", "project_id"])
        .ignore();
    } else {
      await db("project_pins").where({ user_id: userId, project_id: projectId }).delete();
    }
    return { projectId, pinned };
  }

  async function getPreferences(userId: string): Promise<Record<string, unknown>> {
    const rows = await db("user_settings").where({ user_id: userId }).select("key", "value");
    const out: Record<string, unknown> = {};
    for (const row of rows) {
      out[String(row.key)] = row.value;
    }
    return out;
  }

  async function setPreference(userId: string, key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    const now = new Date();
    await db("user_settings")
      .insert({ user_id: userId, key, value: JSON.stringify(value), updated_at: now })
      .onConflict(["user_id", "key"])
      .merge({ value: JSON.stringify(value), updated_at: now });
    return { key, value };
  }

  return { pinnedProjectIds, setProjectPin, getPreferences, setPreference };
}

export type UserPrefsFacade = ReturnType<typeof createUserPrefsFacade>;
