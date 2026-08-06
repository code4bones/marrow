import { create } from 'zustand';
import { API_BASE_URL } from '../config/env';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** null = not checked yet. true = no admin exists, show first-run setup instead of login. */
  bootstrapNeeded: boolean | null;
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  bootstrapAdmin: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

async function readJson(response: Response): Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }> {
  try {
    return await response.json();
  } catch {
    return { ok: false };
  }
}

function requireUser(data: { status: string; user?: AuthUser }): AuthUser {
  if (data.status === 'pending_totp') {
    throw new Error('This account has 2FA enabled, which this build of PMemUI does not support yet.');
  }
  if (!data.user) {
    throw new Error('Response did not include a user.');
  }
  return data.user;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'checking',
  user: null,
  bootstrapNeeded: null,

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
    const user = requireUser(body.data as { status: string; user?: AuthUser });
    set({ status: 'authenticated', user });
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
    const user = requireUser(body.data as { status: string; user?: AuthUser });
    set({ status: 'authenticated', user, bootstrapNeeded: false });
  },

  logout: async () => {
    await fetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
    set({ status: 'unauthenticated', user: null });
  },
}));
