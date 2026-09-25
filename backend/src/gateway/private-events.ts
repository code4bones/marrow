// Common-scope events (project_id NULL) reach EVERY authenticated member --
// over the live WebSocket feed and through event.list / the notifications
// page. Some of them describe one user's private setup or admin housekeeping:
// which git host/labels/CI variables/AI providers/env keys somebody stored,
// who registered, was approved, re-roled or deleted (SEC-8/11). Those are
// visible to admins and to the user who caused them, nobody else. Events that
// are NOT in this list keep their existing (broadcast) behaviour.

const PRIVATE_COMMON_EVENT_PREFIXES = [
  "ai_provider_credential.",
  "environment_variable.",
  "git_credential.",
  "git_pipeline.",
  "git_variable.",
  "user.",
  "project.deleted"
] as const;

export function isPrivateCommonEventType(type: string): boolean {
  return PRIVATE_COMMON_EVENT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

export function privateCommonEventPrefixes(): readonly string[] {
  return PRIVATE_COMMON_EVENT_PREFIXES;
}

// Whether a session may see a common-scope event. `credentialId` is the
// event's author (`user:<id>` for a logged-in user).
export function isCommonEventVisibleTo(
  session: { role: string; userId: string },
  event: { type: string; credentialId: string | null }
): boolean {
  if (session.role !== "member") {
    return true;
  }
  if (!isPrivateCommonEventType(event.type)) {
    return true;
  }
  return event.credentialId === `user:${session.userId}`;
}

// The browser's WebSocket handshake carries an Origin header, and a cookie
// session rides along on it: without a check, any page a logged-in user visits
// could open the live feed on their behalf (SameSite=Lax is the only thing in
// the way). Non-browser clients send no Origin and are allowed; a browser
// Origin must be this site (Host header) or one explicitly configured.
export function isAllowedWsOrigin(origin: string | undefined, host: string | undefined, extraAllowed: string[] = []): boolean {
  if (!origin) {
    return true;
  }
  if (extraAllowed.includes(origin)) {
    return true;
  }
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}
