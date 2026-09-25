import * as z from "zod/v4";
import { gatewayToolSpecs } from "../tool-definitions.js";

// Which gateway tools the "Ask Marrow" assistant may call.
//
// The model's tool calls run with the logged-in human's own authority, and
// its context includes record bodies written by any project member or agent
// -- i.e. untrusted text. A prompt injected into such a record must not be
// able to delete data, change who can access a project, read unmasked
// secrets or exfiltrate anything (SEC-3). So this is a default-deny policy:
//   - admin-tier tools: never;
//   - write-tier tools: only those in AI_CHAT_ALLOWED_WRITE_TOOLS, so a
//     newly added write tool is NOT exposed to the model until someone opts
//     it in here;
//   - read-tier tools: all, minus the ones that expose other users'
//     identities, server internals or credential metadata.
// Everything destructive (*.delete, *.archive), membership/invite/role
// management, env variable writes, preferences, provider/git credentials and
// recursive ai.* stays UI-only.

export const AI_CHAT_ALLOWED_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "artifact.put_text",
  "artifact.update_metadata",
  "decision.record",
  "decision.supersede",
  "decision.update_assignee",
  "decision.update_milestone",
  "decision.update_status",
  "event.record",
  "failed_attempt.record",
  "handoff.create",
  "link.create",
  "memory.create",
  "memory.update",
  "memory.upsert",
  "reply.create",
  "request.create",
  "skill.activate",
  "skill.record",
  "skill.update",
  "task.add_note",
  "task.complete",
  "task.create",
  "task.update_assignee",
  "task.update_details",
  "task.update_milestone",
  "task.update_priority",
  "task.update_status",
  "task.update_title"
]);

export const AI_CHAT_EXCLUDED_READ_TOOLS: ReadonlySet<string> = new Set([
  "ai.available_models",
  "ai.conversation_messages",
  "ai.conversations_list",
  "ai.provider_list",
  "credit.balance",
  "credit.history",
  "credit.leaderboard",
  "credit.settings_get",
  "gateway.actor_labels",
  "gateway.backup_manifest",
  "gateway.client_get",
  "gateway.clients",
  "gateway.diagnostics",
  "git.credential_list",
  "git.job_artifacts_download",
  "user.preferences_get"
]);

export function aiChatToolSpecs() {
  return gatewayToolSpecs.filter((spec) => {
    if (spec.access === "admin") {
      return false;
    }
    if (spec.access === "write") {
      return AI_CHAT_ALLOWED_WRITE_TOOLS.has(spec.name);
    }
    return !AI_CHAT_EXCLUDED_READ_TOOLS.has(spec.name);
  });
}

// Tools whose schema has a `redact` switch (env/git variables, job traces):
// the model must never be the one deciding whether secrets come back in
// plaintext, so the loop forces redact:true on these.
export function aiChatRedactTools(): ReadonlySet<string> {
  const names = new Set<string>();
  for (const spec of aiChatToolSpecs()) {
    const properties = (z.toJSONSchema(spec.schema) as { properties?: Record<string, unknown> }).properties ?? {};
    if ("redact" in properties) {
      names.add(spec.name);
    }
  }
  return names;
}
