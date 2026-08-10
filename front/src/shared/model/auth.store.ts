import { create } from 'zustand';
import { API_BASE_URL } from '../config/env';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  status: string;
  totpEnabled: boolean;
}

export interface PendingRegistration {
  id: string;
  email: string;
  createdAt: string;
}

export interface AccountUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  totpEnabled: boolean;
  createdAt: string;
}

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface RegisterStartResult {
  token: string;
  otpauthUrl: string;
  secretBase32: string;
}

interface RegisterConfirmResult {
  recoveryCodes: string[];
}

interface Enroll2faResult {
  otpauthUrl: string;
  secretBase32: string;
}

interface RecoveryCodesResult {
  recoveryCodes: string[];
}

/** One named personal API token (e.g. "Claude Code (CLI)", "Codex (CLI)") — a user may hold several, each fully independent: regenerating or deleting one never touches another. */
export interface PersonalToken {
  id: string;
  label: string | null;
  tokenHint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Returned once, at creation or regeneration time — the only moment the raw token is ever visible (shown-once, same as recovery codes / the TOTP secret). */
export interface PersonalTokenSecretResult {
  id: string;
  token: string;
  tokenHint: string;
  label: string | null;
  createdAt: string;
}

/** One named OAuth connector credential (e.g. "Claude.ai", "ChatGPT") — a user may hold several, each fully independent: regenerating or deleting one never touches another. clientId is NOT secret — safe to display persistently, unlike clientSecretHint. */
export interface OAuthClient {
  id: string;
  label: string | null;
  clientId: string;
  clientSecretHint: string;
  redirectUri: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Returned once, at creation or regeneration time — the only moment the raw client_secret is ever visible (shown-once, same as recovery codes / the TOTP secret). */
export interface OAuthClientSecretResult {
  id: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string | null;
  createdAt: string;
}

/** T-MEMORY-051: null = never viewed the notifications page — every event counts as unread. */
export interface NotificationsStatus {
  seenAt: string | null;
}

interface ClaimContextResult {
  email: string | null;
  purpose: string;
}

export interface GithubLinkStatus {
  linked: boolean;
  githubLogin: string | null;
}

interface ClaimResult {
  email: string;
  emailVerified: boolean;
  verifyEmailPath?: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** null = not checked yet. true = no admin exists, show first-run setup instead of login. */
  bootstrapNeeded: boolean | null;
  /** Set after a login() call returns pending_totp — second login step is needed. */
  pendingTotpUserId: string | null;
  /** T-MEMORY-051: last known notifications_seen_at, kept in sync by fetchNotificationsSeenAt/markNotificationsSeen — the nav-rail badge reads this to compute unreadCount. */
  notificationsSeenAt: string | null;

  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginTotp: (code: string) => Promise<void>;
  /** Populates the second-login-step state from a GitHub-callback redirect (?pendingTotpUserId=...) instead of a login() response. */
  setPendingTotpUserId: (userId: string | null) => void;
  bootstrapAdmin: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;

  registerStart: (email: string, password: string) => Promise<RegisterStartResult>;
  /** Fetches otpauthUrl/secretBase32 for a GitHub-originated pending registration (?githubToken=...) without consuming it -- registerConfirm still finishes it, same as the password flow. */
  registerPendingContext: (token: string) => Promise<RegisterStartResult>;
  registerConfirm: (token: string, code: string) => Promise<RegisterConfirmResult>;

  /** GitHub account link status for the profile page's Connect section. */
  fetchGithubStatus: () => Promise<GithubLinkStatus>;
  unlinkGithub: () => Promise<void>;

  /** Invite-claim flow (admin-issued invite, or a password-reset link — same token/password shape). */
  claimContext: (token: string) => Promise<ClaimContextResult>;
  claim: (token: string, password: string) => Promise<ClaimResult>;
  verifyEmail: (verifyToken: string) => Promise<void>;

  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  enroll2fa: () => Promise<Enroll2faResult>;
  confirm2fa: (code: string) => Promise<RecoveryCodesResult>;
  disable2fa: (currentPassword: string) => Promise<void>;
  regenerateRecoveryCodes: (currentPassword: string) => Promise<RecoveryCodesResult>;

  /** T-MEMORY-047: this user's personal Marrow API tokens (one per named CLI/agent connection, e.g. "Claude Code (CLI)"/"Codex (CLI)") — see the Connect section of the profile page. */
  fetchPersonalTokens: () => Promise<PersonalToken[]>;
  /** Creates a brand-new, independent token — never touches any of this user's other tokens (the fix for the old "generating one invalidates all" problem). token is returned exactly once (shown-once). */
  createPersonalToken: (label: string | null) => Promise<PersonalTokenSecretResult>;
  /** Rotates the secret for one specific token (by id), invalidating only that token's previous value — every other token keeps working unchanged. token is returned exactly once (shown-once); label is unchanged. */
  regeneratePersonalToken: (id: string) => Promise<PersonalTokenSecretResult>;
  /** Permanently removes one token; every other token is unaffected. */
  deletePersonalToken: (id: string) => Promise<void>;

  /** This user's OAuth connector credentials (client id + secret hint per named connector), for the web-connector (Claude.ai/ChatGPT) tabs of the Connect section — replaces the old one-per-user OAuth client id/secret pair. */
  fetchOAuthClients: () => Promise<OAuthClient[]>;
  /** Creates a brand-new, independent credential — never touches any of this user's other credentials (the fix for the old "regenerating one invalidates all" problem). clientSecret is returned exactly once (shown-once). */
  createOAuthClient: (label: string, redirectUri: string) => Promise<OAuthClientSecretResult>;
  /** Rotates client_id AND client_secret for one specific credential (by id), invalidating only that credential's previous pair — every other credential keeps working unchanged. clientSecret is returned exactly once (shown-once); clientId is not secret and stays visible via fetchOAuthClients afterward. */
  regenerateOAuthClient: (id: string) => Promise<OAuthClientSecretResult>;
  /** Fixes a credential's label and/or redirect_uri in place, leaving its clientId/secret untouched — for a connector whose callback was wrong or never captured at creation time, or a legacy credential (label: null) that predates per-connector labeling. Both fields optional; pass only what changed. */
  updateOAuthClient: (id: string, updates: { label?: string | null; redirectUri?: string }) => Promise<OAuthClient>;
  /** Permanently removes one credential; every other credential is unaffected. */
  deleteOAuthClient: (id: string) => Promise<void>;

  /** T-MEMORY-051: current notifications-seen status — drives the nav-rail unread badge. */
  fetchNotificationsSeenAt: () => Promise<NotificationsStatus>;
  /** Stamps notifications_seen_at = now() server-side (survives across devices) — called once on mount by the notifications page. */
  markNotificationsSeen: () => Promise<NotificationsStatus>;

  fetchPendingUsers: () => Promise<PendingRegistration[]>;
  approvePendingUser: (id: string) => Promise<void>;
  rejectPendingUser: (id: string) => Promise<void>;

  fetchUsers: () => Promise<AccountUser[]>;
  setUserRole: (id: string, role: 'admin' | 'member') => Promise<void>;
  setUserStatus: (id: string, status: 'active' | 'disabled') => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
}

async function readJson(response: Response): Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }> {
  try {
    return await response.json();
  } catch {
    return { ok: false };
  }
}

/** POST helper shared by every auth mutation below: same base URL, cookie, JSON body/response shape. */
async function postJson<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const responseBody = await readJson(response);
  if (!response.ok || responseBody.ok === false) {
    throw new Error(responseBody.error?.message ?? fallbackError);
  }
  return responseBody.data as T;
}

/** DELETE helper, same base URL/cookie/JSON-response shape as postJson — used only by deleteOAuthClient (the first endpoint in this store to need one). */
async function deleteRequest(path: string, fallbackError: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const responseBody = await readJson(response);
  if (!response.ok || responseBody.ok === false) {
    throw new Error(responseBody.error?.message ?? fallbackError);
  }
}

/** PATCH helper, same shape as postJson — used only by updateOAuthClient (the first endpoint in this store to need one). */
async function patchJson<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const responseBody = await readJson(response);
  if (!response.ok || responseBody.ok === false) {
    throw new Error(responseBody.error?.message ?? fallbackError);
  }
  return responseBody.data as T;
}

function requireUser(data: { status: string; user?: AuthUser }): AuthUser | null {
  if (data.status === 'pending_totp') {
    return null;
  }
  if (!data.user) {
    throw new Error('Response did not include a user.');
  }
  return data.user;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'checking',
  user: null,
  bootstrapNeeded: null,
  pendingTotpUserId: null,
  notificationsSeenAt: null,

  initialize: async () => {
    const bootstrapResponse = await fetch(`${API_BASE_URL}/auth/bootstrap`, { credentials: 'include' });
    const bootstrapBody = await readJson(bootstrapResponse);
    const adminExists = bootstrapResponse.ok
      ? Boolean((bootstrapBody.data as { adminExists?: boolean } | undefined)?.adminExists)
      : true;
    set({ bootstrapNeeded: !adminExists });
    if (!adminExists) {
      set({ status: 'unauthenticated', user: null });
      return;
    }

    const meResponse = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
    if (!meResponse.ok) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    const meBody = await readJson(meResponse);
    set({ status: 'authenticated', user: meBody.data as AuthUser });
  },

  refreshMe: async () => {
    const meResponse = await fetch(`${API_BASE_URL}/auth/me`, { credentials: 'include' });
    if (!meResponse.ok) {
      set({ status: 'unauthenticated', user: null });
      return;
    }
    const meBody = await readJson(meResponse);
    set({ status: 'authenticated', user: meBody.data as AuthUser });
  },

  login: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body.error?.message ?? 'Login failed.');
    }
    const data = body.data as { status: string; user?: AuthUser; userId?: string };
    if (data.status === 'pending_totp') {
      set({ pendingTotpUserId: data.userId ?? null });
      return;
    }
    const user = requireUser(data);
    if (user) {
      set({ status: 'authenticated', user, pendingTotpUserId: null });
    }
  },

  setPendingTotpUserId: (userId) => set({ pendingTotpUserId: userId }),

  loginTotp: async (code) => {
    const userId = get().pendingTotpUserId;
    if (!userId) {
      throw new Error('No login in progress — start over from the sign-in form.');
    }
    const response = await fetch(`${API_BASE_URL}/auth/login/2fa`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId, code }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body.error?.message ?? 'Invalid code.');
    }
    const data = body.data as { status: string; user?: AuthUser };
    const user = requireUser(data);
    if (user) {
      set({ status: 'authenticated', user, pendingTotpUserId: null });
    }
  },

  bootstrapAdmin: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/auth/bootstrap`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(body.error?.message ?? 'Could not create the admin account.');
    }
    const data = body.data as { status: string; user?: AuthUser };
    const user = requireUser(data);
    if (user) {
      set({ status: 'authenticated', user, bootstrapNeeded: false });
    }
  },

  logout: async () => {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    set({ status: 'unauthenticated', user: null, pendingTotpUserId: null });
  },

  registerStart: (email, password) =>
    postJson<RegisterStartResult>('/auth/register', { email, password }, 'Could not start registration.'),

  registerPendingContext: async (token) => {
    const response = await fetch(`${API_BASE_URL}/auth/register/pending?token=${encodeURIComponent(token)}`, {
      credentials: 'include',
    });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'This link is invalid or has expired.');
    }
    return body.data as RegisterStartResult;
  },

  registerConfirm: (token, code) =>
    postJson<RegisterConfirmResult>('/auth/register/confirm', { token, code }, 'Invalid or expired code.'),

  fetchGithubStatus: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/profile/github`, { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'Could not load GitHub link status.');
    }
    return body.data as GithubLinkStatus;
  },

  unlinkGithub: () => postJson('/auth/profile/github/unlink', {}, 'Could not unlink GitHub.'),

  claimContext: async (token) => {
    const response = await fetch(`${API_BASE_URL}/auth/claim?token=${encodeURIComponent(token)}`, {
      credentials: 'include',
    });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'This link is invalid or has expired.');
    }
    return body.data as ClaimContextResult;
  },

  claim: (token, password) => postJson<ClaimResult>('/auth/claim', { token, password }, 'Could not set your password.'),

  verifyEmail: async (verifyToken) => {
    // Same-browser relay: no SMTP is configured, so claim() hands back the
    // verify-email path directly to the browser that just claimed instead of
    // emailing it — see docs/AUTH.md's "No SMTP sending yet" note.
    await postJson(`/auth/verify-email?token=${encodeURIComponent(verifyToken)}`, {}, 'Could not verify email.');
  },

  changePassword: async (currentPassword, newPassword) => {
    await postJson('/auth/profile/password', { currentPassword, newPassword }, 'Could not change password.');
  },

  enroll2fa: () => postJson<Enroll2faResult>('/auth/2fa/enroll', {}, 'Could not start 2FA enrollment.'),

  confirm2fa: async (code) => {
    const result = await postJson<RecoveryCodesResult>('/auth/2fa/confirm', { code }, 'Invalid code.');
    const current = get().user;
    if (current) {
      set({ user: { ...current, totpEnabled: true } });
    }
    return result;
  },

  disable2fa: async (currentPassword) => {
    await postJson('/auth/2fa/disable', { currentPassword }, 'Could not disable 2FA.');
    const current = get().user;
    if (current) {
      set({ user: { ...current, totpEnabled: false } });
    }
  },

  regenerateRecoveryCodes: (currentPassword) =>
    postJson<RecoveryCodesResult>(
      '/auth/2fa/recovery-codes/regenerate',
      { currentPassword },
      'Could not regenerate recovery codes.',
    ),

  fetchPersonalTokens: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/profile/personal-tokens`, { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'Could not load your personal tokens.');
    }
    return body.data as PersonalToken[];
  },

  createPersonalToken: (label) =>
    postJson<PersonalTokenSecretResult>(
      '/auth/profile/personal-tokens',
      { label },
      'Could not create a personal token.',
    ),

  regeneratePersonalToken: (id) =>
    postJson<PersonalTokenSecretResult>(
      `/auth/profile/personal-tokens/${id}/regenerate`,
      {},
      'Could not regenerate this personal token.',
    ),

  deletePersonalToken: (id) => deleteRequest(`/auth/profile/personal-tokens/${id}`, 'Could not delete this personal token.'),

  fetchOAuthClients: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/profile/oauth-clients`, { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'Could not load your OAuth connector credentials.');
    }
    return body.data as OAuthClient[];
  },

  createOAuthClient: (label, redirectUri) =>
    postJson<OAuthClientSecretResult>(
      '/auth/profile/oauth-clients',
      { label, redirectUri },
      'Could not create an OAuth connector credential.',
    ),

  regenerateOAuthClient: (id) =>
    postJson<OAuthClientSecretResult>(
      `/auth/profile/oauth-clients/${id}/regenerate`,
      {},
      'Could not regenerate this OAuth connector credential.',
    ),

  deleteOAuthClient: (id) => deleteRequest(`/auth/profile/oauth-clients/${id}`, 'Could not delete this OAuth connector credential.'),

  updateOAuthClient: (id, updates) =>
    patchJson<OAuthClient>(`/auth/profile/oauth-clients/${id}`, updates, 'Could not update this credential.'),

  fetchNotificationsSeenAt: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/profile/notifications`, { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'Could not load your notifications status.');
    }
    const data = body.data as NotificationsStatus;
    set({ notificationsSeenAt: data.seenAt });
    return data;
  },

  markNotificationsSeen: async () => {
    const data = await postJson<NotificationsStatus>('/auth/profile/notifications-seen', {}, 'Could not mark notifications as seen.');
    set({ notificationsSeenAt: data.seenAt });
    return data;
  },

  fetchPendingUsers: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/admin/pending-users`, { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'Could not load pending users.');
    }
    const data = body.data as { users?: PendingRegistration[] } | PendingRegistration[] | undefined;
    if (Array.isArray(data)) {
      return data;
    }
    return data?.users ?? [];
  },

  approvePendingUser: async (id) => {
    await postJson(`/auth/admin/pending-users/${id}/approve`, {}, 'Could not approve user.');
  },

  rejectPendingUser: async (id) => {
    await postJson(`/auth/admin/pending-users/${id}/reject`, {}, 'Could not reject user.');
  },

  fetchUsers: async () => {
    const response = await fetch(`${API_BASE_URL}/auth/admin/users`, { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error?.message ?? 'Could not load users.');
    }
    const data = body.data as { users?: AccountUser[] } | AccountUser[] | undefined;
    if (Array.isArray(data)) {
      return data;
    }
    return data?.users ?? [];
  },

  setUserRole: async (id, role) => {
    await postJson(`/auth/admin/users/${id}/role`, { role }, 'Could not change this user’s role.');
  },

  setUserStatus: async (id, status) => {
    await postJson(`/auth/admin/users/${id}/status`, { status }, 'Could not change this user’s status.');
  },

  deleteUser: async (id) => {
    await deleteRequest(`/auth/admin/users/${id}`, 'Could not delete this user.');
  },
}));
