import { decryptEnvValue } from "../../environment-variables.js";
import { dateStringOrNull } from "./common.js";
import type { Row } from "../types.js";

// `redact: true` (the default the mixin passes for env.variable_get/list)
// masks the value only when the row itself is flagged `secret` -- a
// non-secret variable (e.g. NODE_ENV=production) is never masked
// regardless of `redact`, same "masked is per-row, redact is an opt-out"
// shape as git.variable_get's toGitVariable.
export function environmentVariableOut(row: Row, options: { redact: boolean }) {
  const secret = Boolean(row.secret);
  let value = "";
  try {
    value = decryptEnvValue(String(row.value_enc));
  } catch {
    // Display-only degrade (e.g. key rotated out from under an old row) --
    // never fail the whole read over one row's value.
  }
  return {
    id: String(row.id),
    scope: String(row.scope) as "user" | "project",
    key: String(row.key),
    value: secret && options.redact ? "[MASKED]" : value,
    secret,
    description: row.description ? String(row.description) : null,
    createdAt: dateStringOrNull(row.created_at),
    updatedAt: dateStringOrNull(row.updated_at)
  };
}
