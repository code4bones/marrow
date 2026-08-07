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

interface ClaimContextResult {
  email: string | null;
  purpose: string;
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

  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginTotp: (code: string) => Promise<void>;
  bootstrapAdmin: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;

  registerStart: (email: string, password: string) => Promise<RegisterStartResult>;
  registerConfirm: (token: string, code: string) => Promise<RegisterConfirmResult>;

  /** Invite-claim flow (admin-issued invite, or a password-reset link — same token/password shape). */
  claimContext: (token: string) => Promise<ClaimContextResult>;
  claim: (token: string, password: string) => Promise<ClaimResult>;
  verifyEmail: (verifyToken: string) => Promise<void>;

  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  enroll2fa: () => Promise<Enroll2faResult>;
  confirm2fa: (code: string) => Promise<RecoveryCodesResult>;
  disable2fa: (currentPassword: string) => Promise<void>;
  regenerateRecoveryCodes: (currentPassword: string) => Promise<RecoveryCodesResult>;

  fetchPendingUsers: () => Promise<PendingRegistration[]>;
  approvePendingUser: (id: string) => Promise<void>;
  rejectPendingUser: (id: string) => Promise<void>;
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

  registerConfirm: (token, code) =>
    postJson<RegisterConfirmResult>('/auth/register/confirm', { token, code }, 'Invalid or expired code.'),

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
}));
